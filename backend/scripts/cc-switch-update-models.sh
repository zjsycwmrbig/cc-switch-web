#!/usr/bin/env bash
# 下载聚合模型目录；配置和模型文件先备份，失败时恢复原文件。
# 环境变量：CC_SWITCH_URL、CC_SWITCH_ACCESS_KEY、CODEX_HOME、CC_SWITCH_RESTART_APP_SERVER
set -euo pipefail
CC_SWITCH_URL="${CC_SWITCH_URL:-__CC_SWITCH_ORIGIN__}"
CC_SWITCH_ACCESS_KEY="${CC_SWITCH_ACCESS_KEY:-__CC_SWITCH_ACCESS_KEY__}"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
BASE="${CC_SWITCH_URL%/}"
CATALOG="$CODEX_DIR/cc-switch-aggregation-models.json"
CONFIG="$CODEX_DIR/config.toml"
for dependency in curl python3; do
  command -v "$dependency" >/dev/null 2>&1 || { echo "请先安装 $dependency" >&2; exit 1; }
done
mkdir -p "$CODEX_DIR"
TMP="$(mktemp "$CODEX_DIR/.cc-switch-models.XXXXXX")"
CFG_TMP="$(mktemp "$CODEX_DIR/.cc-switch-config.XXXXXX")"
trap 'rm -f "$TMP" "$CFG_TMP"' EXIT
echo "下载聚合模型：$BASE/api/model-catalog/codex/aggregation"
curl -fsSL -H "Authorization: Bearer $CC_SWITCH_ACCESS_KEY" -H 'Accept: application/json' \
  "$BASE/api/model-catalog/codex/aggregation" -o "$TMP"
python3 - "$TMP" "$CONFIG" "$CFG_TMP" "$CATALOG" <<'PY'
import json, re, sys
from pathlib import Path
catalog_path, config_path, staged_path, target = sys.argv[1:]
catalog = json.loads(Path(catalog_path).read_text())
for warning in catalog.get('warnings', []):
    print('提示：' + warning)
models = catalog.get('models', [])
ids = [m.get('slug', '') for m in models]
if not ids or len(set(ids)) != len(ids) or any(not re.match(r'^ccs-[^/]+/.+', s) for s in ids):
    raise SystemExit('无效的聚合模型目录：模型必须带有唯一的供应商标识')
source = Path(config_path).read_text() if Path(config_path).exists() else ''
# 只更新顶层键，保留路由表、登录方式和其他自定义表。
lines = source.splitlines(keepends=True)
boundary = next((i for i, line in enumerate(lines) if line.lstrip().startswith('[')), len(lines))
root, tables = lines[:boundary], lines[boundary:]
previous = None
for line in root:
    match = re.match(r'''^\s*model\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')''', line)
    if match:
        value = match.group(1)
        previous = json.loads(value) if value.startswith('"') else value[1:-1]
        break
selected = previous if previous in ids else catalog.get('default_model', ids[0])
if selected not in ids:
    raise SystemExit('聚合默认模型不在模型列表中')
# 全局窗口会覆盖每个模型自己的窗口，聚合模型统一使用目录内的独立声明。
owned = re.compile(r'^\s*"?(?:model_catalog_json|model|model_context_window|model_auto_compact_token_limit)"?\s*=')
output = 'model_catalog_json = ' + json.dumps(target) + '\nmodel = ' + json.dumps(selected) + '\n'
output += ''.join(line for line in root if not owned.match(line)) + ''.join(tables)
try:
    import tomllib
except ImportError:
    pass
else:
    before, after = tomllib.loads(source), tomllib.loads(output)
    for key in ('model_provider', 'model_providers'):
        if before.get(key) != after.get(key):
            raise SystemExit('同步取消：路由配置发生意外变化')
Path(staged_path).write_text(output)
print('模型数量：%d；启动模型：%s' % (len(ids), selected))
PY
STAMP="$(date -u +%Y%m%dT%H%M%S)-$$"
for file in "$CONFIG" "$CATALOG"; do
  if [ -f "$file" ]; then cp -p "$file" "$file.bak-$STAMP"; fi
done
# staging 与目标在同一目录，rename 原子替换；第二步失败时还原第一步。
chmod 600 "$TMP" "$CFG_TMP"
mv -f "$TMP" "$CATALOG"
if ! mv -f "$CFG_TMP" "$CONFIG"; then
  if [ -f "$CATALOG.bak-$STAMP" ]; then cp -p "$CATALOG.bak-$STAMP" "$CATALOG"; else rm -f "$CATALOG"; fi
  exit 1
fi
echo "已同步：${CATALOG}；备份后缀：.bak-${STAMP}"
if [ "${CC_SWITCH_RESTART_APP_SERVER:-0}" = "1" ]; then
  CODEX_BIN="$(command -v codex || true)"
  if [ -z "$CODEX_BIN" ]; then
    for candidate in "$HOME/.local/bin/codex" "$HOME"/.nvm/versions/node/*/bin/codex "$HOME"/.vscode-server/extensions/openai.chatgpt-*/bin/linux-*/codex; do
      if [ -x "$candidate" ]; then CODEX_BIN="$candidate"; break; fi
    done
  fi
  if [ -n "$CODEX_BIN" ]; then
    export PATH="$(dirname "$CODEX_BIN"):$PATH"
    if ! "$CODEX_BIN" app-server daemon restart; then
      # Desktop 启动的服务可能不归 daemon 命令管理。只重启当前 CODEX_HOME
      # 控制 socket 的同用户 Codex 服务，不触碰其他目录或其他用户的服务。
      python3 - "$CODEX_DIR" "$CODEX_BIN" <<'PY' || echo "请重新打开 Codex 以加载新目录。" >&2
from pathlib import Path
import os, re, signal, subprocess, sys, time
directory, cli = sys.argv[1:]
socket = str((Path(directory) / 'app-server-control/app-server-control.sock').resolve())
def owner():
    lines = subprocess.check_output(['ss', '-xlpn'], text=True).splitlines()
    for line in lines:
        if socket not in line:
            continue
        match = re.search(r'pid=(\d+)', line)
        if not match:
            continue
        pid = int(match.group(1))
        proc = Path('/proc/%d' % pid)
        if proc.stat().st_uid != os.getuid():
            raise SystemExit('拒绝重启其他用户的服务')
        command = (proc / 'cmdline').read_bytes().replace(b'\0', b' ')
        if b'codex' not in command or b'app-server --listen unix://' not in command:
            raise SystemExit('控制 socket 不属于预期的 Codex app-server')
        return pid
    return None
try:
    previous = owner()
    if previous is None:
        raise RuntimeError('没有找到当前 Codex 控制 socket 的监听进程')
    os.kill(previous, signal.SIGTERM)
    print('已停止旧 Codex app-server（PID %s），等待重新启动。' % previous)
    for _ in range(3):
        time.sleep(1)
        current = owner()
        if current is not None and current != previous:
            print('Codex app-server 已重新启动（PID %s）。' % current)
            break
    else:
        result = subprocess.run([cli, 'app-server', 'daemon', 'start'], timeout=30)
        current = owner()
        if current is None or current == previous:
            raise RuntimeError('服务尚未重新启动，请重新打开 Codex')
except (OSError, RuntimeError, subprocess.SubprocessError) as error:
    raise SystemExit(str(error))
PY
    fi
  else
    echo "未找到 Codex CLI，请在 Codex 终端中执行 codex app-server daemon restart。" >&2
  fi
fi
echo "已有 CLI 会话请退出重进；VS Code 远程窗口执行 Developer: Reload Window。"
