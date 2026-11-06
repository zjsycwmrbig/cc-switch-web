# 分享口令地址与共享用量统计部署记录

日期：2026-11-05（Asia/Shanghai）。

## 本次变更

- 分享口令改为使用当前访问请求的 origin 生成链接，与模型接入命令共用 `X-Forwarded-Host`、`X-Forwarded-Proto` 和 Host 回退规则。
- 供应商用户用量合并当前授权、近 30 天实际调用者和资源所有者，补上所有者本人及已失去当前授权但仍有历史调用的用户。
- 用户权限页继续只读取授权记录；额度使用率改用累计账本用量除以个人额度，不再混用近 30 天用量与终身额度。
- 正式文档同步说明分享链接与接入命令使用相同地址规则。

## 验证

- `cargo test hub::tests --lib`：28 项通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- `cargo fmt --check`、Prettier 检查与 `git diff --check`：通过。
- 新增测试覆盖分享链接跟随当前 Host，以及用量统计包含所有者、授权用户和历史调用者。

## 部署结果

- 部署时间：2026-11-05 13:27（Asia/Shanghai）。
- 回滚备份：`/root/ccswitchuint-backups/full-20261105T052730Z/`，包含旧二进制、旧前端、环境文件、systemd 配置、主密钥、运行状态文件和 SQLite 一致性快照；备份数据库 `quick_check` 为 `ok`。
- 部署前二进制 SHA256：`4191702823e9b3c0b4ec861365dc530358e5c8351626e20d7a39e2fa9e6e785b`。
- 新二进制 SHA256：`dfeb0c76b914b1505cb08b876f0d1ec9909ae282a1f2014d7d61cc45446d20ed`，部署文件与运行中 `/proc/<PID>/exe` 哈希一致。
- `cc-switch-web.service` 为 `active (running)`，监听 `0.0.0.0:8890`；路由代理恢复监听 `127.0.0.1:15721`。
- 本地与公网首页返回 200，本地与公网 `/api/health` 返回 `{"status":"ok","mode":"local-rust-service"}`，`/api/unit/auth/status` 正常返回。
- 新前端入口为 `assets/index-z0Z7RfhC.js`，本地与公网 HTML 引用一致，产物包含本次用量页新增文案。

## 后续增强：用户权限包含提供者本人

### 变更

- 供应商“用户权限”列表合并当前授权人和资源所有者；所有者以“提供者本人”标识展示为“所有者、不限额度、全部模型”，不参与单独分配数量，也不能被编辑或移除。
- 供应商“用户用量”继续同时包含所有者、当前授权用户和历史调用者，保证资源提供者自身的使用额度与调用统计可见。
- 新增后端测试 `resource_permission_and_usage_views_include_owner`，覆盖所有者出现在权限列表，以及历史调用者只进入用量统计、不进入授权列表。

### 验证

- `cargo test hub::tests --lib`：28 项通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- Rust release 构建与 Vite 前端构建通过。
- 公网首页及新前端资源返回 HTTP 200，产物包含“提供者本人”；公网与本地 `/api/health` 均返回 `{"status":"ok","mode":"local-rust-service"}`。

### 部署结果

- 部署时间：2026-11-05 13:35（Asia/Shanghai）。
- 回滚备份：`/root/ccswitchuint-backups/full-20261105T053454Z/`；旧二进制为 `/opt/cc-switch-web/cc-switch-web.previous-20261105T053454Z`，旧前端为 `/opt/cc-switch-web/dist.previous-20261105T053454Z`。
- 部署前二进制 SHA256：`dfeb0c76b914b1505cb08b876f0d1ec9909ae282a1f2014d7d61cc45446d20ed`。
- 新二进制 SHA256：`4fd67495eece0d54db2fdc386b45616e9be14640bdbcdfdc5430dda1f016eb66`，部署文件与运行中 `/proc/122430/exe` 哈希一致。
- 新前端入口：`assets/index-BjRR5cdl.js`，公共首页与本地部署目录引用一致。
- `cc-switch-web.service` 为 `active (running)`，主进程 PID 122430；监听 `0.0.0.0:8890`，路由代理监听 `127.0.0.1:15721`。
- 启动日志无 panic、fatal 或启动失败；代理转发存在非致命的连接解析告警，会自动回退到 reqwest。

## 流式请求结束与历史待核算修复

### 根因

- 网关原先只在读取到上游 EOF 时提交计量。部分上游发送 `response.completed` 或 `[DONE]` 后仍保持 HTTP 连接，导致下游无法及时结束；客户端随后断开时又会触发按“不完整流”处理，将已有 Token 和费用的请求误标为 `pending_usage`。

### 变更

- 检测到 `response.completed`、`response.incomplete`、`response.failed`、`message_stop`、`error` 或 `[DONE]` 后，立即结算当前请求、关闭下游流，并停止继续等待上游 EOF。
- 没有终止事件的中断流仍保持额度预留并进入待核算，保留人工核对能力。
- 新增回归测试，模拟上游发送 `response.completed` 后永久保持连接，验证响应在 2 秒内正常结束且请求状态为 `completed`。

### 历史数据修复

- 修复部署前，对 `status=200`、同时已有 Token 和费用、但仍为 `pending_usage` 的历史请求执行一次性事务结算。
- 共修复 9,259 个请求和 15,153 条额度预留；释放预留 2,911,552,573 Token、993,710,521 credits，并写入对应 824,744,273 Token、91,496,039 credits 的已用额度与结算账本。
- 未自动处理缺少 Token 或费用的 4,785 个待核算记录，继续留给管理员核对；修复后“有完整用量但仍待核”的记录为 0。
- SQLite `quick_check` 为 `ok`，额度桶无负数；新版本上线后产生的正常流式请求已验证直接进入 `completed`。

### 部署结果

- 部署时间：2026-11-06 14:15（Asia/Shanghai）。
- 回滚备份：`/root/ccswitchuint-backups/full-20261106T061352Z/`，包含旧二进制、前端、数据库一致性快照和环境及 systemd 配置。
- 部署前二进制 SHA256：`4fd67495eece0d54db2fdc386b45616e9be14640bdbcdfdc5430dda1f016eb66`。
- 新二进制 SHA256：`9b55b96f98590c3a7d26b5c32490afe84a4a99bd6377b6c19114aa1062ec10b7`，部署文件与运行中 `/proc/176988/exe` 哈希一致。
- `cc-switch-web.service` 为 `active (running)`；本地与公网健康检查正常，公网首页返回 HTTP 200。
