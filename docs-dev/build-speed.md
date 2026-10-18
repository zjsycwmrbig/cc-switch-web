# 构建与部署提速

## 前端（只改 UI 时）

生产机把前端产物放在磁盘目录 `/opt/cc-switch-web/dist`（`CC_SWITCH_WEB_DIST_DIR`），
运行中的服务直接读磁盘，不再依赖编译期嵌入，因此前端改动无需重编 Rust、也无需重启：

```bash
# 在仓库根目录
./node_modules/.bin/vite build
rsync -a --delete dist/ /opt/cc-switch-web/dist/
```

约 15 秒生效。`dist` 目录不存在或未配置时，服务会回退到二进制内嵌的前端。

## 后端联调（快速构建）

日常调试用 dev profile（`backend/Cargo.toml` 中 `[profile.dev] debug = 0`）：

```bash
bash backend/scripts/build-dev.sh
# 产物：backend/target/debug/cc-switch-web
```

实测：首次约 3 分 36 秒，改动单个模块后的增量构建约 20 秒。
调试二进制可直接用于 staging 实例（不同 HOME / 端口）。

## 正式发布

仍使用 release + musl 静态链接（`codegen-units = 1`、`lto = "thin"`），
产物约 27MB，单次构建约 5 分钟：

```bash
cargo build --locked --release --target aarch64-unknown-linux-musl \
  --manifest-path backend/Cargo.toml --bin cc-switch-web
```
