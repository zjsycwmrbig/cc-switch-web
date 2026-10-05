# Web 跟进 cc-switch v4.0.0 迁移计划

> 状态：已完成冻结区间适用内容的迁移；195 项全部处置，Windows 前后端全量测试通过，未发布。
> 来源：`E:/zuolan_lib/AI_Hub/cc-switch`，只读使用其提交与源码。
> 起点：`f8788719`；冻结目标：`a189980f35a4568f8cf3585747895c748b8cec6a`。
> 范围：195 个提交，累计 778 个文件变化。Web 起点为 `d17a0a27`（v2.2.0）。
> 前一轮：[2026-09 迁移台账](web-parity-post-fd14f9c4-2026-09.md)。

## 1. 目标与边界

迁移该区间适用于浏览器 UI 与本地 Rust 服务的最终功能和修复。按目标提交的最终状态处理后续修复、撤销与重新引入，不直接整仓合并。逐项记录已迁移、不适用及尚待实施项，未完成项不算作已跟进。

**供应商展示约束：CC Switch Web 不添加或展示任何赞助商、合作伙伴相关的 tag、标签、徽章等标识，也不因赞助或合作关系为供应商加星标、心形标识、特殊高亮或置顶。上游预设的接入功能可以迁移，但其赞助及合作身份不作为 Web 展示或排序的依据；现有相关展示也须在本轮 UI 迁移中移除。**

**供应商排序约束：所有供应商列表及预设选择列表统一按显示名称的字母顺序（A–Z，忽略大小写）排列。官方、赞助商、合作伙伴与其他供应商遵循同一规则，不按身份分组优先或置顶，也不沿用预设文件顺序作为展示排名。**

- 保留 Web 独立数据目录、访问密钥、HTTP API、浏览器运行时、单文件分发、Docker 部署和既有 Web 定制。
- Tauri 窗口、托盘、桌面更新器、上游发行版本及专属 CI 不迁移；共享逻辑从桌面调用层拆出后适配 Web。
- 新写入引擎的设备状态、事务日志和登录暂存必须使用 Web 的数据路径，不写入桌面端的 `.cc-switch`。
- 数据库迁移使用 Web 自有版本序列，不复用上游 schema 编号。
- 上游冻结通用配置片段、移除费用倍率与连通性高级设置等行为变化纳入对应批次，保留旧数据的兼容读取并更新说明。
- 本轮不自动发布、推送、升级版本，不修改真实 CLI 配置或用户运行数据；验证使用临时目录与测试夹具。
- 不使用子 Agent。`build`、全量测试、Docker 严格验证及其他重型检查须先说明成本和必要性并单独获得授权。

## 2. 批次与依赖

| 批次 | 范围 | 关键选择与验收 | 状态 |
| --- | --- | --- | --- |
| 1a | 预设、定价、图标、MiniMax 预设兼容数据 | 同步目标数据；保留 Web 类型限制；预设、目录、图标、定价定向测试 | 已完成 |
| 1b | MCP、Skills、Prompts、OpenCode JSONC/V2、工具生命周期及独立协议修复 | 按依赖拆分；损坏输入不覆盖配置；局部回归测试 | 已完成，见提交矩阵 |
| 1c | models.dev 模型能力补全、MiniMax 自选 Provider Key | 按字段补缺，不覆盖用户值；新建、编辑、重复 key 测试 | 已完成，含 MiniMax、五类表单与 Pi 结构化编辑/补全 |
| 2 | 关键字段写入引擎及 Claude/Codex/Gemini/Grok/Desktop 接入 | 无关配置保留、事务中断恢复、并发冲突、凭据隔离、旧状态迁移；先引擎再调用层 | 已完成，四类 CLI、Desktop 与 Web 编辑器接通 |
| 3 | Direct / Routing / Aggregation 模式与剩余代理修复 | 依赖批次 2；新增 Web API 与客户端；模式切换、服务重启失败回滚、聚合模型路由测试 | 已完成，含官方路由会话桶与握手回退 |
| 4a | 侧栏、全局页面、供应商编辑器、账号中心 | 依赖批次 2/3；适配浏览器；移除赞助/合作标识，所有供应商按显示名称 A–Z 排序；验证页面导航与主要操作 | 已完成，保留 Web 布局与展示约束 |
| 4b | 用量、额度、会话阅读器、性能优化 | 分页、热力图、结构化消息、搜索、图片与缓存；类型检查与组件/服务定向测试 | 已完成，含结构化会话、额度与虚拟列表 |
| 5 | 文档与台账收口 | 每项提交有处置；同步 CHANGELOG、受影响正式文档及三语 README；说明验证覆盖和未验证项 | 已完成，提交集合与上游区间精确匹配 |

## 3. 实施方式

1. 使用 CodeGraph 定位调用与依赖，再对比冻结基线、Web 当前文件和目标文件。完全一致的基线文件优先同步；存在 Web 改造的文件按接口与行为适配。
2. 每个子批次闭环：源码、相关测试、必要文档、定向验证与台账一起更新。保留上游有效的行为测试，不用快照数量代替行为验证。
3. 上游测试依赖 Tauri 的部分改成 Web 服务入口或模块单测；前端运行时调用统一通过现有 Web 适配层。
4. 废弃设置与 API 在替代链路可用后移除。上游中间态与最终状态冲突时采用冻结目标的最终状态。
5. 范围或关键方案发生实质变化时先说明并等待批准；授权内的局部修正持续完成。

## 4. 验证与完成标准

- 每批运行受影响的 Vitest 文件及可控范围的 Rust 定向单测；TypeScript 类型检查用于发现跨模块契约问题。
- 配置/凭据测试必须使用临时目录，覆盖用户自定义字段、注释、非 UTF-8/损坏输入的拒绝路径，以及多账号边界。
- 新 UI 就绪后进行浏览器检查；核心操作包括供应商增删改切换、模式切换、MCP/Skills、用量筛选与会话阅读。
- 检查供应商列表及预设选择列表均按显示名称 A–Z 排序，忽略大小写；官方或合作身份不影响顺序，且不出现赞助/合作标签、星标或特殊高亮。
- 重型验证未授权前不运行；最终报告明确记录哪些检查通过、失败或未运行。
- 收口要求：195 项提交全部有明确处置；无待定关键行为；受影响文档一致；不以部分批次完成宣称整个 v4.0.0 跟进完成。

## 5. 执行记录

以下按实施时间保留阶段快照；早期的“下一步”“尚未完成”和未验证项描述当时状态，最终结论以本节末尾、第 6 节统计及第 7 节验收边界为准。

- 2026-10-04：完成区间审计；确认来源工作树的 HEAD 与 `origin/main` 一致。初始化来源仓库 CodeGraph、同步 Web 索引。创建本计划并启动批次 1a；尚未运行构建或全量测试。

- 2026-10-04：批次 1a 源码已接入，保留 Codex 的 Web `providerType` 限定；MiniMax 仅有格式差异，按目标逻辑同步。图标保留 Web 的 PNG/SVG 分层加载方式。
- 2026-10-04：预设与相关组件/工具定向测试 29 文件、600 项通过；追加搜索别名回归后选择器 20 项通过（累计覆盖 601 项）。TypeScript 类型检查通过。新增关键字段预设契约测试，避免预设再次携带客户端全局选项。
- 2026-10-04：用户明确授权本轮 Rust 定向测试所需编译，不包含全量测试、发布构建和 Docker 严格验证。实际 Cargo 缓存位于全局构建目录，可复用依赖；首次类型检查发现额度返回类型及未迁移的可选 USD 字段差异，已按 Web 接口适配。首次运行 29/30 通过，补齐上游重置时间对非正值的过滤后重跑。
- 2026-10-04：推进批次 1b 的 Codex MCP、非托管 Skills 目录、未启用 Prompt 文件保留修复；新增/移植局部 Rust 回归，验证中。同步三语 README 和 CHANGELOG，明确整体迁移尚未完成。

- 2026-10-04：Rust 局部验证收口：`cargo test --locked --manifest-path backend/Cargo.toml --lib -- services::coding_plan::tests database::tests::model_pricing_seed mcp::codex:: mcp::grokbuild:: services::skill::tests::sync_to_ services::prompt::tests --test-threads=1`，62/62 通过，无编译警告。使用 Windows 原生测试与临时目录/本地 HTTP 夹具，未调用真实供应商接口。
- 当前未执行：全量测试、发布 build、Docker 严格验证、Linux/macOS 编译和浏览器视觉验收。本轮没有发布或改动用户运行配置。
- 下一步：继续批次 2 的 Claude/Codex/Gemini/Grok 运行时写入与编辑 API，连接已验证的纯投影，处理 Codex 登录保留与 Grok 已写模型表状态；批次 1b 的工具生命周期及剩余代理修复仍待实施。Desktop 公开入口随批次 3/4a 接入，1c 的 Pi 补全入口随 4a 编辑器接入。后续实施沿用当前批准，无需重新审批相同范围。

- 2026-10-04：落实 Web 供应商展示约束：移除合作星标、心形、推广面板与拖拽排名，已保存供应商、共享预设、Pi、通用供应商及模型目录供应商筛选统一按显示名称 A–Z 排列（忽略大小写）。旧身份/排序字段仅作数据兼容；故障转移优先级属于执行语义，保持原规则。同步三语 README、CHANGELOG 与 Pi 界面规范。11 个受影响 Vitest 文件、79 项测试通过，TypeScript 类型检查通过；未运行浏览器视觉检查。

- 2026-10-04：批次 1b 继续落地 MCP 同应用逐条容错、数据库完整空闲页回收、GPT-6 Sol/Luna max 档位、Codex OAuth 生成请求客户端版本 0.159.0、终结事件 WebSearch 顺序与工具调用，以及 OpenCode V2/混合数据库会话支持。保留 Web 路径解析和 `opencode session resume` 命令；用量导入及 OAuth 模型发现缺少的基础链路已在对应行明确记录。
- 本轮新增 Rust 定向验证 112/112 通过，无编译警告：MCP 模块 6 项；数据库回收、OAuth 身份、max 档位及 Responses 流式模块 93 项；OpenCode 会话模块 13 项。使用临时目录/数据库，未接触用户实际配置或会话。加上前批已通过的 62 项，累计覆盖 174 项不同 Rust 测试。未执行全量测试、发布构建、Docker 严格验证或浏览器视觉验收。

- 2026-10-04：批次 1b 完成 OpenCode 原始 Provider 字段保留、内置供应商局部覆盖编辑与 JSONC 无损写入三项迁移。共享 JSONC 编辑器同时供 OMO 使用，保留 Web 路径、导入已有记录跳过规则与 MCP 接口；不接管原生凭据库。后端 61 项不同定向测试通过，覆盖注释、CRLF、Unicode、损坏输入、外部修改、原始字段往返及 OMO 回滚；Windows 未运行 Unix 符号链接专属用例。前端 3 文件共 22 项定向测试通过（表单 10、App 7、添加弹窗 5），TypeScript 类型检查通过；三语 README 与 CHANGELOG 已同步。

- 2026-10-04：批次 1c 完成 MiniMax Code 自选标识、五类表单模型能力补全、共享目录缓存与原厂兜底修复。MiniMax 后端 9 项通过、1 项真实 API Key 用例跳过，前端 20 项通过。模型补全/价格同步 13 文件 125 项通过，TypeScript 检查通过；修复测试环境 jsdom AbortSignal 与 Node Request 不兼容的问题，保留原有业务请求取消逻辑。Pi Web 当前仍为模型 JSON 编辑，未具备上游结构化选择入口，相关两条提交保留待实施/部分迁移，随 4a 接入。

- 2026-10-04：本轮收口验证：因统一测试取消信号环境并补齐模型下拉供应商 A–Z 排序，联合运行受影响的 18 个 Vitest 文件，154/154 通过；TypeScript 检查与 `git diff --check` 通过。OpenCode 和 MiniMax 两组 Rust 定向验证共 70 项不同测试通过、1 项真实凭据测试跳过。三语 README、CHANGELOG 和台账已同步；未运行全量测试、发布构建、Docker、跨平台编译或浏览器视觉验收。

- 2026-10-04：批次 1b 新增 MiniMax Code 版本与原生安装目录探测、安装命令复制；Web 尚无自动安装/升级 API，相关生命周期提交已明确列为待实施。代理补齐成功流式请求缺少 Content-Type 的 SSE 识别，以及第三方 Responses 迟到参数修复，保留 Web 超时和用量记录。相关 18 项不同 Rust 测试通过。
- 2026-10-04：补齐 OpenCode 用量导入并接入自动/手动会话同步，复用 Web 的 XDG/home 路径；V2 优先于 V1，采集压缩用量、推理 token，读取 WAL 新数据，未完成或写入失败时保留重试入口。16 项 Rust 定向测试通过，包括临时数据库 V1→V2 去重、源文件不变、WAL 未 checkpoint、补录与失败重试；未读取真实用户会话。
- 2026-10-04：修正上一轮测试环境适配：恢复 jsdom 的 DOM AbortSignal，仅替换兼容的 fetch/Request，保留原生 Response。关于页、表单、模型补全、设置与应用回归 21 文件 180 项通过、2 项原有跳过；用量面板追加 2 文件 3 项通过。本批共覆盖 23 个前端文件、183 项通过及 34 项不同 Rust 测试通过。TypeScript、局部 Prettier 和 diff 检查通过；CodeGraph 已同步。三语 README、CHANGELOG 与台账同步，整体迁移仍未完成；未运行全量测试、发布 build、Docker、跨平台编译或浏览器视觉验收。

- 2026-10-04：批次 1b 完成 Claude/Codex Chat 的 `<think>` / `<thinking>` 分离，覆盖跨片标签、工具边界、结束事件、EOF 与异常 flush，保留正文缩进；Grok Build 回填时恢复仍存在的供应商默认模型表并保留其它客户端改动。MiniMax 空列表改用原生配置自动读取说明，Pi 保留 Web 既有导入入口。提前接入批次 4a 的 API Key 必填提示，使用 `aria-required` 保留空 Key 保存确认流程；官方、云厂商与禁用字段除外。
- 2026-10-04：启动批次 2，接入 JSON/TOML/dotenv 关键字段补丁器、首写备份、同应用锁、乐观并发检查、多文件 staged 写入与 pending 日志恢复。状态和备份使用 Web 数据目录（默认 `.cc-switch-web`）。JSON 保留键顺序与值，但首次写入可能规范化空白和转义；TOML/dotenv 保留未修改部分格式与注释。
- 2026-10-04：Claude Desktop 后台切换、首条新增及当前供应商编辑接入独立 profile 写入，文件与 current 指针共同恢复；切回官方仅清除网关字段，保留用户设置，损坏 meta 拒绝覆盖。启动时先恢复 pending 操作。Desktop 公开应用解析仍未开放，不代表浏览器端已可用；其公开入口、通用配置提取及其它应用投影仍待后续批次，`81df5a08` 保持“部分迁移”。
- 2026-10-04：本批按测试名去重共 331 项 Rust 定向测试通过，未解决失败 0；最终引擎组 87/87 通过且无编译警告，覆盖 Windows 原子替换失败、多文件中断恢复、Desktop/Claude Code 路径隔离及 Grok 回填。测试使用临时目录与环境隔离，未写入真实客户端配置。前端 9 文件、65 项不同测试通过，修正旧标签断言后通过复测；TypeScript 类型检查通过。三语 README、CHANGELOG 与台账已同步，CodeGraph 索引已更新。未运行全量测试、发布构建、Docker、Linux/macOS 编译或浏览器验收；Unix 权限专属测试未在 Windows 运行。

- 2026-10-04：批次 2 接入四应用纯投影及上游行为测试，覆盖 Claude Bedrock 旧 Key 与独有字段清理、Codex 路由和凭据边界、Gemini 双文件关键字段、Grok 模型整表替换与已写表清理。纯投影尚未接入四应用运行时；该模块临时以有说明的 `allow(dead_code)` 保留，接线时移除。通用配置提取规则已生效，Web 尚保留片段流程，因此适配旧片段回填清理，新增实际 Claude 切换与 Codex 回填回归。含凭据文件改用私有原子写入，保持 Web 的 Codex 账号隔离与回滚行为。

- 2026-10-04：本批最终 Rust 定向验证 293 项通过、0 失败、1 项原有真实 API Key 用例跳过；首组 42 项已包含在最终结果中，不重复累计。覆盖纯投影、旧片段提取/回填、供应商切换、配置原子写入、Codex 账号隔离和 Grok 配置。首次扩大验证的两项旧预期/夹具失败已修正复测；最终无编译警告，局部 rustfmt 与 diff 检查通过。新增 Unix 新建/替换文件 0600 用例，但本机 Windows 不执行；未运行全量测试、发布构建、Docker、跨平台或浏览器验收。本批没有前端源码变化，复用前批类型与组件检查结果。最终日志：`%TEMP%/ccswitch-projection-extraction-final2-rust.log`。

- 2026-10-05：用户明确授权持续完成已批准迁移计划，无需逐批重复询问。仍不自动发布、推送或操作真实运行数据，不使用子 Agent。
- 2026-10-05：Claude Code 关键字段运行时与 Web 编辑器接通。新增 `/api/providers/claude/editor/view` 和 `/api/providers/claude/editor/save`，编辑上下文独立传输，不进入 Provider 数据。编辑任意供应商的全局改动立即生效，关键字段仅作用于当前直连或代理目标；旧字段仅兼容保存并提示。加载失败阻止保存并可重试，默认冲突拒绝并保留窗口；API 支持 keepMine/keepTheirs，交互选择弹窗随编辑器 UI 批次收口。旧 API 继续只保存供应商字段，Claude 通用片段不再合并、回填或迁移。旧代理保留现有鉴权与模型别名，只通过引擎写入关键字段，保留用户全局设置；最近实际写入的独有字段随 pending 提交，以便退出代理按值清理。残留备份沿用 Web 原有归属判定，不阻止正常直连编辑。

- 2026-10-05：Claude 本批 Rust 供应商/代理定向测试 104/104 通过，前端 5 文件 24/24 通过，TypeScript 检查通过；包含旧备份正常直连编辑、三方冲突恢复行/备份、代理编辑原子写入及 published:0 恢复。未运行全量测试、发布构建、Docker、跨平台或浏览器验收。最终日志：`%TEMP%/ccswitch-claude-runtime-final3.log`、`%TEMP%/ccswitch-claude-editor-final-ui.log`。

- 2026-10-05：Gemini 直连切换、新增/编辑、统一供应商重投影接入双文件引擎；旧代理以 env-only 补丁桥接，保留原接管契约。编辑器复用实时快照、按叶子比较全局 JSON 和按变量比较 env，官方分类按数据库旧行识别。旧通用片段冻结，预设/自定义切换保留全局基底；低层整份写入与损坏 JSON 静默覆盖路径移除。新增 `/api/providers/gemini/editor/view` 与 `/api/providers/gemini/editor/save`；与 Claude 共用快照 hook、独立上下文传输及默认拒绝冲突策略。
- 2026-10-05：Gemini 本批 Rust 定向 127/127 通过（供应商/代理/Gemini 配置），前端 7 文件 33/33 通过；覆盖损坏第二个文件时不改 env、published:0 双文件与指针恢复、OAuth 文件不变、非当前供应商全局编辑、预设与自定义切换保留基底。类型检查通过；未运行全量测试、发布构建、Docker、跨平台或浏览器验收。日志：`%TEMP%/ccswitch-gemini-final-rust.log`、`%TEMP%/ccswitch-gemini-final-ui.log`。

- 2026-10-05：Grok 运行时切换、新增/编辑与旧代理写入接入引擎，模型表写入记录和 current 随 pending 恢复。新增 `/api/providers/grokbuild/editor/view`、`/api/providers/grokbuild/editor/save`；复用 TOML 三方比较，新增预设以全局基底构建，官方卡保留稳定 seed 流程并保存全局编辑。按实际 `models.default` 判断编辑基底的所属表，避免把用户唯一的未选中模型表误判为供应商表。没有可恢复凭据时，旧代理退出清理已写表，而不写回空 Key 模型表。
- 2026-10-05：Grok 本批 Rust 定向 125/125 通过；前端初次联合测试 36 通过、2 项异步加载夹具失败，修复等待并新增回归后相关 3 文件 21/21 通过，复用另 4 文件 19 项通过，去重共 40 项通过。TypeScript 与 diff 检查通过。覆盖 CLI 改默认模型后清理旧表、保留用户表/MCP、损坏 TOML 回滚行、published:0 恢复写入记录、新增基底与官方 seed 编辑上下文。未运行全量测试、发布构建、Docker、跨平台或浏览器验收。日志：`%TEMP%/ccswitch-grok-runtime-rust.log`、`%TEMP%/ccswitch-grok-ui.log`、`%TEMP%/ccswitch-grok-ui2.log`。

- 2026-10-05：开始 Codex 接线，先移植 `codex_login` 纯登录去向规划器及 10 项上游测试，全部通过。Web 登录暂存文档路径改为 `.cc-switch-web`；该规划器尚未接入运行时，既有 Codex 写入行为此时不变。模型目录规划、原生登录暂存与托管账号标记事务接线继续进行。日志：`%TEMP%/ccswitch-codex-login-rust.log`。

- 2026-10-05：Codex 运行时与 Web 编辑器接通。直连切换、新增/编辑、统一供应商重投影、同步和旧代理恢复经引擎保留全局 TOML；登录暂存、托管账号标记、配置与生成目录共同提交。原生登录按身份暂存/恢复，托管账号沿用 Web 稳定用户身份及 CLI refresh CAS 校验；损坏 auth/暂存文件拒绝覆盖。旧代理接管保留既有选路契约，只替换关键字段；备份省略 auth 表示保留接管期间的原生登录。旧 Codex 整份写入入口移除，片段冻结。
- 2026-10-05：新增 Codex editor view/save API，表单新建/预设保留全局基底，旧前端实时 auth 回填逻辑移除。Claude/Codex/Gemini/Grok 共用冲突选择弹窗，支持 keepMine/keepTheirs 和继续编辑，重试保持原 base 和草稿；跨窗口陈旧响应不弹出冲突框。
- 2026-10-05：Codex 最终后端定向验证 258/258 通过，无编译警告（供应商、代理、Codex 配置）；前端新增/编辑/冲突与操作回归 6 文件 44/44 通过，另前批 Codex 表单字段/快照测试通过，避免重复累计。TypeScript 检查通过。覆盖登录暂存恢复、账号删除/重新绑定、全局配置与注释保留、损坏暂存拒绝、published:0 恢复、inline 路由表和保存时切换 auth store。三语 README 与 CHANGELOG 已同步。日志：`%TEMP%/ccswitch-codex-final-rust.log`、`%TEMP%/ccswitch-conflict-ui.log`、`%TEMP%/ccswitch-codex-final-tsc.log`。未运行全量测试、发布构建、Docker、跨平台或浏览器验收；新模式/官方模型发现和其余矩阵仍待实施。

- 2026-10-05：继续新模式基础：直连指针与代理路由独立，四应用控制器接入契约；聚合成员使用永久 key，名单和客户端目录随 pending 一起发布。Claude 角色别名与模型发现、Codex 分供应商模型目录/窗口、官方模型身份及版本缓存、客户端目录代次已接入；供应商名单按名称 A–Z。请求按聚合 ID 直达成员，无法解析时按客户端协议拒绝，不回退另一家。
- 验证：聚合名单/官方缓存/目录代次/控制器首组 38 项通过；随后请求入口、实际本地 HTTP 转发及成员控制 11 项通过（与首组重叠，不相加）。覆盖转发成功、失败、签名修复重试仍保留所选模型且不改路由统计。由集成测试发现的 Rustls 双加密提供者自动选择 panic 已修复：两个代理 TLS 构造器显式使用 ring。
- 前端编辑生命周期补充：旧请求延迟成功也不能关闭重开的编辑窗口；该文件 8 项通过。新模式的正常退出/启动恢复、旧备份归档正在定向验证；尚未替换旧 Web 模式 API、启动入口、供应商 CRUD/编辑器重投影与故障转移控制，不对外宣称聚合已可用。其余批次和 195 项清单继续执行。

- 2026-10-05：聚合后台联合组 231/231 通过（包含前述 38/11 等重叠组，不相加）。四应用保存接入服务锁→应用锁→事务；新模式下不再生成旧快照，重投影保持直连与路由独立。新增 Codex 成员目录冲突／发布、Gemini／Grok 全局编辑、同步与 current 回归，最终相关组 27/27 通过。
- 2026-10-05：新增 mode/member/restart Web API；兼容 takeover/start/stop 改走新控制器。启动恢复和官方目录后台检查已接入；正常退出先排空 Web 请求、撤回客户端，再停服务，撤回失败恢复 Web 入口。监听绑定失败恢复原端口（包括随机端口测试），全局设置不覆盖每应用重试／超时。Profile 快照／比较按实际路由读取。
- 2026-10-05：Claude Desktop 公开标识与独立保存接通，映射卡维持服务、离开时按其他应用需求停止。定向测试先发现嵌套 futures 执行器与单线程运行时阻塞，改为同步 DB 读取及 Web 阻塞线程池边界后，模式／Desktop／HTTP／Profile 22/22 通过，无编译警告。日志 `%TEMP%/ccswitch-mode-blocking-boundary.log`。
- 2026-10-05：浏览器新增模式查看及确认启用、聚合成员加入／移除和更多菜单默认项、Claude 自定义聚合模型列表、Codex 目录提示、设置页保存重启。模式选项与成员保持名称 A–Z，不引入星标。切应用清空旧列表，直连和代理默认均禁用删除。6 个受影响前端文件 21/21 通过，TypeScript 检查通过；未做浏览器视觉验收。三语 README、CHANGELOG 与正式路由说明同步。整体 195 项迁移继续，尚未完成。

- 2026-10-05：GPT 官方目录镜像 130/130 定向测试通过；模式/导航前端回归 13/13 通过。浏览器以完全拦截 API 的内存夹具检查聚合启用确认、默认选项 A–Z、Gemini 不提供聚合和 390px 页面无横向溢出；未连接真实后端。截图位于 `.playwright-cli/mode-aggregation-desktop.png` 与 `mode-gemini-mobile-stable.png`。
- 2026-10-05：Codex V2 compaction 与 opaque-state 重试接通。纯转换/流式/rectifier 303/303 通过；本地 HTTP/聚合隔离/目录代次联合组 12/12 通过（与前批目录组重叠，不相加）。首轮 HTTP 夹具缺少 TOML base_url 导致失败，补齐夹具后通过；没有调用真实供应商。日志 `%TEMP%/ccswitch-compaction-first.log`、`%TEMP%/ccswitch-compaction-http-second.log`。
- 2026-10-05：新增 Codex daemon 确认重启入口、模式启动恢复错误提示；设置保存移至阻塞线程池。前端模式/导航 12/12 通过，后端恢复错误/compaction/daemon/Web 入口 27/27 通过；清理过渡 dead-code helper 后联合 25/25 通过且无警告。

- 2026-10-05：批次 4b 接入 SSE 用量过滤/首输出计时、Claude 最后分块补全和 Claude/Codex 会话估算时长。SSE/compaction 10/10 通过，session usage 77 通过、1 个原有用例跳过；精确/估算速度、详情 JOIN 与 Web 模式联合 11/11 通过，格式化与详情组件 20/20 通过（重叠不相加）。
- 2026-10-05：新增全部时间和 53 周热力图、单指标趋势、四表分页、应用图标筛选；保留 Web 会话同步开关和定价入口。移除费用倍率配置/API，保留历史数据兼容；models.dev 默认同步尊重旧关闭设置。六个 usage API 使用阻塞线程，追加范围去重和总数缓存。后端联合定向 71/71 通过、无警告；前端 10 文件 27/27 通过。类型检查通过，补算历史倍率与浏览器验收继续收口。日志 `%TEMP%/ccswitch-usage-cost-rust3.log`、`%TEMP%/ccswitch-usage-final-ui.log`。

- 2026-10-05：用量收尾：历史补价倍率回归所在 stats 13/13 通过；浏览器内存 API 夹具确认 53 周热力图、供应商 A–Z 与 20 行分页、390px 无页面横向溢出、无用量时成本定价仍可达。0 控制台错误，2 项图表初始化尺寸提示；没有连接真实后端。
- 2026-10-05：额度批次接入剩余额度/常显倒计时/点击刷新反馈、ChatGPT 可用重置次数及到期分组，Claude/Grok refresh_pending，账号与卡片共享缓存及确定性错误失效。Rust 定向 53/53、前端 6 文件 71/71、账号切换隔离 1/1 通过；类型检查通过。日志 `%TEMP%/ccswitch-quota-rust2.log`、`%TEMP%/ccswitch-quota-ui3.log`、`%TEMP%/ccswitch-quota-scope.log`。额度浏览器验收继续，整体未完成。

- 2026-10-05：MCP 表单接入结构化连接字段、JSON 密文掩码、JSON/TOML/OpenCode 粘贴识别和批量跳过/覆盖；保留 Web 全屏面板、错误翻译和写入 API。隐藏应用只影响显示，批量覆盖保留其原有开关。定向 3 文件 24/24、TypeScript、diff 检查通过；浏览器内存夹具确认密文改键阻止保存、正常修改不丢凭据/扩展字段、390px 无页面横向溢出。
- 2026-10-05：额度浏览器补验通过：卡片重置次数展开到期列表、点击刷新出现成功反馈、390px 无页面横向溢出。额度与 MCP 浏览器均只写内存夹具，未接真实后端或 CLI。证据 `.playwright-cli/quota-reset-desktop.png`、`quota-reset-mobile.png`、`mcp-form-mobile.png`。

- 2026-10-05：Pi 模型字段结构化编辑、获取列表与 models.dev/预设能力补全接通，JSON 双向同步并保留未知字段；思考映射按模型级协议覆盖判断。补齐 Web model-fetch 的协议/自定义 Header 认证及错误体凭据过滤。服务/命令定向 20/20（含本地 HTTP）、首组前端 28/28，随后卡片/Pi 组 23/23、导航组 14/14 通过（重叠不累加）。类型检查通过。
- 2026-10-05：Pi 浏览器内存夹具验证模型拉取协议参数、选择模型、修改窗口/思考映射、保存扩展字段和 390px 布局。顺带修复 Pi/Claude Desktop 页签刷新恢复，卡片按钮改常显，移除会遮挡点击的悬停绝对定位。日志 `%TEMP%/ccswitch-pi-fetch-http-rust.log`、`%TEMP%/ccswitch-pi-editor-ui.log`、`%TEMP%/ccswitch-pi-card-ui.log`；截图 `.playwright-cli/pi-models-mobile.png`。未执行真实 Pi 或供应商联调。

- 2026-10-05：工具生命周期已接入受访问密钥保护的 `/api/tools/{versions,installations,action}`，仅接受九工具白名单与 install/update。保留原 Web 关于页版本 API；应用页支持安装来源、多处安装确认、WSL 参数、诊断结果自动展开、跨页面任务保留与应用可见性。Rust 15/15、前端 25/25、类型检查通过；浏览器 mock 检查升级预览/取消和 390px，无横向溢出。清除桌面启动冗余代码。测试仅临时夹具，未实际安装升级；Homebrew 分支静态核对，未运行 macOS/Linux 测试。日志 `%TEMP%/ccswitch-tools-rust3.log`、`%TEMP%/ccswitch-tools-ui2.log`；截图 `.playwright-cli/apps-tools-mobile.png`。

- 2026-10-05：结构化会话阅读器迁入九来源解析、Hermes state.db/JSONL、缓存、按需长内容和图片；浏览器通过认证 HTTP NDJSON 消费分块。API 校验会话根目录、SQLite 来源和内容引用，图片响应不嗅探且不缓存。Markdown 改为浏览器下载，本地路径仅复制。保留 Web OPENCODE_DB/XDG/测试目录约定与用量读取桥接。会话相关 Rust 扩展定向 339/339 通过、2 项原有忽略；含新增真实本地 HTTP 分块/分页/越界拒绝及单会话用量测试。前端阅读器/纯函数/缓存 111/111、列表18/18、Web传输3/3（不重复累计）。类型检查通过；浏览器桌面和390px阅读、费用展示通过，发现并补回旧标题翻译键。日志 `%TEMP%/ccswitch-sessions-http-rust.log`、`%TEMP%/ccswitch-sessions-page3.log`、`%TEMP%/ccswitch-sessions-transport.log`，截图 `.playwright-cli/sessions-reader-*.png`。

- 2026-10-05：完成全局侧栏、账号中心和 Hermes 双草稿页面；托管 ChatGPT 模型发现接通 Web API，恢复 HTTP 环境的降级复制。MCP/Skills 接入重新同步、失败仓库/ZIP 跳过诊断、真实存储路径、乐观开关和虚拟列表；批量操作限制在筛选结果，并支持仅撤销成功条目。
- 2026-10-05：补齐 Codex 官方代理的 426 握手回退、version 请求头过滤及监听地址识别；官方路由无 auth.json 时仍可识别。新增编辑器固定使用 Web 空行投影来源，避免保存时误收客户端独有字段。空 Key 草稿、损坏/缺失 marker、模式会话桶均有回归。额外核对补齐 Claude 代理读取 AWS_BEARER_TOKEN_BEDROCK，兼容旧顶层 apiKey。
- 2026-10-05：提示词新增跨应用复制，创建未启用独立记录，部分失败只重试失败目标；后台和手动会话扫描共享完成时间，新增只读 API 与用量显示。预设搜索补齐域名匹配，仍统一按名称 A–Z。
- 2026-10-05：本次最终核心 Rust 68/68、资源/MCP/Skills/OAuth 模型 Rust 38/38 通过；前端联合 16 文件 87/87，追加提示词/用量/资源/预设组最终 8 文件 33/33（预设旧断言修正后 20/20）；MCP 追加撤销回归 2/2。各组有重叠，不相加作为唯一测试总数。日志 `%TEMP%/ccswitch-final-core2.log`、`ccswitch-final-resources.log`、`ccswitch-final-ui1.log`、`ccswitch-final-ui2.log`、`ccswitch-final-presets.log`、`ccswitch-final-mcp-undo.log`。前端第二组原日志保留两项旧搜索契约失败，最终预设日志证明复测通过。
- 2026-10-05：浏览器全 API mock 验证桌面侧栏展开前后正文尺寸不变，390px 账号/记忆/Skills 无横向溢出，Hermes 切文件草稿保留，180 条已安装 Skills 与 450 条发现结果虚拟渲染、滚动可到末项；重新同步部分失败可见。截图位于 `.playwright-cli/`。此前模式、用量、会话阅读器的浏览器结果继续复用。

- 2026-10-05：最终收口完成。Claude 适配器定向测试 33/33 通过（含 Bedrock 环境变量凭据）；MCP 撤销测试修正 TypeScript 类型收窄后 2/2 复测通过，`pnpm exec tsc --noEmit` 与 `git diff --check` 通过。日志 `%TEMP%/ccswitch-final-claude-auth.log`、`ccswitch-final-mcp-undo2.log`、`ccswitch-final-tsc8.log`。CodeGraph 同步成功；其动态引用仍有未解析项，不能代替测试结论。
- 2026-10-05：台账 195 个唯一提交 hash 与上游冻结区间集合精确一致，无漏项、重复项或额外项。三语 README 的迁移范围、功能与限制已对齐；三语 README、CHANGELOG、台账及两份相关正式指南的本地 Markdown 链接检查通过。所有批次完成，改动保留在工作树，未提交、推送或发布。

## 6. 提交处置矩阵

当前统计：已迁移（含 Web 适配）176 项；不适用 19 项；待审计、部分迁移及待实施均为 0 项。


以下为完整区间清单。按实际迁移与验证结果更新；文档、发布和桌面专属提交在核对后标记不适用。

| 提交 | 上游内容 | Web 处置 | 状态 |
| --- | --- | --- | --- |
| `3ed58925` | fix(ui): desaturate inactive brand-colored icons in app switcher | AppSwitcher/WebSidebar 非当前应用图标灰度；保留 Web 图标体系 | 已迁移 |
| `a06a41ec` | docs(sponsor): update FluxA paid API count to 13,000+ | 上游赞助商宣传数据；按 Web 无赞助/合作展示约束不迁移 | 不适用 |
| `993ce2f3` | fix(codex): raise OAuth client identity to 0.155.0 for GPT-6 Sol/Luna (#7597) | 生成与托管账号模型发现共享最终 0.159.0 客户端身份；新增 OAuth 模型 API 和表单拉取 | 已迁移 |
| `79bdae47` | fix(proxy): preserve max effort for GPT-6 Sol and Luna (#7662) | 1b：GPT-6 Sol/Luna 保留 max；解析器及 Responses 转换回归通过 | 已迁移 |
| `9df49ef5` | fix(detect): upgrade Homebrew Casks via brew --cask instead of npm (#6572) | 1b：识别 Homebrew Cask 来源并生成 brew --cask 升级命令；Windows 本轮未执行 macOS 命令 | 已迁移 |
| `65d0d741` | feat(about): add MiniMax Code install/update detection | 1b：九工具安装/升级 API 与应用页接通；MiniMax 非 TTY 使用官方安装器/npm，纯命令回归通过 | 已迁移 |
| `9154f418` | fix(mcode): replace misleading empty-state copy that points to a missing import button | 1b：MiniMax 空列表说明自动读取原生自定义供应商，不再提示手动导入；Pi 保留 Web 既有导入入口 | 已迁移 |
| `bc4cce04` | feat(mcode): pass Pi model compat through to MiniMax Code presets | 1a：MiniMax 兼容参数透传与 adaptive effort 映射，过滤不支持参数；5 项预设回归通过 | 已迁移 |
| `8ab8eebd` | fix(updater): upgrade Codex standalone installs in place instead of via npm | 1b：Codex standalone 根据已检测目录原地升级；POSIX/Windows 路径识别定向回归通过 | 已迁移 |
| `913a3bf2` | docs(readme): refresh stale facts across all four READMEs and add a tagline and quick nav | Web 三语 README 使用自身安装、部署、版本与能力说明，不复制桌面宣传和赞助导航 | 不适用 |
| `854c9f5f` | docs(readme): restructure all four READMEs and move dev docs to CONTRIBUTING | 保留 Web 三语 README 与 docs/docs-dev 分工；上游四语 CONTRIBUTING 重组不直接迁移 | 不适用 |
| `0555c09d` | docs(readme): use support@ccswitch.io as the sponsorship contact | 上游赞助联系地址；Web 不展示赞助合作信息 | 不适用 |
| `bf5f34d0` | fix(codex): add vision-capable glm-5.3-flash to Zhipu GLM presets (#7689) | 1a：Codex 智谱 GLM-5.3-Flash 视觉模型与目录测试 | 已迁移 |
| `e0f70019` | docs(guides): refresh Codex guides for native Responses presets and the renamed auth toggle | Web 路由指南补齐原生 Responses、官方认证回退边界和托管模型发现 | 已迁移 |
| `1ee2fdc3` | docs(user-manual): refresh the zh/en/ja manual for v3.20.4 | 上游桌面用户手册不属于 Web 文档树；Web 正式指南和三语 README 按实际入口更新 | 不适用 |
| `f33f9c41` | fix(grokbuild): keep provider model table selected when backfilling live config | 1b：Grok live 默认模型缺失或悬空时，回填恢复仍存在的供应商模型表；保留客户端其它改动与 MCP 隔离 | 已迁移 |
| `2185498e` | fix: stop shared config and live files from leaking provider settings | 四应用关键字段提取、私有原子写入、旧片段冻结已闭环；common_config_tests 覆盖不回填旧字段 | 已迁移 |
| `bcb83d7c` | test: add golden tests that lock live-config behavior before the switching refactor | 将适用的黄金行为纳入 Web 投影、事务与四应用运行时定向回归；不引入 Tauri 集成夹具 | 已迁移 |
| `46fa2e0e` | refactor(usage): drop per-provider and global cost multipliers | 4b：移除倍率表单/API/DAO，新代理日志倍率固定 1；旧 meta/数据库列兼容保留，历史补价使用记录倍率 | 已迁移 |
| `b9c27393` | fix(database): reclaim the whole freelist on incremental vacuum | 1b：启动/周期维护读完 incremental_vacuum 的全部结果行；空闲页回收回归通过 | 已迁移 |
| `81df5a08` | feat: add a key-field write engine for client config files | 2：关键字段引擎、格式补丁器、首写备份、多文件日志恢复、四 CLI 与 Desktop 运行时/公开编辑入口已接入；设备状态使用 Web 数据目录 | 已迁移 |
| `63ed5002` | feat(claude): switch Claude Code by replacing only key fields | 2/3：Claude 切换/新增/编辑/同步及新模式契约统一走关键字段事务；全局编辑三方冲突可选择保留值；旧片段冻结 | 已迁移 |
| `15c0b3ce` | feat(proxy): keep a per-app direct/proxy mode instead of backing up live files | 3：独立直连指针与代理路由，启停/重启/启动恢复/正常退出统一控制器，旧快照归档不再覆盖客户端 | 已迁移 |
| `0e6430ab` | feat(codex): switch Codex by replacing only key fields | 2/3：Codex 关键字段、登录暂存、目录与托管账号标记统一事务；官方模型缓存/刷新和新模式接通，保留 Web 身份与刷新保护 | 已迁移 |
| `fb564537` | feat(gemini,grok): switch Gemini CLI and Grok Build by replacing only key fields | 2/3：Gemini 双文件与 Grok 已写模型表的关键字段事务、全局编辑和新模式重投影接通；保留客户端自定义值 | 已迁移 |
| `143bc461` | feat(providers): add Codex, Gemini CLI and Grok Build providers through the key-field editor | 2：Codex/Gemini/Grok 新增与编辑共用实时快照、全局基底和冲突选择；预设切换保留全局编辑 | 已迁移 |
| `db468c39` | docs(zh): describe key-field switching in the README FAQ and user manual | 三语 README、Web 路由指南说明关键字段切换与全局编辑的区别 | 已迁移 |
| `59b85196` | docs(zh): fix leftover restart and routing backup wording | 说明 Gemini 等客户端重启、正常退出恢复直连与旧快照仅归档；移除覆盖整份配置的旧表述 | 已迁移 |
| `aa995848` | docs: translate key-field switching docs to English, Japanese and German | Web 中文/英文/日文 README 同步关键字段与模式说明；Web 不维护德语版本 | 已迁移 |
| `bd9e8c90` | fix(gemini): ask for a restart after switching Gemini CLI | useProviderActions 在 Gemini 切换成功后提示重新启动客户端 | 已迁移 |
| `a79d9ff1` | fix(live): keep staged bytes and roll forward interrupted writes around external edits | 写入引擎保留 staged 字节、恢复时绕开外部改动并推进指针；入口锁内 settle、登录身份契约与暂存损坏拒绝已接通 | 已迁移 |
| `08a80b90` | fix(editor): keep live-owned exclusive fields and route tables out of provider rows | Codex/Claude 编辑器保留 live 所属独有字段，重命名路由表不泄漏，全局冲突回滚供应商行；新增入口回归 | 已迁移 |
| `b0875f4c` | fix(live): settle before acting, mark publishing before the first rename and keep live-owned fields out of new rows | 发布前记录 publishing，四应用入口先恢复再保存/切换，服务重配逐应用处理；Web 新增底图为空行，独有字段归属固定按空行判断，覆盖客户端编辑竞态 | 已迁移 |
| `69ff69dd` | refactor: share editor, write and lookup helpers across apps and drop dead common-config code | 共用 ConflictPolicy、editor_toml、TomlSteps、AppWrite 和 Web 冲突重试；旧通用配置 API 仅兼容保存，四应用不再合并 | 已迁移 |
| `6064fc1c` | refactor(health-check): drop connectivity check settings and dead batch/log paths | Web ModelTestConfigPanel/stream-check 是实际模型生成测试，参数及批量 API 有效；不删除为简单 reachability 探测设计的同名路径 | 不适用 |
| `8f4a87d0` | feat(mcode): let users choose the provider key instead of a random UUID | 1c：MiniMax 自选 key、编辑锁定、复制避重；进程锁及原生文件锁下拒绝覆盖，16 路并发新增仅一个成功；9 项 Rust、20 项前端定向通过 | 已迁移 |
| `846de29c` | Fix/skills new icon (#7727) | 迁入 SkillsIcon，接全局侧栏 | 已迁移 |
| `a1216b7e` | fix(usage): support OpenCode V2 session tables (#7541) | 1b：补齐 OpenCode 用量导入基础链路，支持 V1/V2、压缩用量、WAL、未完成消息重试与迁移去重 | 已迁移 |
| `f678f7c5` | fix(opencode): preserve provider fields during import and sync (#7577) | 1b：Provider 导入、编辑和完整配置提取写回均保留原始 JSON 扩展字段；回归覆盖 api/env/whitelist/models.limit.input | 已迁移 |
| `38a7c9c4` | fix(opencode): 支持导入和编辑内置供应商覆盖 (#7749) | 1b：支持已有内置供应商的局部覆盖导入与编辑；新建/改 ID/复制须完整 npm 与模型定义；不导入原生凭据库 | 已迁移 |
| `2cdfc6ae` | fix(proxy): preserve terminal web search output order (#6509) | 1b：终结事件独有的 WebSearch/工具调用复用 JSON 转换，保留块顺序与停止原因；流式模块回归通过 | 已迁移 |
| `74f46143` | fix(sessions): support OpenCode V2 SQLite schema in session manager (#7755) | 1b：OpenCode V2 会话扫描、加载和删除；保留 Web 路径解析与恢复命令，13 项模块回归通过 | 已迁移 |
| `482f57b3` | fix(settings): serialize tool lifecycle writes and isolate Windows scripts (#7725) | 1b：全局串行写入、同工具拒绝重复、取消后持锁和独立临时脚本；夹具测试通过 | 已迁移 |
| `19b7c170` | feat(opencode): 支持 JSONC 配置并保留注释与格式 (#7762) | 1b：JSONC 优先、共享无损编辑器、外部修改检测；适配 Web 路径及 MCP 接口，覆盖 Provider/MCP/OMO 写入与回滚 | 已迁移 |
| `60cc14f8` | fix(settings): 保留工具升级状态并优化错误提示 (#7764) | 1b：模块级任务与确认队列跨页面保留，错误截断可展开；25 项应用页回归通过 | 已迁移 |
| `36d95041` | fix(sessions): sort OpenCode V2 messages by seq and support mixed V1/V2 databases (#7765) | 1b：V2 消息按 seq 排序，混合数据库读取及删除覆盖 V1/V2；13 项模块回归通过 | 已迁移 |
| `c26e6ec3` | refactor(proxy): route retry-loop bookkeeping through outcome helpers | 3：Web 保留既有媒体/签名/预算 outcome 逻辑；新增 opaque retry 在统一结果处理前执行，沿用统计/熔断/故障转移语义 | 已迁移 |
| `7c0d0fc6` | chore(sponsors): update Kimi Open Platform invite track IDs | 1a：各应用预设链接同步；Web 不维护上游赞助商 README 表 | 已迁移 |
| `9be1ef7e` | fix(pricing): add GPT-6.1 Sol pricing (#7800) | 1a：新增 GPT-6.1 Sol seed；补齐缺失行/保留自定义价格回归，Rust 定向测试通过 | 已迁移 |
| `fff09fab` | refactor(usage): extract shared models.dev fetch module | 1c：抽取 models.dev 原始目录、标准化 ID 与共享缓存；保留 Web 价格过滤和供应商名称排序 | 已迁移 |
| `8fbcea9f` | feat(providers): fill model metadata when picking a fetched model | 1c：五类现有表单接入按地址/原厂的逐字段补全；适配 Web Codex 模型目录界面，延迟返回仍按行标识定位 | 已迁移 |
| `f11ac733` | feat(pi): fill capabilities of a fetched model from presets and models.dev | 1c/4a：Pi 模型结构化编辑/拉取/补全接入；Web API 透传协议和请求头，保留模型及根未知字段，完整表单保存经浏览器夹具验证 | 已迁移 |
| `882344b6` | feat(pi): fill thinkingLevelMap of a fetched model | 1c：按模型实际协议、地址及 compat 补 thinkingLevelMap，显式映射不覆盖，迟到补全隔离回归通过 | 已迁移 |
| `e675d586` | refactor(providers): share models.dev query options and committable refs | 1c：共享 models.dev 查询选项及可同步提交 ref，五类表单与价格导入共用实现 | 已迁移 |
| `40d3420f` | fix(providers): prefer canonical pointers in the vendor fallback | 1c：原厂兜底优先 canonical_model_id 指向，存在多个原厂候选时不猜测；回归通过 | 已迁移 |
| `370d089b` | fix(prompt): only clear the prompt file when the last enabled prompt is disabled | 1b：仅停用最后一条已启用提示词时清空文件；新增未启用条目重复保存及外部文件回归 | 已迁移 |
| `47d062fb` | feat(proxy): attach third-party models to Claude Code in proxy mode | 3：Claude 聚合目录、成员路由和默认别名接通；模型可自定义并从远端/Copilot 批选，保留名称与默认项，7 项组件回归通过 | 已迁移 |
| `73c187be` | feat(proxy): attach third-party models to Codex in proxy mode | 3：Codex 聚合目录、模型 ID 定向路由、官方列表缓存和客户端代次接入；保留 Web OAuth 身份隔离 | 已迁移 |
| `d3acdc20` | feat(proxy): make attached models a mode of its own next to routing | 3：直连/路由/聚合独立模式，聚合请求不触发故障转移，direct 指针不随路由改变 | 已迁移 |
| `81cc2f7b` | feat(proxy): carry Codex compaction and turn state across attached providers | 3：Codex V2 压缩触发改摘要、单 compaction 返回/回放、原生官方状态清理接通；三协议本地 HTTP 与纯转换回归通过 | 已迁移 |
| `b925c2bb` | refactor(proxy): rename attached models to Stack mode | 3：按最终命名统一为聚合/Aggregation/集約，内部 stack 数据继续兼容 | 已迁移 |
| `01230112` | feat(proxy): point Claude Code aliases at the default's first Stack model | 3：Claude 角色别名指向默认供应商首个聚合模型；保留上游纯投影回归 | 已迁移 |
| `5990d144` | feat(proxy): highlight Stack members in violet | 聚合成员使用紫色边框表示运行状态，与供应商商业身份无关；A–Z 顺序不变 | 已迁移 |
| `52e0fa8a` | feat(proxy): warn when Codex clients hold an old Stack model list | 3：记录模型目录代次并识别旧客户端，界面提示与确认重启托管 daemon API 接通；Windows 与上游一样不探测进程表 | 已迁移 |
| `5a788d87` | feat(proxy): remind to restart Claude Code when Stack models change | Claude 聚合模式显示模型变化后重启提示，目录代次仍检测旧客户端 | 已迁移 |
| `619c315b` | fix(codex): keep proxy sessions in the same history bucket as direct | 官方路由与直连共享 openai/custom 会话桶；GET Responses 回 426、过滤 version 请求头、按监听地址识别无占位 Key 契约；缺少 auth.json 仍可识别，端口不同不误判 | 已迁移 |
| `85bd8801` | fix(codex): show and save keyless drafts in the provider editor | 空 Key 草稿可查看和保存，禁止首条启用/切换/覆盖当前凭据；运行时回归覆盖拒绝和行回滚 | 已迁移 |
| `d46478e8` | fix(codex): stop warning when the managed OAuth marker is absent | 托管 marker 缺失直接返回 false，不告警；缺失与损坏 marker 均不能建立账号归属 | 已迁移 |
| `c6255cc9` | fix(codex): mirror official entries for GPT models in the model catalog | 3：GPT 目录按最长前缀/单层命名空间镜像官方提示与能力，重置账号专属字段，无损回导；130 项 Codex 配置测试通过 | 已迁移 |
| `850ba952` | feat(i18n): call Stack mode 叠加 in Chinese copy | 3：中间名称由最终聚合文案替代，三语同步 | 已迁移 |
| `1bc68e29` | fix(proxy): reject Stack model ids outside Stack mode | 3：聚合模型 ID 在非聚合模式、未知成员/模型时按客户端协议拒绝，不回退另一家 | 已迁移 |
| `d0b57827` | fix(codex): raise OAuth client identity to 0.159.0 for GPT-6.1 Sol (#7806) | OAuth 生成请求与模型发现共用 0.159.0；模型结构解析和敏感错误脱敏定向验证 | 已迁移 |
| `67d1daa1` | fix(subscription): silence non-macOS dead-code lint on Codex keychain variants | CodexKeychainLogin 的非 macOS dead_code 属性已存在，保持平台边界 | 已迁移 |
| `e88437e7` | fix(usage): stop output TPS from spiking on late first-token marks | 4b：首输出时间独立于 SSE 用量过滤，短突发窗口不计算 TPS；SSE、流式与格式化定向验证通过 | 已迁移 |
| `b9e96202` | chore(presets): remove ETok sponsor slot and presets | 1a：移除各应用 ETok 预设；保留旧图标/文案供已有行使用 | 已迁移 |
| `4e46e6b6` | fix(mcp): stop writing `type` into Codex mcp_servers (#7735) | 1b：Codex MCP 省略 type；Grok 原有 remove(type) 保留无害；新增导入/导出测试 | 已迁移 |
| `27e52822` | fix(mcp): write url-only Codex MCP specs as HTTP and keep transport-only fields apart | 1b：URL-only 推断 HTTP，写出时过滤另一传输专属字段；保留 Web 同步入口 | 已迁移 |
| `81c0ff25` | fix(mcp): keep projecting remaining servers when one fails to sync | 1b：同应用逐服务容错、按错误原因聚合报告；后续启用/停用仍生效，6 项 MCP 定向测试通过 | 已迁移 |
| `bfaaba16` | fix(proxy): strip inline <think>/<thinking> blocks on the Claude and Codex chat paths (#7741) | 1b：Claude/Codex Chat 流式与非流式共用 think/thinking 拆分；逐增量输出推理，处理跨片标签与结束/工具/异常边界 | 已迁移 |
| `793e67d9` | feat(provider): add Command Code presets and quota support (#7358) | 1a：Claude/Codex 预设、自动用量标记、Command Code 查询及 15 项 Rust 回归；后端定向测试通过 | 已迁移 |
| `ad368eb7` | fix(sessions): read Hermes state.db transcripts the way Hermes displays them | 4b：Hermes state.db 读取 display/history 字段并解析工具消息，JSONL 与 SQLite 共用结构化模型；解析测试通过 | 已迁移 |
| `cee90347` | fix(ui): surface usage and accounts entries, show scrollbars and card switch buttons | 侧栏提供全局用量/账号入口，操作按钮常显，主滚动区保留滚动条；Web 统一供应商有实际入口，因此保留 | 已迁移 |
| `98798552` | fix(proxy): keep the routing service running for Claude Desktop model mapping | 3：Desktop 映射卡先启服务再写 profile，失败回滚；启动恢复映射并维持服务 | 已迁移 |
| `947a8a8b` | feat(ui): add v7 design tokens and shared primitives | 引入页签、分段控件、提示与信息组件；映射到现有 Web CSS 变量，保留自身主题与响应式尺寸 | 已迁移 |
| `40aa2864` | feat(ui): move to a sidebar shell with global pages and grouped settings | 固定侧栏/移动抽屉、全局页面、应用页与既有分组设置接通；桌面窗口/托盘不迁入 | 已迁移 |
| `4aab608f` | feat(ui): add the v7 mode layer to provider pages and routing settings | Web 直连/路由/聚合模式层与确认、成员、默认路由和保存重启已接通；采用 Web 模式面板布局 | 已迁移 |
| `a0b722c3` | feat(ui): show quota as what is left, quiet unless running out | 4b：订阅/Copilot/脚本额度统一按剩余显示，展开条形图复用 Web 主题；采用后续最短窗口和低额度最终规则 | 已迁移 |
| `b999b07b` | feat(ui): rebuild the global pages and finish the v7 visual pass | Web 全局用量、结构化会话、MCP/Skills、Prompts 接通；提示词可复制为独立未启用记录；批量开关限筛选结果并可撤销；保留 Web 删除确认和扁平 A–Z 预设布局 | 已迁移 |
| `4f8d1424` | feat(tray): rebuild the tray menu around apps and their modes | 桌面托盘菜单；Web 无系统托盘 | 不适用 |
| `e9170adb` | feat(ui): settle the open v7 follow-ups for presets, tray and panels | 重新同步 API、逐仓库失败、ZIP 冲突目录、后台扫描完成时间已接入；预设区域/套餐保留独立 A–Z 条目，不按家族置顶；托盘不适用 | 已迁移 |
| `b7a5ef28` | feat(ui): follow the spec for preset versions, tray problems and skills storage | Skills 存储弹窗区分 auto/symlink/copy，展示服务主机真实目录并复用迁移确认；预设设计顺序服从 Web A–Z 规则；浏览器复制目录代替桌面打开 | 已迁移 |
| `0b1af534` | feat(ui): apply the v7 design review | 账号删除列出引用、Hermes 双草稿、趋势指标切换和页面页签已接入；Web 保留既有确认/设置布局，不迁推广及分类优先顺序 | 已迁移 |
| `c1ead8d0` | fix(usage): skip burst windows in provider speed totals | 4b：供应商精确速度只累计输出 ≥100 且生成 ≥100ms 的有效样本，SQL 回归通过 | 已迁移 |
| `c55a36c0` | feat(ui): rebuild the accounts center and Hermes memory pages | 全局账号分组、额度、默认/重新认证及删除影响确认；Hermes 双文件独立草稿与保存状态；保留 Web 认证实现 | 已迁移 |
| `c2269df7` | fix(ui): keep icon tiles and the env warning readable in dark mode | Web ProviderIcon 使用 currentColor/自有图标色，EnvWarningBanner 已有 dark 黄背景与字色；账号等新组件采用现有主题变量 | 已迁移 |
| `d59cac29` | fix(usage): share one quota cache between tray and card, add token-refresh-pending state | 4b：Claude/Grok 区分令牌待刷新与登录过期；托管账号和卡片共用 Query 缓存，切账号清快照；Web 无托盘桥接 | 已迁移 |
| `f625f566` | feat(usage): default the usage dashboard to today | 4b：Web 原已默认当天，保留并验证既有用量页面行为 | 已迁移 |
| `7e1d447d` | feat(usage): show app filter chips as icons only | 4b：应用筛选以图标显示，保留标题、可访问名称与选中状态 | 已迁移 |
| `600b00cd` | fix(usage): give numeric columns the spare width in the request log | 4b：供应商/模型列分别限 18%/22%，时间收紧，剩余宽度供数值列；保留 Web 九列结构 | 已迁移 |
| `d76a1cda` | feat(usage): enable models.dev pricing sync by default | 4b：新配置默认开启 models.dev 价格同步，显式关闭保持不变；模型价格服务测试通过 | 已迁移 |
| `b0b6559a` | fix(usage): complete Claude session-log rows when a reply's last block arrives | 4b：Claude 最后分块更新输出/费用，最终匹配代理时删除重复会话行；会话导入回归通过 | 已迁移 |
| `7e9b99bc` | feat(usage): estimate request duration from Claude Code and Codex session logs | 4b：Claude 父 UUID 链/增量回看和 Codex 轮次事件推导时长，保留 Web 后台扫描及 OpenCode 导入 | 已迁移 |
| `37c8da1b` | feat(usage): show estimated speed for requests imported from session logs | 4b：请求估算速度以 ≈ 标识，供应商统计精确/估算分列；时长和速度定向测试通过 | 已迁移 |
| `57b1eff1` | feat(ui): v8 — theme color, unified controls, motion, virtual lists (#7816) | Web 接入动态虚拟列表（会话、Skills 发现/安装、MCP）、乐观开关、延迟加载状态与共享控件；保留 Web 主题、提示与窗口布局，不复制桌面标题栏 | 已迁移 |
| `c212cdea` | style(ui): format checkbox className call | 上游 checkbox 的格式化提交；Web 保留自身 checkbox 实现，无行为可迁移 | 不适用 |
| `b8c600a2` | perf(usage): keep dashboard queries off the main thread and cheapen dedup | 4b：六个读取 API 使用 blocking_json；按范围选择等价去重 SQL，总数缓存按写入/过滤/活动结束时间/60 秒失效 | 已迁移 |
| `c932436d` | feat(usage): paginate the request log, provider, model and pricing tables | 4b：按最终 ebd9357c 恢复版本适配四表分页，不采用中间撤销状态 | 已迁移 |
| `cf2e6a71` | feat(usage): redesign the dashboard with an all-time heatmap and day tiles | 4b：按最终 7ebc91f8 保留全部范围和 53 周热力图；被上游撤回的日磁贴不引入 | 已迁移 |
| `4370d14d` | feat(sessions): start project groups collapsed and remember expanded ones | 4b：按冻结最终结构化阅读器保留项目分组初始收起与展开持久化 | 已迁移 |
| `ba914a83` | Revert "feat(sessions): start project groups collapsed and remember expanded ones" | 4b：中间撤销由冻结最终阅读器覆盖，未停留在中间状态 | 已迁移 |
| `5be4451d` | fix(usage): qualify columns in the request detail query | 4b：请求详情所有日志列限定 l.，真实 provider JOIN 回归通过 | 已迁移 |
| `a39af812` | fix(usage): show load errors in the request detail panel | 4b：详情区分加载失败与不存在，显示错误并可重试；组件验证通过 | 已迁移 |
| `20c4ff86` | fix(ui): close provider panels when navigating away from the app page | 4a：切换应用或离开供应商页时清理新增/编辑/用量/确认窗口；App 定向回归通过 | 已迁移 |
| `081fdd4d` | fix(skills): never touch OpenClaw's skills dir during sync | 1b：sync_to_app 跳过 OpenClaw/Claude Desktop/Pi，新增同名自有目录保留测试；Web 无 resync_all_apps 入口 | 已迁移 |
| `4fd53be9` | fix(providers): disable delete on the provider in use again | 3：当前直连和代理默认供应商禁用删除，后端同时拒绝；组件/控制器回归通过 | 已迁移 |
| `05d70dc3` | fix(ui): lift dropdown menus above full-screen panels | 4a：dropdown content/subcontent 层级提升至全屏面板之上，保留 Web 面板体系 | 已迁移 |
| `d6666977` | fix(skills): make the skills.sh retry button actually refetch | skills.sh 首次失败重试真正 refetch，后续页失败重置 offset 再拉取；组件回归通过 | 已迁移 |
| `e447b3d0` | fix(mcp): don't save a masked secret as empty after renaming its key | 4a：结构化 MCP 草稿与 JSON 掩码已接入，保留未知字段；重命名掩码键必须填真实值，禁止空串覆盖 | 已迁移 |
| `fe9593a7` | fix(providers): compute failover priorities from the full queue | Web getFailoverPriority 已依据完整执行队列计算；搜索不重编号，展示顺序与执行队列分离 | 已迁移 |
| `0523ec9d` | fix(providers): explain why Codex official cards can't join the queue | Codex 官方身份卡不可加入故障转移队列并说明原因，失败显示 toast | 已迁移 |
| `7422c24b` | fix(usage): keep pricing reachable when there is no usage yet | 4b：Web 定价 Accordion 独立于用量结果，无数据时仍可达，保留既有入口 | 已迁移 |
| `4ca7f47a` | fix(sessions): expand tool output that contains a find hit | 4b：全文搜索命中自动展开工具输出；阅读器回归通过 | 已迁移 |
| `b600ce2e` | fix(sessions): show Hermes's last message in the list, not the first | 4b：Hermes SQLite 列表摘要采用最后消息，定向测试通过 | 已迁移 |
| `0dd97698` | fix(proxy): make "save and restart service" restart the service | 3：保存并重启调用专用接口，相同地址也真实重启；控制器回归通过 | 已迁移 |
| `3239b366` | fix(tray): rebuild the menu when the stack roster or failover queue changes | 桌面托盘刷新；Web 无系统托盘 | 不适用 |
| `3795a3fe` | fix(mcp): keep hidden apps' flags when a batch paste overwrites a server | 4a：批量粘贴支持跳过/覆盖，仅覆盖可见应用开关，隐藏应用沿用原值；Web 现有批量开关范围不变 | 已迁移 |
| `fd446300` | fix(prompts): drop the always-failing undo on Pi imports | Web Pi 导入本来没有不可实现的撤销，保留既有导入流程 | 不适用 |
| `e7b6f2b9` | fix(ui): stop form drawers from closing on an overlay click | 4a：Web FullScreenPanel 原本无遮罩点击关闭；继续沿用显式关闭按钮 | 已迁移 |
| `485a3b69` | fix(apps): surface installation conflicts found by diagnose | 1b：诊断冲突后自动展开安装列表；组件及浏览器 mock 验证通过 | 已迁移 |
| `92e6f3b9` | fix(settings): move the data-dir baseline after a successful save | 设置保存成功后推进数据目录 baseline；重置恢复最近已保存值，新增 hook 回归 | 已迁移 |
| `edc8c2b9` | fix(proxy): save global routing settings without clobbering per-app retries and timeouts | 3：全局监听/logging 只写全局配置，不覆盖 per-app retries/timeouts；定向回归通过 | 已迁移 |
| `55fa8e85` | fix(proxy): roll back the saved listen address when the restart fails to bind | 3：绑定失败恢复旧配置与旧 listener，随机端口按实际端口恢复；定向回归通过 | 已迁移 |
| `b23c9d5b` | fix(sessions): expand a tool output's tail when the search also hits past the preview | 4b：命中预览之外的尾部时展开完整工具输出，按需分页；阅读器回归通过 | 已迁移 |
| `8a9fdfad` | fix(sessions): summarize Hermes JSONL sessions by their last message too | 4b：Hermes JSONL 列表摘要采用最后消息，定向测试通过 | 已迁移 |
| `21cbc3a8` | refactor(i18n): rename the Stack mode to 聚合 in Chinese | 3：Web 中文模式统一使用聚合 | 已迁移 |
| `91a783c5` | refactor(i18n): rename the Stack mode to Aggregation / 集約 in en and ja | 3：Web 英文/日文模式同步为 Aggregation/集約 | 已迁移 |
| `29513d9a` | refactor(ui): enter routing and aggregation only from the notice | 3：页签只查看，进入路由/聚合从提示区选择默认供应商并确认；组件和浏览器检查通过 | 已迁移 |
| `a3749198` | feat(mode): set the proxy route without entering proxy mode | 3：route API 可在 direct 下预选代理路由而不接管客户端；direct 与 route 独立 | 已迁移 |
| `3d23ddb3` | refactor(ui): drop the direct and last-route chips from the route tab | 3：模式栏只展示实际模式与当前供应商，不引入 direct/last-route 芯片 | 已迁移 |
| `c19c1170` | feat(ui): set the aggregation default from the card's more menu | 3：聚合默认供应商从卡片更多菜单设置，默认成员不可移除；不使用星标 | 已迁移 |
| `b7a48341` | fix(ui): widen the provider form column from 640 to 960 | 4a：保留 Web 已有更宽的 max-w-7xl 全屏表单，不退回上游桌面固定 960 列宽 | 已迁移 |
| `17aa9f0b` | fix(proxy): retry Codex history carrying MiniMax turns on OpenAI-family upstreams | 3：精确识别 MiniMax plaintext reasoning、密文与外来 ID 错误；同供应商最多重试一次，保留 call_id；HTTP 回归通过 | 已迁移 |
| `3fbba2b3` | fix(proxy): stream Codex official replies that carry no Content-Type | 1b：成功流式请求缺少 Content-Type 时识别为 SSE，显式类型及错误状态优先；定向回归通过 | 已迁移 |
| `6d077f2a` | Revert "feat(usage): paginate the request log, provider, model and pricing tables" | 4b：中间撤销被 ebd9357c 再引入覆盖，采用冻结目标最终分页行为 | 已迁移 |
| `7ebc91f8` | refactor(usage): keep only the all-time range and heatmap from the redesign | 4b：全部时间/热力图，保留 Web 汇总卡、当天默认与刷新间隔，热力图采用现有主题 | 已迁移 |
| `3459658f` | fix(proxy): fill function-call arguments that arrive after their end events | 1b：第三方 Responses 暂存空参数结束事件并补齐迟到参数；保留 Web 用量记录及超时链路 | 已迁移 |
| `3c7360d0` | refactor(proxy): share the item-id prefix check between the scrubber and the rectifier | 3：发送前 scrub 与反应式 rectifier 共用 item-id 前缀检查 | 已迁移 |
| `736622b3` | feat(sessions): redesign the session reader with structured transcripts (#7825) | 4b：九来源结构化会话、缓存、按需内容/图片与虚拟阅读器；Web NDJSON 替换 IPC，Markdown 用浏览器下载，本地路径提供复制 | 已迁移 |
| `31e5ae3f` | feat(sessions): show total tokens and API-price cost in the reader header | 4b：会话头部 Token/API 费用汇总，仅统计会话导入行；Rust 去重/账号范围测试及浏览器通过 | 已迁移 |
| `4aaafb8f` | fix(exit): point clients back to direct when macOS quits the app | Web 正常退出 detach 已恢复直连并保留模式；macOS Tauri 退出事件本身不适用 | 已迁移 |
| `c57d64f4` | fix(ui): reserve the scrollbar gutter on main scroll areas | 主滚动区使用 scrollbar-gutter: stable，手机工具栏允许横向滚动 | 已迁移 |
| `98d16323` | fix(providers): stop flashing the previous app's list when switching apps | 4a：providers query 去掉跨应用 keepPreviousData，切应用不闪旧列表 | 已迁移 |
| `c55843ff` | fix(providers): wait for live membership before sectioning additive apps | 累加应用在 live membership 未加载时显示等待，避免错误分组；ProviderList 回归已通过 | 已迁移 |
| `b074f835` | fix(prompts): delay the disabled look during quick reloads and writes | PromptPanel 保留原列表，超过 300ms 才淡化，加载期间阻止切换写入 | 已迁移 |
| `416cc117` | fix(sessions): keep list rows mounted while the reader is open | 4b：阅读时隐藏列表而不卸载，保留列表滚动及展开状态；18 项列表回归通过 | 已迁移 |
| `3dc46460` | fix(usage): keep previous stats while filters, range or page change | 4b：统计及日志 query 使用 keepPreviousData，筛选/时间范围/翻页保留前次结果 | 已迁移 |
| `d4e47d71` | fix(ui): replace the new-layout banner with a one-time dialog | Web 没有上游旧布局横幅，不增加桌面 v7 迁移弹窗；保留原有首次使用说明 | 不适用 |
| `cc9d9de5` | fix(providers): restore the play icon for switching a direct provider | Web 直连切换按钮保留 Play 图标，主操作始终可见 | 已迁移 |
| `88e40de8` | fix(shell): group shared config first in the global sidebar menu | 全局侧栏先列 MCP/Skills/Prompts/统一供应商，再列会话/用量/账号 | 已迁移 |
| `227aa014` | fix(providers): advise picking the official account as the Stack default | 聚合预览提示优先选择官方账号作为默认路由；选项仍按 A–Z，不自动置顶 | 已迁移 |
| `dc6fe3ff` | fix(quota): pin the shortest window and merge other tiers on the card | 4b：最短窗口固定首行，其余最多两段合并第二行；组件回归通过 | 已迁移 |
| `dd224d56` | fix(quota): emphasize low quota without the warning orange | 4b：低额度加深加粗，耗尽才红，保留 Web 主题 | 已迁移 |
| `d09bde52` | fix(usage): report an expired Grok access token as refresh pending | 4b：Grok access 过期且有 refresh 时标记 refresh_pending，纯解析测试通过 | 已迁移 |
| `ef071c11` | docs(usage): correct the Grok access token lifetime in the module doc | 4b：Grok access token 约六小时寿命说明已同步模块文档 | 已迁移 |
| `9f6a758c` | fix(shell): drop the sidebar brand divider on macOS | macOS 桌面专属侧栏分隔线 | 不适用 |
| `044ff96a` | fix(ui): truncate long provider names in mode status bar (#7837) | 3：模式状态栏长供应商名截断并保留 title，不挤出容器 | 已迁移 |
| `4b6e3297` | fix(sidebar): keep sidebar tooltips from covering adjacent buttons (#7839) | Web 侧栏使用原生 title 提示，不生成遮挡相邻按钮的悬浮层 | 已迁移 |
| `63ea8184` | fix(usage): default the trend chart to tokens and list it first | 4b：趋势图默认 Token，指标顺序 Token/请求/费用；组件切换回归通过 | 已迁移 |
| `a43d3b2f` | fix(theme): align the light accent with Tailwind orange-500 | 桌面橙色主题参数；Web 保留已有品牌主题，不强制替换 | 不适用 |
| `6fd176ba` | fix(usage): deepen the top heatmap level in light mode | 4b：热力图最高档在浅色下加深，沿用 Web 主色变量，不强制替换整站主题 | 已迁移 |
| `be746ea8` | fix(claude-desktop): stop the routing service when leaving a mapping card | 3：离开 Desktop 映射卡且其他 CLI 未 attached 时停止路由服务；编辑改 direct 路径回归通过 | 已迁移 |
| `d7c4da57` | test(presets): expect 71 Claude preset rows after Command Code joined | 71 行依赖桌面家族折叠布局；Web 全部预设平铺 A–Z，沿用现有预设数据/搜索回归，不套用桌面行数 | 不适用 |
| `f5a4bdc9` | fix(proxy): keep holding late-argument calls until a non-delta event arrives | 1b：参数增量继续透传且不提前释放暂存结束事件；分片、末尾事件和错误传播回归通过 | 已迁移 |
| `3abbdf28` | fix(sessions): don't evict loaded images whose waiters haven't taken them | 4b：图片缓存待取用者受保护，不被 LRU 提前撤销；缓存回归通过 | 已迁移 |
| `ba8c1cd6` | test(sessions): JSON-escape the sidecar path spliced into Claude transcript lines | 4b：Claude sidecar 夹具使用 JSON 转义路径；Windows 定向测试通过 | 已迁移 |
| `b8b3c672` | fix(sessions): follow-ups from the session reader review (#7836) | 4b：最终 reader 跟进已并入解析/缓存/阅读器与检索，Web 传输另测 | 已迁移 |
| `372b1698` | perf(shell): keep sidebar toggle from re-rendering and reflowing the page (#7845) | 展开状态只存侧栏，固定 56px 内容偏移、224px 浮层；浏览器实测切换前后 main x/width 不变 | 已迁移 |
| `3e60be14` | refactor(stack): describe aggregated models by upstream id and window | stack::model_description 已按上游模型 ID 与窗口描述，Codex 目录使用同一函数 | 已迁移 |
| `7f86dbe2` | fix(providers): show the preset's promotion under the API Key field again | 上游恢复 API Key 合作推广面板；按用户明确要求在 Web 移除，不迁移此展示 | 不适用 |
| `4baa0840` | docs(presets): update stale ordering and primePartner comments for v7 | 已按 Web 规则重写预设排序及 primePartner 注释；旧身份字段仅作兼容，不展示或参与排序 | 已迁移 |
| `515526b2` | fix(providers): mark API Key as required where saving checks it | 4a 提前接入：Claude/Codex/Grok/Gemini/Desktop 保存校验 Key 的表单显示必填提示；官方、云厂商与禁用字段除外，aria-required 不阻断空 Key 确认 | 已迁移 |
| `9c7878e6` | feat(presets): add official icons for DMXAPI, BaiLing, TheRouter, Together AI and Astron | 1a：新增图标；PNG 接入 Web local.ts，SVG 接入 extracted；保留现有图标加载约定 | 已迁移 |
| `c42feedd` | fix(gemini): drop the redundant custom preset | 1a：移除 Gemini 重复自定义预设，保留选择器自身入口 | 已迁移 |
| `ebd9357c` | feat(usage): paginate the request log, provider, model and pricing tables | 4b：统一 TablePagination 与前端分页，四表每页 20 条，筛选复位、数量减少收回页码、可输入页号 | 已迁移 |
| `c0e093a2` | feat(subscription): show saved ChatGPT limit resets | 4b：Codex 用量并行附加可用重置次数，辅助接口失败不影响主额度，过期/不可用项过滤 | 已迁移 |
| `a7d3825f` | feat(quota): show refresh feedback when clicking the card quota | 4b：手动刷新至少 600ms 旋转、成功勾/失败叉一秒；后台查询仅淡化 | 已迁移 |
| `ac2a0bbc` | feat(quota): list when each saved ChatGPT limit reset expires | 4b：保存的重置按到期时间排序分组，可独立展开；三天内到期强调，定时剔除过期次数 | 已迁移 |
| `7d5ed45e` | feat(presets): add 88API sponsor presets across nine apps | 1a：九应用 88API 预设、图标与三语文案；不复制上游赞助商 README 表 | 已迁移 |
| `bfd28b2f` | feat(presets): add Tu-zi (兔子API) presets across nine apps | 1a：九应用 Tu-zi 预设、图标、中文/紧凑搜索别名；验证 API Key 字段及 Desktop 根地址 | 已迁移 |
| `6d6bbe67` | docs(release): add v4.0 release notes in Chinese, English and Japanese | 上游发行说明；Web CHANGELOG 按实际已迁移功能维护 | 不适用 |
| `2153c1cc` | feat(quota): show reset countdowns again instead of hiding them on hover | 4b：额度重置倒计时常显，合并行采用最近的重置时间 | 已迁移 |
| `8b977f27` | fix(quota): keep balances one quiet color until they run out | 4b：余额正常使用安静文字颜色，耗尽才红；规则回归通过 | 已迁移 |
| `412579f9` | chore(release): v4.0.0 | 上游 v4.0.0 版本发布；Web 保留独立版本序列 | 不适用 |
| `0d0dd0a5` | docs(readme): use English 88API banner in en/ja/de READMEs | 上游赞助商 README 横幅，Web README 无该表 | 不适用 |
| `a189980f` | docs(release): shrink and center v4.0 release note screenshots | 上游 v4.0 发布说明图片布局，Web 自有发布说明 | 不适用 |

## 7. Web 适配与验收边界

- 界面保留 Web 主题、扁平 A–Z 预设、既有删除确认和设置分组，不照搬桌面像素布局、家族设计排序、窗口/托盘或一次性换布局提示。预设区域/套餐仍作为独立条目可选；商业标签、星/心、推广优先级不迁入。
- Copilot Enterprise 域名认证、Hermes MCP 写入属于既有 Web 未支持项，本轮明确禁用/排除，不冒充同步成功。Skills 重同步不接管 Desktop/OpenClaw/Pi 原生目录；Pi 原生认证、默认模型和代理仍遵循独立契约。
- 用户追加授权后已执行 Windows 前后端全量测试，结果见第 8 节。未执行发布构建、Docker 严格验证、Linux/macOS 编译或 Unix 权限用例；真实账号登录、真实供应商请求、工具安装/升级未作为本轮验收运行。已有真实 API Key 测试仍跳过。后续按用户要求创建一次本地提交并清理警告，见第 9 节；未推送或发布。
- 195 项均已处置；“已迁移”包括保留 Web 定制的行为等价实现，“不适用”逐行说明理由。发布包与线上部署不包含本轮工作树改动；后续按用户确认将仓库版本提升至 `3.0.0`，见第 10 节。

## 8. 全量测试验收（2026-10-05）

用户明确要求“全量测试一下”，本次执行 Windows 当前默认配置的完整 Vitest 与 Cargo 测试，不扩展到发布构建、Docker 或真实账号联调。

| 检查 | 命令 | 最终结果 |
| --- | --- | --- |
| 前端全量 | `pnpm run test:unit` | 146 个文件通过，1385 项通过、2 项跳过、0 失败 |
| Rust 全量 | `cargo test --locked --manifest-path backend/Cargo.toml -- --test-threads=1` | 库测试 2481 项通过、5 项忽略、0 失败；二进制测试目标编译通过，无测试用例 |
| TypeScript | `pnpm exec tsc --noEmit` | 通过 |
| 改动检查 | 局部 Prettier/rustfmt、`git diff --check` | 通过 |

首轮失败与修正：

- 前端首轮 1382 项通过、3 项失败、2 项跳过。`subscription.test.ts` 仍直接调用已包含 `useRef` 的 Hook，改用 `renderHook` 后全量复测通过，保留原轮询与缓存时效断言。
- Rust 首轮 2480 项通过、1 项失败、5 项忽略。汇总测试用 UTC 日期准备已有数据，而生产逻辑按本地日期分桶；修正夹具为本地日期，同批测试数据使用同一时间戳以避免跨午夜，并断言最终仅一个日期桶。生产汇总行为未改，全量复测通过。
- Claude Desktop 的 `std::fs` 导入限定为测试构建，移除一条无用导入警告。默认非测试库编译仍报告 25 条未使用代码警告，主要为旧接口及辅助函数；没有编译错误，未扩大到删除旧接口。

保留的跳过/忽略项：前端 2 项为不适用 Web 的旧 Tauri 文件导入、原生目录浏览流程，已有相关 Hook 单元覆盖；Rust 5 项为 2 个显式性能诊断、真实 Codex 语料回放，以及 2 个依赖真实 MCode/API Key 的流程。未使用 `--ignored`，未向测试提供真实账号凭据。

最终日志：`%TEMP%/ccswitch-full-vitest2.log`、`%TEMP%/ccswitch-full-rust2.log`、`%TEMP%/ccswitch-full-tsc.log`；首轮失败日志保留为 `ccswitch-full-vitest.log`、`ccswitch-full-rust.log`。CodeGraph 已同步；所有修改保留在工作树。

## 9. 提交与编译警告清理（2026-10-05）

按用户“提交一次，然后警告全修”的要求，先创建提交 `33cb2883`：`完成上游 v4.0.0 Web 迁移并通过全量测试`。提交包含源码、测试和文档共 458 个文件，浏览器本地验收产物保留在 `.playwright-cli/`，未纳入提交。

之后清理全部 25 条 Rust 编译警告：

- 按实际调用关系将旧接管、整份写入、预检和通用 TOML 参考补丁等兼容回归辅助代码限定为测试编译；生产继续使用关键字段写入和模式控制器，共享的旧配置恢复逻辑保持可用。
- 删除已被诊断报告接口替代的 Skills 列表包装函数，以及 Web 不使用的桌面文件定位函数和对应测试。
- 写入操作在恢复未完成事务后记录调试日志，保留恢复结果字段及其回归断言。
- 没有新增警告屏蔽；移除了 `TomlSteps` 已过期的 `allow(dead_code)`。

验证：`cargo check --locked --manifest-path backend/Cargo.toml --all-targets` 通过，0 警告；Rust 全量复测 2480 项通过、5 项原有忽略、0 失败、0 编译警告，二进制目标编译通过。通过数比上一轮少 1，原因是删除了不适用 Web 的桌面路径定位测试。局部 rustfmt 和 `git diff --check` 通过，CodeGraph 已同步。前端只有提交前的空白整理，复用第 8 节全量结果。

日志：`%TEMP%/ccswitch-warnings-check2.log`、`%TEMP%/ccswitch-warnings-rust-full.log`。警告修复及本节记录保留在工作树，未创建第二个提交，未推送或发布。

## 10. 3.0.0 版本与发布说明准备（2026-10-05）

用户确认采用 `3.0.0` 作为新的主版本。已同步 `package.json`、`backend/Cargo.toml` 和 `backend/Cargo.lock` 中本项目的版本声明；依赖包版本与历史版本记录不变。`pnpm-lock.yaml` 不存储根项目版本，无需修改。

CHANGELOG 将本轮内容整理为 `3.0.0` 条目，补充旧配置片段、费用倍率、供应商排序的升级注意事项及最终验证结果。中、英、日 README 同步版本、核心功能、升级说明、测试结果和未验证范围，保留无商业身份标签及 A–Z 排序约束。

版本一致性、锁文件依赖不变、本地 Markdown 链接与 `git diff --check` 均检查通过；`cargo metadata --locked --offline --no-deps` 确认 Rust 项目版本为 `3.0.0` 且无需更新锁文件。此次仅修改版本声明与文档，复用前述代码验证结果，未重复编译或全量测试。未新增提交、标签、发布包或 Release。
