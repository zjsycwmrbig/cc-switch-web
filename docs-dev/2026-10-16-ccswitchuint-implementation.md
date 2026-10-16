# ccSwitchUint 实施记录

## 代码与运行产物备份

- 原始代码：`outputs/backups/before-ccswitchuint-20261016T074457Z/`，包含 Git bundle、源码归档、运行包及哈希清单（位于本任务工作区输出目录，未提交到仓库）。
- moss 原始运行备份：`/root/ccswitchuint-backups/before-20261016T074532Z/`，包含二进制、SQLite 一致性备份、配置及账号文件。
- 首次多用户部署前：`/root/ccswitchuint-backups/pre-deploy-20261016T084410Z/`，数据库版本 16。
- 恢复原 UI 前：`/root/ccswitchuint-backups/restore-original-ui-20261016T091640Z/`，包含当时运行的多用户二进制、版本 17 数据库一致性备份及清单；完整性检查为 `ok`。

备份及设备密钥输出均不进入 Git。回滚到版本 16 必须停服并恢复兼容数据库；当前额度分配与分享口令修订使用版本 18，回退到版本 17 及更早的多用户二进制时必须同时恢复对应升级前数据库，保留最新账本、密钥撤销记录和分享授权。

## 已实现

1. 账号注册、密码登录、HttpOnly 会话、CSRF 校验、个人设备密钥及撤销。
2. 供应商、官方账号和授权流程的所有者；公开、指定用户、私有共享与个人/合计额度。
3. 聚合模型目录按用户授权过滤，可选模型与启动模型保存为个人偏好，生成可直接执行的设备更新命令。
4. 网关身份贯穿请求、设备、资源提供者、上游账号、重试、额度预留和结算；中断或未知 usage 保留待核算记录。
5. 官方账号绑定到具体资源，候选账号按调用者权限过滤并轮询，失效账号等待所有者重新授权。
6. 新建普通用户上游的公网地址校验与 DNS 固定；共享服务器文件、进程及全局设置保留管理员边界。

## UI 调整遵循用户反馈

默认入口恢复为原 `App.tsx`，保留 CC Switch Web 的侧栏、供应商卡片、原添加/编辑表单、授权中心、代理设置、原统计图表。登录作为外层身份入口，多用户页面融入原导航，不再提供另一套独立主界面。

- 原卡片附加提供者与模型数量；仅提供者可以编辑、删除或加入/退出聚合。
- 卡片增加“分享与额度”“获取模型”。管理员可独立停用共享资源。
- 原“设置 → 代理”继续供管理员调整监听和出站代理。普通用户保留原设置面板，服务器级控件禁用；语言、主题和应用显示范围保持个人化。
- 原统计页面增加“我的调用 / 我提供的资源 / 全平台”范围，并从用户网关账本获取数据。请求表补充调用用户和设备；未定价请求不显示为已知零成本。
- 原供应商编辑器直接编辑该资源保存的配置；保存不会投影到 moss 的本机 Codex 文件，也不会将其他用户的配置并入编辑器。
- 新增“模型与接入”“设备与密钥”“个人账号”“用户与额度”“配额与账本”等入口，配合原页面使用。

## 构建与操作记录

- 本轮生产前端 TypeScript 编译、Vite 发布构建、Rust 编译检查通过。
- moss 采用单任务 `aarch64-unknown-linux-musl` release 构建，运行在原 `cc-switch-web.service`。
- 按用户要求没有截图；界面交互效果由用户确认。本轮未额外新增或执行测试。
- 前一阶段已完成网关、额度、隔离、流式结算等针对性测试与两台客户端实际调用检查，详见任务输出日志；这些结果不替代本轮 UI 的实际验收。
- 两台远程客户端继续使用各自已安装的设备密钥、统一路由和模型目录；本次 UI 修订不重新安装客户端配置。
- 真实官方账号若仍提示 Refresh Token 过期，需所有者在原授权中心重新登录；不能通过 UI 变更恢复失效凭据。

## 恢复原 UI 的部署结果

- 部署时间：2026-10-16 17:24（Asia/Shanghai）。
- 新二进制 SHA256：`d446bf4c110dba81d175dc190ecd9048c48b74d9351f594192c86ba0810a1980`。
- 运行服务：`cc-switch-web.service`，状态 `active`。
- 数据库仍为版本 17，`quick_check` 为 `ok`。
- 公网 FRP 的首页和健康接口均返回 200；公网首页哈希与本地最终构建完全一致。未进行浏览器截图或交互验收。

## Web UI 导航与模型接入收敛

本轮按实际使用路径收敛 Web UI，底层旧页面、API 与测试暂时保留，只移除当前导航、路由和快捷键入口，避免后续恢复能力时重复实现。

- 侧栏移除各模型供应商快捷按钮以及 Skill、MCP、提示词、会话、设备密钥、应用、设置入口；Claude、Codex、Gemini、OpenClaw、Hermes 等应用切换保留在顶栏。
- `View` 收敛为 `models/allocations/profile/admin/ledger/usage/accounts/providers/universal`。原独立 `keys` 页面并入“模型与接入”，刷新时无法再恢复旧页面，返回键、快捷键和资源工具栏也按新路由收敛。
- 顶栏移除设置、更新徽标、旧统计跳转和项目切换；不再渲染 `ProfileSwitcher`，避免出现“不使用项目”入口。
- “模型与接入”合并模型选择、聚合模型同步命令和设备密钥；模型选择使用 Radix `Collapsible`，默认折叠，设备密钥作为同页子区块。
- 用量请求表新增独立用户列，设备显示在用户名下方；新增用户名模糊筛选，匹配不区分大小写。普通用户仍由后端 `scope=mine` 限制在本人数据，管理员可按用户筛选。
- 中文、英文、日文 README 已同步更新导航、顶栏、模型接入、用量用户筛选及旧页面入口状态。

## 额度分配与分享口令改版

本轮将供应商所有权展示和额度发放拆开，避免在供应商编辑流程中混入授权操作。

- 供应商页按“我的供应商”和“共享给我的供应商”分组；共享卡片显示来源用户和只读状态。
- “额度分配”成为独立导航页面，先选择自有供应商，再切换“指定用户”和“分享口令”模式。
- 指定用户模式支持新增、编辑、禁用和移除授权，设置独立额度、模型范围与到期时间；共享规则继续支持公开默认额度、共享池预算和额度周期。
- 分享口令模式支持额度、模型、到期时间和最多领取次数。默认最多领取 1 次，后端使用立即事务和领取计数保证并发先到先得。
- 数据库只保存分享令牌的 SHA-256；明文口令与链接只在创建响应中返回。撤销口令不会收回已生成的个人授权。
- 个人页改为用量总览，集中展示平台额度、自有供应商共享池余额和共享供应商个人余额，账号安全表单默认折叠。
- 新增接口：`GET/POST /api/unit/share-codes`、`POST /api/unit/share-claims`、`DELETE /api/unit/share-codes/:id`、`DELETE /api/unit/resources/:id/grants/:user`、`GET /api/unit/profile/overview`。
- 数据库版本升至 18，新增 `hub_share_codes` 和 `hub_share_claims`；17→18 迁移复用幂等建表逻辑。

## 本轮验证

- `npx --yes pnpm@10.20.0 typecheck`：通过。
- `/root/.cargo/bin/cargo check --manifest-path backend/Cargo.toml`：通过，保留仓库原有 11 条 Rust 警告。
- `PATH=/root/.cargo/bin:$PATH npx --yes pnpm@10.20.0 build`：前端发布构建与 Rust release 构建通过。当前 Node 18.19.1 会提示 Vite 7 建议使用 Node 20.19+，但本次构建成功。
- `PATH=/root/.cargo/bin:$PATH CARGO_BUILD_JOBS=1 cargo test --manifest-path backend/Cargo.toml hub:: -- --test-threads=1`：13 项通过，覆盖分享口令生命周期、过期/重复/自领拒绝、并发单赢家、显式私有授权和个人概览可见性。
- `npx --yes pnpm@10.20.0 test:unit`：143 个测试文件中 140 个通过，3 个失败；单项统计为 1385 通过、3 失败、2 跳过。`AppsPage` 与 `useModelMetadataFill` 两项为负载下 5 秒超时，单独复跑通过；`sessionsWebTransport` 为既有测试读取 `sessionStorage`、实现读取 `localStorage` 的鉴权存储不一致，与本轮 UI 改造无关。
- `git diff --check`：通过。

## 本轮部署结果

- 部署时间：2026-10-16 18:22（Asia/Shanghai）。
- 部署前备份：`/root/ccswitchuint-backups/before-ui-refresh-20261016T102247Z/cc-switch-web`。
- 部署前二进制 SHA256：`d446bf4c110dba81d175dc190ecd9048c48b74d9351f594192c86ba0810a1980`。
- 新二进制：`backend/target/release/cc-switch-web`，SHA256 `4513103ddbd69a45ebc27dde7733609dca1c94332363991f834055e744b34461`。
- 已替换 `/opt/cc-switch-web/cc-switch-web` 并重启 `cc-switch-web.service`，服务状态为 `active (running)`。
- `http://127.0.0.1:8890/api/health` 返回 `{"status":"ok","mode":"local-rust-service"}`；首页返回 200，前端资源哈希已更新。
