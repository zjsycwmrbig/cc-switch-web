#!/usr/bin/env python3
"""Exercise the real installer against a local authenticated catalog endpoint."""
import http.server
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import threading

REPO = Path(__file__).resolve().parent.parent
model = json.loads((REPO / "backend/src/resources/codex_deepseek_catalog_template.json").read_text())["models"][0]
model["slug"] = "ccs-test/test-model"
payload = {"models": [model], "default_model": model["slug"], "warnings": []}
requests = []


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer installer-test-key":
            self.send_error(401)
            return
        requests.append(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def log_message(self, *_):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory() as temp:
        home = Path(temp)
        config = home / "config.toml"
        config.write_text('model = "old-model"\nmodel_provider = "old"\n[mcp_servers.example]\ncommand = "keep-me"\n[model_providers.old]\nname = "old"\nbase_url = "https://old.example/v1"\n')
        script = REPO / "backend/scripts/cc-switch-update-models.sh"
        env = {**os.environ, "CODEX_HOME": str(home), "CC_SWITCH_URL": "http://127.0.0.1:%d" % server.server_port,
               "CC_SWITCH_ACCESS_KEY": "installer-test-key", "CC_SWITCH_PROXY_URL": "https://gateway.example/v1",
               "CC_SWITCH_CONFIGURE_ROUTE": "1", "CC_SWITCH_RESTART_APP_SERVER": "0"}
        subprocess.run(["bash", str(script)], env=env, check=True, capture_output=True)
        text = config.read_text()
        assert 'model_provider = "ccswitch"' in text
        assert text.count("[model_providers.ccswitch]") == 1
        assert 'experimental_bearer_token = "installer-test-key"' in text
        assert 'base_url = "https://gateway.example/v1"' in text
        assert 'command = "keep-me"' in text
        assert list(home.glob("config.toml.bak-*")), "original config was not backed up"
        assert json.loads((home / "cc-switch-aggregation-models.json").read_text())["models"][0]["slug"] == model["slug"]
        env["CC_SWITCH_CONFIGURE_ROUTE"] = "0"
        subprocess.run(["bash", str(script)], env=env, check=True, capture_output=True)
        after = config.read_text()
        route = lambda value: re.search(r'(?ms)^\[model_providers.ccswitch\]\n(.*?)(?=^\[|\Z)', value).group(1).strip()
        assert route(after) == route(text), "a normal model sync changed the route"
        assert 'model_provider = "ccswitch"' in after
        env["CC_SWITCH_CONFIGURE_ROUTE"] = "1"
        subprocess.run(["bash", str(script)], env=env, check=True, capture_output=True)
        assert config.read_text().count("[model_providers.ccswitch]") == 1
        previous = config.read_text()
        payload["models"] = []
        failed = subprocess.run(["bash", str(script)], env=env, capture_output=True)
        assert failed.returncode != 0
        assert config.read_text() == previous, "invalid catalog changed the config"
        assert len(requests) == 4
        print("Installer checks passed: authenticated download, backup, new route, repeat sync, invalid-catalog rollback.")
finally:
    server.shutdown()
