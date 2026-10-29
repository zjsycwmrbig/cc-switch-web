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

## 导航收敛与界面统一

本轮按实际使用路径合并导航层级，并把多用户页面的配色统一回 CC Switch 主题变量。

- 侧栏新增「供应商」折叠二级菜单，直接承载 Claude、Codex、Gemini 等应用切换；顶栏不再渲染应用切换器，改为显示当前应用名称与路由激活状态。应用元数据抽到 `src/config/appMeta.ts`，侧栏与切换器共用同一份清单。
- 侧栏下线「配额与账本」「统一供应商」「账号」三个入口，`View` 收敛为 `providers/models/allocations/profile/admin/usage`。非管理员的应用列表只保留 Codex 与 Claude，与后端“仅这两个应用支持多用户聚合”一致。
- 官方账号以供应商卡片存在：Codex 的 `codex-official` 资源卡片新增「官方账号」按钮（管理员），点击打开原授权中心全屏面板；用量查询沿用卡片上的 Codex 官方额度页脚。
- 供应商页移除 `AggregationSyncPanel`，聚合同步命令只在「模型与接入」出现，顶部保留账户模式切换与供应商列表。
- 添加供应商对话框移除「统一供应商」页签及其表单入口，避免进入无响应且与多用户模式无关的旧流程；统一供应商的前端组件与后端接口保留但不再挂到导航。
- `unit.css` 的颜色全部改用主题变量（`--foreground/--border/--card/--primary/--accent/--warning-soft` 等），浅色、深色与主题色切换同时生效；新增 `.u-page-lead` 承接页面说明与主操作，页面标题统一由顶栏渲染，不再在页面内重复出现。
- 内容容器统一为 `px-3 md:px-6`，多用户页面去掉 `max-w-6xl` 限制，与供应商、统计页保持同一版心。

### 部署

- 部署前备份：`/root/ccswitchuint-backups/nav-unify-<时间戳>/`，包含上一版二进制与数据库一致性快照。
- 新二进制 SHA256：`81564bbba7da5cfcf86f4541022e469ad2bce6dc0bc8fe6f6b7c6388139edd63`。
- 数据库保持版本 18，未发生迁移；`cc-switch-web.service` 状态 `active`，`http://127.0.0.1:8890/api/health` 返回 `ok`，首页与公网 FRP 均返回 200，前端资源哈希为 `assets/index-DR4UZB57.js`。

## 侧栏交互修正与设备密钥区块统一

- 侧栏「供应商」行改为跳转并展开应用列表：图标栏折叠时先展开侧栏再展开二级菜单，收起只由行尾箭头控制，避免一次点击把自己关掉。
- 侧栏顺序按实际使用路径调整为「模型与接入、额度分配、使用统计、供应商（二级菜单）」。
- 「设备与接入密钥」从独立 `u-panel` 改为外壳区块（`rounded-lg border p-4` + 外壳按钮/输入框/表格），与同页的聚合同步面板统一版心和控件尺寸；去掉了 `u-note` 与 Tailwind 混用的类名。
- 「模型与接入」页统一为 `flex flex-col gap-4` 间距，并在 `unit-content` 下取消卡片自带的下边距，避免同一页里出现两套行距。
- 新增供应商保存失败时输出 `console.error` 并检测纯前端异常（`TypeError`/`SyntaxError`）弹提示；`settingsConfig` 解析失败时直接提示配置不是合法 JSON，不再静默中断。
- 新增 `PanelErrorBoundary`：懒加载的新增/编辑供应商面板渲染或分块加载失败时弹出提示，出错后保持当前界面可用，不再出现整页无响应。
- 集成测试中的应用切换改为侧栏二级菜单路径（先点「供应商」再点应用名），`tests/integration/App.test.tsx` 9 项通过。

### 排查记录

- 服务端新增供应商链路经真实请求验证可用：以管理员会话 + CSRF 提交真实形态的 Codex 供应商负载返回 `200 true`，创建后立即删除探针供应商，`hub_resources` 恢复 7 条。
- 线上前端分块完整：入口 `assets/index-DR4UZB57.js` 引用的 33 个分块全部返回 200，`AddProviderDialog` 分块已不再包含统一供应商页签。
- 未能在本机复现用户所述的「新增供应商卡死」：Codex 应用下的编辑器视图在多用户模式走本地短路，新增保存走 `/api/unit/ui/providers/:app/save`，服务端与前端路径均正常；上述错误暴露改动用于让真实故障可见。

## 供应商卡片归属与官方用量档位显示

- 归属信息不再单独占一行：供应商库卡片标题改为「<用户名> 的 <供应商名>」，用户名用主题色、供应商名用前景色标题字重，可见模型数与官方账号标记留在下面一行。
- 「共享给我的供应商」卡片标题同样改成「<用户名> 的 <供应商名>」，正文只保留应用类型与「共享给我」。
- 个人页「共享给我的供应商」卡片同步该写法，自有供应商卡片标题保持供应商名不变。
- 官方账号卡片的余额/用量把后端原始档位名（`five_hour`、`seven_day` 等）复用 `SubscriptionQuotaFooter` 的 `tierLabel` 映射换成本地化写法，未知档位名保持原样。

### 本轮验证

- `npx --yes pnpm@10.20.0 typecheck`：通过。
- `npx --yes pnpm@10.20.0 exec vitest run tests/components/ProviderList.test.tsx`：7 项通过。
- `npx --yes pnpm@10.20.0 build:frontend`：通过，产物 `assets/index-DVTgNq8S.js`。
- 两轮部署均为前端快路径：产物直接落到 `/opt/cc-switch-web/dist`，未重编 Rust、未重启服务；第一次备份 `/root/ccswitchuint-backups/ui-market-card-20261019T160112Z/dist.old`，标题改版备份 `/root/ccswitchuint-backups/ui-title-owner-20261019T160526Z/dist.old`。
- 线上核对：`/`、入口分块均返回 200，服务端返回的首页哈希与新产物一致，构建分块已包含「<用户名> 的 <供应商名>」标题结构与 `tierLabel` 档位映射；公网 `47.93.170.86:8890` 返回 200。

## 设备密钥恢复、同步选择与转发重试修正

本轮补齐设备密钥的安全恢复流程，并修正聚合同步和转发器中的边界问题。

- 设备密钥改为使用 `/root/.cc-switch-web/hub-api-key.secret` 主密钥进行 HMAC 派生，同一设备可重复获取同步命令，不再依赖首次生成的明文。
- `hub_api_keys` 新增 `token_version`。旧密钥继续用于鉴权，但旧格式密钥不能用于恢复设备命令，避免把不可验证的令牌当作可恢复凭据。
- 新增仅限当前网页会话使用的 `GET /api/unit/keys/:id/command`；Bearer 访问和跨用户读取均被拒绝。
- 聚合同步面板支持多设备选择；用户尚无设备时，首次复制会创建 `default` 设备。
- 转发器在上游响应头返回前断连时不再重试同一供应商，而是切换到下一个候选，避免重复请求。
- 多用户测试显式创建设备授权；公开可见资源不再被误认为可直接使用。计量剩余额度统一读取 `user:<id>:lifetime`，与请求开始时的预留桶保持一致。

### 本轮验证

- `cargo test --manifest-path backend/Cargo.toml hub:: -- --test-threads=1`：15 项通过。
- `cargo test --manifest-path backend/Cargo.toml proxy::forwarder::tests:: -- --test-threads=1`：39 项通过。
- `npx --yes pnpm@10.20.0 typecheck`：通过。
- `npx --yes pnpm@10.20.0 exec vitest run tests/components/AggregationSyncPanel.test.tsx`：10 项通过。
- `PATH=/root/.cargo/bin:$PATH npx --yes pnpm@10.20.0 build`：前端与 Rust release 构建通过。
- `git diff --check`：通过。

### 本轮部署结果

- 部署时间：2026-10-27 17:28（Asia/Shanghai）。
- 回滚备份：`/root/ccswitchuint-backups/full-20261027T092721Z/`，包含旧二进制、旧前端、环境文件、systemd unit/drop-in、主密钥副本和 SQLite 一致性快照；备份数据库 `quick_check` 为 `ok`。
- 部署前二进制 SHA256：`6dee8fa049e094391c336173cef6f19998322f813ceaf171bb475fa1cd42d655`。
- 新二进制 SHA256：`adfedf2841477639e06aec5f72cb5f3a98bad88a72dc9669fb4786b1c89615f5`，部署文件与运行中 `/proc/<PID>/exe` 哈希一致。
- `cc-switch-web.service` 状态为 `active (running)`，监听 `127.0.0.1:8890`；路由代理恢复监听 `127.0.0.1:15721`。
- 本地和公网健康接口均返回 `{"status":"ok","mode":"local-rust-service"}`，本地与公网首页均返回 200。
- 生产数据库 `quick_check` 为 `ok`，`hub_api_keys` 已包含 `token_version`，主密钥权限为 `0600`。
- 未认证访问 `/api/unit/keys/x/command` 返回 `401`。
- 新前端入口为 `assets/index-auQzcIPj.js`，样式为 `assets/index-BayTaB62.css`。

## 新旧设备码统一与批量管理

本轮把历史设备码和当前可恢复命令的设备码收回同一套管理视图，补齐批量启停与删除能力。

- 聚合同步面板直接展示当前账号的全部可用设备码，包括仅有鉴权用途的历史设备码；历史设备码不再被隐藏，但不能恢复原同步命令，界面会明确提示。
- 已有设备码时按创建时间倒序默认选择最新设备，不再读取本地保存的旧选择；用户仍可在下拉框中手动切换。列表中已禁用或已过期的设备不参与同步设备选择。
- 设备码列表按 `created_at DESC, rowid DESC` 稳定倒序返回，并携带 `token_version`，供前端区分可恢复命令的设备码与历史设备码。
- 设备码管理新增全选、半选和逐行选择，支持单条或批量启用、禁用、删除；删除前二次确认，并提示历史请求记录会保留。
- 新增 `POST /api/unit/keys/batch`，支持 `disable`、`enable`、`delete`，单次最多处理 100 个去重 ID。接口只接受带 CSRF 的网页会话，严格按当前用户隔离并在事务内执行。
- 每个实际发生变化的设备码分别写入 `key.disable`、`key.enable` 或 `key.delete` 审计记录；删除设备码不会删除已有 `hub_requests` 历史。原单条 `DELETE /api/unit/keys/:id` 继续保持撤销语义。

### 本轮验证

- `npx --yes pnpm@10.20.0 typecheck`：通过。
- `npx --yes pnpm@10.20.0 exec vitest run tests/components/AggregationSyncPanel.test.tsx`：10 项通过，覆盖默认选择最新设备、历史设备码统一展示和首次创建 `default` 的并发防重。
- `cargo test --manifest-path backend/Cargo.toml hub:: -- --test-threads=1`：16 项通过，覆盖批量启停删、鉴权和 CSRF 拒绝、跨用户隔离以及删除审计。
- `PATH=/root/.cargo/bin:$PATH npx --yes pnpm@10.20.0 build`：前端与 Rust release 构建通过。
- `git diff --check`：通过。

### 本轮部署结果

- 部署时间：2026-10-27 17:48（Asia/Shanghai）。
- 回滚备份：`/root/ccswitchuint-backups/full-20261027T094748Z/`，包含旧二进制、旧前端、环境文件、systemd unit/drop-in、主密钥副本和 SQLite 一致性快照；备份数据库 `quick_check` 为 `ok`。
- 部署前二进制 SHA256：`adfedf2841477639e06aec5f72cb5f3a98bad88a72dc9669fb4786b1c89615f5`。
- 新二进制 SHA256：`bf5ad9a9a29ab70ba26a13590b67d0ebaf1d1ea3b0e7ec3d7a0a33eb4b101b56`，部署文件与运行中 `/proc/<PID>/exe` 哈希一致。
- `cc-switch-web.service` 状态为 `active (running)`，监听 `127.0.0.1:8890`；路由代理监听 `127.0.0.1:15721`。
- 本地和公网健康接口均返回 `{"status":"ok","mode":"local-rust-service"}`，本地与公网首页均返回 200，生产数据库 `quick_check` 为 `ok`。
- 未认证访问 `POST /api/unit/keys/batch` 返回 `401`。
- 新前端入口为 `assets/index-Bn13WSNz.js`，样式为 `assets/index-DiSMC3r1.css`；线上 HTML 引用与公网静态资源均核对为 200。

## 接入命令按当前访问地址动态生成

本轮解决“模型与接入”复制命令固定使用 `127.0.0.1:8890`、无法从其他内网地址使用的问题。

- 新增请求地址解析：优先读取首个 `X-Forwarded-Host`，其次读取 `Host`；协议优先读取 `X-Forwarded-Proto`，仅接受 `http`、`https`。
- 设备码创建、设备码命令恢复和安装脚本下载统一使用当前访问 origin，自动保留内网 IP、端口和反向代理域名。
- 模型代理地址为 loopback（`127.0.0.1`、`localhost`、`::1`），或代理主机与 `publicUrl` 主机相同时，只替换主机名并保留端口与 `/v1` 路径；只有代理主机与公开入口不同、明确指向独立域名或网关时才保持原样。生产配置中的公网 IP 代理因此也会随内网访问地址切换。
- `CC_SWITCH_PUBLIC_URL` 和平台 `publicUrl` 保留为缺少有效 Host 时的回退值，同时继续作为允许的 Origin。
- 来源校验同时接受公开 URL 和当前请求 Host 对应的 Origin，保留 CSRF token 校验；内网 HTTP 访问不会再因公网 HTTPS 配置被拒绝。
- 会话 Cookie 的 `Secure` 属性改为按当前请求协议判断，避免公网 HTTPS 配置导致内网 HTTP 登录态无法保存。
- Host 会经过 URL 解析和字符校验；无效或带路径、用户信息、空白字符的地址不会进入生成命令。

### 本轮验证

- `PATH=/root/.cargo/bin:$PATH cargo check --manifest-path backend/Cargo.toml`：通过。
- `PATH=/root/.cargo/bin:$PATH cargo test --manifest-path backend/Cargo.toml hub:: -- --test-threads=1`：20 项通过。
- 新增测试覆盖当前 Host/端口替换、`X-Forwarded-Host` 与 `X-Forwarded-Proto`、内网 Origin 放行、跨 Host Origin 拒绝、loopback 与公开入口同主机代理替换、独立外部代理保持，以及真机安装脚本内容。
- `npx --yes pnpm@10.20.0 typecheck`：通过。
- `npx --yes pnpm@10.20.0 exec vitest run tests/components/AggregationSyncPanel.test.tsx`：10 项通过。
- `PATH=/root/.cargo/bin:$PATH npx --yes pnpm@10.20.0 build`：前端与 Rust release 构建通过。
- `git diff --check`：通过。

### 本轮部署结果

- 部署时间：2026-10-28 19:34（Asia/Shanghai）。
- 回滚备份：`/root/ccswitchuint-backups/full-20261028T113352Z/`，包含旧二进制、旧前端、环境文件、安装脚本、systemd unit/drop-in、主密钥及运行配置副本和 SQLite 一致性快照；备份数据库 `quick_check` 为 `ok`。
- 部署前二进制 SHA256：`246a3ce5d3637dc7e8f32d03351d530c7492f4c7d994d5d37b424da1a29534b7`。
- 新二进制 SHA256：`67e35df0d27117bdff9a9d89078ac9089a15e7f96588bee660a2bfcf540f774a`，部署文件与运行中 `/proc/<PID>/exe` 哈希一致。
- `cc-switch-web.service` 状态为 `active (running)`，监听 `0.0.0.0:8890`；路由代理恢复监听 `127.0.0.1:15721`，启动日志无错误或 panic。
- 本地和公网健康接口均返回 `{"status":"ok","mode":"local-rust-service"}`，本地与公网首页均返回 200，公网前端入口资源返回 200。
- 生产数据库 `quick_check` 为 `ok`，版本为 20；主密钥权限为 `0600`。
- 未认证访问 `/api/unit/keys/not-a-key/command` 返回 `401`。
- 新前端入口为 `assets/index-PKy1HO1v.js`，样式为 `assets/index-DiSMC3r1.css`。
