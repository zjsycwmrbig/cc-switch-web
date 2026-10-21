#!/usr/bin/env bash
# ccSwitchUint 设备同步：下载聚合模型目录并写入 Codex 配置，先备份、原子替换，失败时还原。
# 环境变量：CC_SWITCH_URL、CC_SWITCH_ACCESS_KEY、CC_SWITCH_PROXY_URL、CODEX_HOME、
#           CC_SWITCH_CONFIGURE_ROUTE、CC_SWITCH_RESTART_APP_SERVER、NO_COLOR
set -Eeuo pipefail
CC_SWITCH_URL="${CC_SWITCH_URL:-__CC_SWITCH_ORIGIN__}"
CC_SWITCH_ACCESS_KEY="${CC_SWITCH_ACCESS_KEY:-__CC_SWITCH_ACCESS_KEY__}"
CC_SWITCH_PROXY_URL="${CC_SWITCH_PROXY_URL:-__CC_SWITCH_PROXY_URL__}"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
BASE="${CC_SWITCH_URL%/}"
CATALOG="$CODEX_DIR/cc-switch-aggregation-models.json"
CONFIG="$CODEX_DIR/config.toml"
CATALOG_BACKUP="$CODEX_DIR/cc-switch-aggregation-models.json.ccswitch-backup"
CONFIG_BACKUP="$CODEX_DIR/config.toml.ccswitch-backup"
CATALOG_MISSING="$CATALOG_BACKUP.missing"
CONFIG_MISSING="$CONFIG_BACKUP.missing"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_STEP=$'\033[36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_STEP=''; C_OK=''; C_WARN=''; C_ERR=''
fi
STEP=0
TOTAL=5
INDENT='      '
START_TS=$(date +%s)
elapsed() { printf '%ss' "$(( $(date +%s) - START_TS ))"; }
step() { STEP=$((STEP + 1)); printf '%s[%d/%d]%s %s%s%s\n' "$C_STEP" "$STEP" "$TOTAL" "$C_RESET" "$C_BOLD" "$1" "$C_RESET"; }
detail() { printf '%s%s%s%s\n' "$INDENT" "$C_DIM" "$1" "$C_RESET"; }
ok() { printf '%s%s✔%s %s\n' "$INDENT" "$C_OK" "$C_RESET" "$1"; }
warn() { printf '%s%s!%s %s\n' "$INDENT" "$C_WARN" "$C_RESET" "$1" >&2; }
fail() {
  printf '\n%s✘ %s%s\n' "$C_ERR" "$1" "$C_RESET" >&2
  shift || true
  for line in "$@"; do printf '  %s\n' "$line" >&2; done
  printf '  %s\n' "如需协助：把上面 20 行输出连同执行的命令一起发给管理员。" >&2
  exit 1
}
on_error() { fail "同步中断（脚本第 $1 行）" "原有配置未被破坏，可修正后重跑同一命令。"; }
trap 'on_error $LINENO' ERR

# Codex 的 daemon restart 在旧控制 socket 仍被占用时可能返回成功，但进程并未
# 更换。这里以控制 socket 的 PID 是否真正变化为准，必要时只终止当前
# CODEX_HOME 对应的 app-server，再重新启动。
restart_codex_app_server() {
  local cli="$1"
  local directory="$2"
  python3 - "$directory" "$cli" <<'PY'
from pathlib import Path
import os, re, signal, subprocess, sys, time

directory, cli = sys.argv[1:]
socket = str((Path(directory) / 'app-server-control/app-server-control.sock').resolve())

def owner():
    try:
        lines = subprocess.check_output(
            ['ss', '-xlpn'], encoding='utf-8', errors='replace'
        ).splitlines()
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    for line in lines:
        if socket not in line:
            continue
        match = re.search(r'pid=(\d+)', line)
        if not match:
            continue
        pid = int(match.group(1))
        proc = Path('/proc/%d' % pid)
        if proc.stat().st_uid != os.getuid():
            raise RuntimeError('拒绝重启其他用户的服务')
        command = (proc / 'cmdline').read_bytes().replace(b'\0', b' ')
        if b'codex' not in command or b'app-server --listen unix://' not in command:
            raise RuntimeError('控制 socket 不属于预期的 Codex app-server')
        return pid
    return None

def wait_changed(previous, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        current = owner()
        if current is not None and current != previous:
            return current
        time.sleep(0.15)
    return owner()

def run_quiet(args, timeout=30):
    try:
        subprocess.run(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        pass

try:
    previous = owner()
    run_quiet([cli, 'app-server', 'daemon', 'restart'])
    current = wait_changed(previous, 5)
    if current is not None and current != previous:
        print('Codex app-server 已重启（PID %s）。' % current)
        raise SystemExit(0)

    previous = owner() or previous
    if previous is not None:
        os.kill(previous, signal.SIGTERM)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and owner() == previous:
            time.sleep(0.15)
        if owner() == previous:
            os.kill(previous, signal.SIGKILL)
            time.sleep(0.3)

    run_quiet([cli, 'app-server', 'daemon', 'start'])
    current = wait_changed(previous, 8)
    if current is None or current == previous:
        raise RuntimeError('Codex app-server 未产生新的控制 socket，请重新打开 Codex')
    print('Codex app-server 已强制重启（PID %s）。' % current)
except (OSError, RuntimeError, subprocess.SubprocessError) as error:
    raise SystemExit(str(error))
PY
}

printf '%s%s==> ccSwitchUint 模型同步%s\n' "$C_BOLD" "$C_STEP" "$C_RESET"
detail "服务地址：$BASE"
detail "配置目录：$CODEX_DIR"

step "检查运行依赖（curl / python3）"
missing=''
for dependency in curl python3; do
  command -v "$dependency" >/dev/null 2>&1 || missing="$missing $dependency"
done
if [ -n "$missing" ]; then
  fail "缺少依赖：${missing# }" "请先安装后重跑：" \
    "  Ubuntu/Debian: sudo apt-get install -y curl python3" \
    "  macOS:         brew install curl python3"
fi
ok "curl、python3 已就绪（$(elapsed)）"

mkdir -p "$CODEX_DIR"

if [ "${1:-}" = "restore" ]; then
  TOTAL=3
  printf '%s%s==> ccSwitchUint 配置还原%s\n' "$C_BOLD" "$C_STEP" "$C_RESET"
  detail "配置目录：$CODEX_DIR"
  step "检查固定备份"
  if [ ! -f "$CONFIG_BACKUP" ] && [ ! -f "$CONFIG_MISSING" ]; then
    fail "找不到 config.toml 的固定备份" "先执行一次正常同步，脚本会保存为：$CONFIG_BACKUP"
  fi
  if [ ! -f "$CATALOG_BACKUP" ] && [ ! -f "$CATALOG_MISSING" ]; then
    fail "找不到模型目录的固定备份" "先执行一次正常同步，脚本会保存为：$CATALOG_BACKUP"
  fi
  ok "固定备份已找到"

  step "还原 Codex 配置"
  if [ -f "$CONFIG_BACKUP" ]; then
    cp -p "$CONFIG_BACKUP" "$CONFIG"
  else
    rm -f "$CONFIG"
  fi
  if [ -f "$CATALOG_BACKUP" ]; then
    cp -p "$CATALOG_BACKUP" "$CATALOG"
  else
    rm -f "$CATALOG"
  fi
  chmod 600 "$CONFIG" "$CATALOG" 2>/dev/null || true
  ok "已还原固定备份"

  step "重启 Codex app-server"
  if [ "${CC_SWITCH_RESTART_APP_SERVER:-1}" = "1" ]; then
    CODEX_BIN="$(command -v codex || true)"
    if [ -z "$CODEX_BIN" ]; then
      for candidate in "$HOME/.local/bin/codex" "$HOME"/.nvm/versions/node/*/bin/codex "$HOME"/.vscode-server/extensions/openai.chatgpt-*/bin/linux-*/codex; do
        if [ -x "$candidate" ]; then CODEX_BIN="$candidate"; break; fi
      done
    fi
    if [ -n "$CODEX_BIN" ] && restart_codex_app_server "$CODEX_BIN" "$CODEX_DIR"; then
      ok "已重启 Codex app-server"
    else
      warn "自动重启未成功，请手动执行：codex app-server daemon restart"
    fi
  else
    detail "未设置 CC_SWITCH_RESTART_APP_SERVER=1，跳过自动重启"
  fi
  printf '\n%s%s✔ 还原完成%s\n' "$C_BOLD" "$C_OK" "$C_RESET"
  detail "已还原：$CONFIG"
  detail "已还原：$CATALOG"
  exit 0
fi

TMP="$(mktemp "$CODEX_DIR/.cc-switch-models.XXXXXX")"
CFG_TMP="$(mktemp "$CODEX_DIR/.cc-switch-config.XXXXXX")"
PY_LOG="$CODEX_DIR/.cc-switch-sync.$$.log"
trap 'rm -f "$TMP" "$CFG_TMP" "$PY_LOG"' EXIT

step "下载聚合模型目录"
CATALOG_URL="$BASE/api/model-catalog/codex/aggregation"
detail "GET $CATALOG_URL"
if ! curl -fsSL -H "Authorization: Bearer $CC_SWITCH_ACCESS_KEY" -H 'Accept: application/json' \
  "$CATALOG_URL" -o "$TMP"; then
  fail "下载模型目录失败" \
    "常见原因：设备密钥被撤销或过期、服务未启动、当前网络无法访问 $BASE。" \
    "处理方式：在网页「模型与接入」里重新创建一条接入命令后重试。"
fi
if [ ! -s "$TMP" ]; then
  fail "下载到的模型目录为空" "请确认该设备密钥仍有权限读取模型目录。"
fi
ok "已下载模型目录（$(wc -c <"$TMP" | tr -d ' ') 字节，$(elapsed)）"

step "生成 Codex 配置（模型目录 + 路由）"
if ! python3 - "$TMP" "$CONFIG" "$CFG_TMP" "$CATALOG" "$CC_SWITCH_PROXY_URL" "$CC_SWITCH_ACCESS_KEY" "${CC_SWITCH_CONFIGURE_ROUTE:-0}" >"$PY_LOG" 2>&1 <<'PY'
import json, re, sys
from pathlib import Path
from urllib.parse import urlparse
catalog_path, config_path, staged_path, target, proxy_url, api_key, configure = sys.argv[1:]
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
keys = 'model_catalog_json|model|model_context_window|model_auto_compact_token_limit'
if configure == '1':
    keys += '|model_provider'
    proxy_port = urlparse(proxy_url).port

    def provider_id(line):
        match = re.match(
            r'^\s*\[\s*model_providers\s*\.\s*"?([^".\]]+)"?(?:\.[^\]]+)?\s*\]',
            line,
        )
        return match.group(1) if match else None

    blocks, current = [], []
    for line in tables:
        if line.lstrip().startswith('[') and current:
            blocks.append(current)
            current = [line]
        else:
            current.append(line)
    if current:
        blocks.append(current)

    def is_legacy_ccswitch(block):
        block_text = ''.join(block)
        name = re.search(r'(?m)^\s*name\s*=\s*"([^"]*)"', block_text)
        if name and 'ccswitch' in name.group(1).lower():
            return True
        base = re.search(r'(?m)^\s*base_url\s*=\s*"([^"]*)"', block_text)
        if not base:
            return False
        parsed = urlparse(base.group(1))
        return (
            parsed.hostname in ('127.0.0.1', 'localhost', '::1')
            and parsed.port == proxy_port
        )

    kept, legacy_ids = [], set()
    for block in blocks:
        current_id = provider_id(block[0])
        if current_id in ('custom', 'ccswitch') and is_legacy_ccswitch(block):
            legacy_ids.add(current_id)
            continue
        kept.extend(block)
    tables = kept
owned = re.compile(r'^\s*"?(?:' + keys + r')"?\s*=')
output = 'model_catalog_json = ' + json.dumps(target) + '\nmodel = ' + json.dumps(selected) + '\n'
output += ''.join(line for line in root if not owned.match(line)) + ''.join(tables)
if configure == '1':
    if not proxy_url.startswith(('http://', 'https://')) or not api_key:
        raise SystemExit('接入取消：缺少代理地址或设备密钥')
    output = 'model_provider = "ccswitch"\n' + output
    def route_table(provider_id, name):
        return (
            '\n[model_providers.' + provider_id + ']\nname = ' + json.dumps(name)
            + '\nbase_url = ' + json.dumps(proxy_url)
            + '\nwire_api = "responses"\nrequires_openai_auth = false'
            + '\nexperimental_bearer_token = ' + json.dumps(api_key) + '\n'
        )
    if 'custom' in legacy_ids:
        # Older sync versions used the generic `custom` provider id. Keep that
        # table valid so an already-open Codex thread cannot retain a legacy key.
        output += route_table('custom', 'ccSwitchUint (legacy)')
    output += route_table('ccswitch', 'ccSwitchUint')
try:
    import tomllib
except ImportError:
    pass
else:
    before, after = tomllib.loads(source), tomllib.loads(output)
    if configure != '1':
        for key in ('model_provider', 'model_providers'):
            if before.get(key) != after.get(key):
                raise SystemExit('同步取消：路由配置发生意外变化')
Path(staged_path).write_text(output)
print('模型数量：%d；启动模型：%s' % (len(ids), selected))
PY
then
  while IFS= read -r line; do [ -n "$line" ] && printf '  %s\n' "$line" >&2; done <"$PY_LOG"
  fail "生成配置失败" \
    "上游返回的模型目录可能无效，或该设备密钥当前没有可用模型。" \
    "请把上面输出的最后几行发给管理员。"
fi
while IFS= read -r line; do
  [ -n "$line" ] && detail "$line"
done <"$PY_LOG"
MODEL_LINE="$(grep '^模型数量：' "$PY_LOG" | tail -n 1 || true)"
ok "配置已生成（$(elapsed)）"

step "备份并原子写入配置"
if [ -f "$CONFIG" ]; then
  cp -p "$CONFIG" "$CONFIG_BACKUP"
  rm -f "$CONFIG_MISSING"
else
  rm -f "$CONFIG_BACKUP"
  : > "$CONFIG_MISSING"
fi
if [ -f "$CATALOG" ]; then
  cp -p "$CATALOG" "$CATALOG_BACKUP"
  rm -f "$CATALOG_MISSING"
else
  rm -f "$CATALOG_BACKUP"
  : > "$CATALOG_MISSING"
fi
chmod 600 "$CONFIG_BACKUP" "$CATALOG_BACKUP" "$CONFIG_MISSING" "$CATALOG_MISSING" 2>/dev/null || true
detail "固定备份 config.toml → $(basename "$CONFIG_BACKUP")"
detail "固定备份 $(basename "$CATALOG") → $(basename "$CATALOG_BACKUP")"
# staging 与目标在同一目录，rename 原子替换；第二步失败时还原第一步。
chmod 600 "$TMP" "$CFG_TMP"
mv -f "$TMP" "$CATALOG"
if ! mv -f "$CFG_TMP" "$CONFIG"; then
  if [ -f "$CATALOG_BACKUP" ]; then cp -p "$CATALOG_BACKUP" "$CATALOG"; else rm -f "$CATALOG"; fi
  fail "写入 config.toml 失败，已还原模型目录" "若目标文件被占用，请关闭 Codex 后重跑同一命令。"
fi
ok "已写入 config.toml 与聚合模型目录（固定备份已更新，$(elapsed)）"

step "重启 Codex app-server"
if [ "${CC_SWITCH_RESTART_APP_SERVER:-0}" = "1" ]; then
  CODEX_BIN="$(command -v codex || true)"
  if [ -z "$CODEX_BIN" ]; then
    for candidate in "$HOME/.local/bin/codex" "$HOME"/.nvm/versions/node/*/bin/codex "$HOME"/.vscode-server/extensions/openai.chatgpt-*/bin/linux-*/codex; do
      if [ -x "$candidate" ]; then CODEX_BIN="$candidate"; break; fi
    done
  fi
  if [ -n "$CODEX_BIN" ]; then
    export PATH="$(dirname "$CODEX_BIN"):$PATH"
    if restart_codex_app_server "$CODEX_BIN" "$CODEX_DIR"; then
      ok "已重启 Codex app-server"
    else
      warn "自动重启未成功，请重新打开 Codex"
    fi
  else
    warn "未找到 Codex CLI，已跳过自动重启"
    detail "手动执行：codex app-server daemon restart"
  fi
else
  detail "未设置 CC_SWITCH_RESTART_APP_SERVER=1，跳过自动重启"
fi

printf '\n%s%s✔ 同步完成%s（总耗时 %s）\n' "$C_BOLD" "$C_OK" "$C_RESET" "$(elapsed)"
[ -n "${MODEL_LINE:-}" ] && detail "$MODEL_LINE"
detail "模型目录：$CATALOG"
detail "固定备份：$CONFIG_BACKUP、$CATALOG_BACKUP"
printf '%s下一步：%s\n' "$INDENT" "在 Codex 的模型列表里选择需要的模型即可开始使用。"
printf '%s%s\n' "$INDENT" "以后在网页改完模型选择，重新执行这条命令即可同步。"
printf '%s还原命令：%s\n' "$INDENT" "CC_SWITCH_RESTART_APP_SERVER=1 bash cc-switch-update-models.sh restore"
printf '%s%s\n' "$INDENT" "已有 CLI 会话请退出重进；VS Code 远程窗口执行 Developer: Reload Window。"
