#!/usr/bin/env bash
# 日常联调用的快速构建：dev profile（无完整调试信息），产物在 target/debug。
# 发布仍使用：cargo build --release --target <triple>
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"

JOBS="${CARGO_BUILD_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
CARGO_BUILD_JOBS="$JOBS" cargo build --bin cc-switch-web --manifest-path Cargo.toml "$@"

printf 'dev binary: %s\n' "$(pwd)/target/debug/cc-switch-web"
