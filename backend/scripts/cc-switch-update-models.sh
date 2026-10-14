#!/usr/bin/env bash
# cc-switch 模型配置在线更新（由 cc-switch-web 生成，纯 curl + bash，无需 python）
#
# 用法：
#   curl -fsSL -H 'Authorization: Bearer <访问密钥>' '<网页地址>/api/model-catalog/codex/install.sh' | bash
#
# 可用环境变量覆盖：CC_SWITCH_URL、CC_SWITCH_ACCESS_KEY、CODEX_HOME
# 只做三件事：备份 config.toml 和模型文件、下载模型目录、把 model_catalog_json 指过去。
set -euo pipefail

CC_SWITCH_URL="${CC_SWITCH_URL:-__CC_SWITCH_ORIGIN__}"
CC_SWITCH_ACCESS_KEY="${CC_SWITCH_ACCESS_KEY:-__CC_SWITCH_ACCESS_KEY__}"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
BASE="${CC_SWITCH_URL%/}"
CATALOG="$CODEX_DIR/cc-switch-all-models.json"
CONFIG="$CODEX_DIR/config.toml"
STAMP="$(date -u +%Y%m%dT%H%M%S%NZ)"
CFG_TMP=""

TMP="$(mktemp "${TMPDIR:-/tmp}/cc-switch-models.XXXXXX")"
cleanup() {
  rm -f "$TMP"
  [ -n "$CFG_TMP" ] && rm -f "$CFG_TMP"
  return 0
}
trap cleanup EXIT

if [ -z "$BASE" ]; then
  echo "缺少网页地址：请设置 CC_SWITCH_URL，例如 CC_SWITCH_URL=http://192.0.2.10:8890" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "未找到 curl，请先安装 curl" >&2
  exit 1
fi

mkdir -p "$CODEX_DIR"

echo "下载模型目录：$BASE/api/model-catalog/codex"
if [ -n "$CC_SWITCH_ACCESS_KEY" ]; then
  curl -fsSL -H "Authorization: Bearer $CC_SWITCH_ACCESS_KEY" -H 'Accept: application/json' \
    "$BASE/api/model-catalog/codex" -o "$TMP"
else
  curl -fsSL -H 'Accept: application/json' "$BASE/api/model-catalog/codex" -o "$TMP"
fi

COUNT="$(grep -c '"slug"' "$TMP" || true)"
if [ "${COUNT:-0}" -lt 1 ] || ! grep -q '"models"' "$TMP"; then
  echo "下载结果不是有效的模型配置，可能是密钥或地址不对" >&2
  exit 1
fi

BACKUPS=""
for f in "$CONFIG" "$CATALOG"; do
  if [ -f "$f" ]; then
    cp -p "$f" "$f.bak-$STAMP"
    BACKUPS="$BACKUPS $f.bak-$STAMP"
  fi
done

install -m 0600 "$TMP" "$CATALOG"

if [ -f "$CONFIG" ]; then
  CFG_TMP="$(mktemp "${TMPDIR:-/tmp}/cc-switch-config.XXXXXX")"
  if grep -qE '^[[:space:]]*("?model_catalog_json"?)[[:space:]]*=' "$CONFIG"; then
    sed -E "s@^[[:space:]]*\"?model_catalog_json\"?[[:space:]]*=.*@model_catalog_json = \"$CATALOG\"@" \
      "$CONFIG" > "$CFG_TMP"
  else
    { printf 'model_catalog_json = "%s"\n' "$CATALOG"; cat "$CONFIG"; } > "$CFG_TMP"
  fi
  if command -v python3 >/dev/null 2>&1 && python3 -c 'import tomllib' >/dev/null 2>&1; then
    python3 - "$CONFIG" "$CFG_TMP" <<'PY'
import sys
import tomllib

with open(sys.argv[1], 'rb') as before_file:
    before = tomllib.load(before_file)
with open(sys.argv[2], 'rb') as after_file:
    after = tomllib.load(after_file)
for key in ('model', 'model_provider', 'model_providers'):
    if before.get(key) != after.get(key):
        raise SystemExit('配置校验失败：' + key + ' 会发生变化')
PY
  fi
  cat "$CFG_TMP" > "$CONFIG"
else
  printf 'model_catalog_json = "%s"\n' "$CATALOG" > "$CONFIG"
fi

echo "已写入 $COUNT 个模型：$CATALOG"
if [ -n "$BACKUPS" ]; then
  echo "备份：$BACKUPS"
fi
echo "重新打开 Codex（VS Code 远程窗口执行 Developer: Reload Window）后即可看到全部模型。"
if [ -S "$CODEX_DIR/app-server-control/app-server-control.sock" ]; then
  if [ "${CC_SWITCH_RESTART_APP_SERVER:-0}" = "1" ] && command -v codex >/dev/null 2>&1; then
    echo "重启本机 codex app-server 守护进程，让 /model 选择器立刻读到新清单…"
    codex app-server daemon restart >/dev/null 2>&1 ||
      echo "守护进程不是由 codex app-server daemon 管理的，没能自动重启；请手动重启该 app-server 进程。" >&2
  else
    echo "注意：命令行 /model 的候选来自本机 codex app-server 守护进程启动时读到的配置。"
    echo "      换过模型清单后如果选择器还是旧列表，重启该守护进程即可（codex app-server daemon restart，"
    echo "      或加环境变量 CC_SWITCH_RESTART_APP_SERVER=1 重跑本脚本）。"
  fi
fi
