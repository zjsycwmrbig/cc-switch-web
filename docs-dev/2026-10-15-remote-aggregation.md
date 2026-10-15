# 聚合模型同步与官方账号代理注入

## 变更

- 移除独立客户端模型池及 `settingsConfig.modelMapping` 解析、档位别名和原生 Responses 默认模型兜底。
- 导出当前聚合成员，每个模型均带稳定供应商 key；默认供应商同样导出带前缀的模型。同名模型分别保留。
- 聚合请求在 Responses、Chat Completions 和 Anthropic 转换前保留指定模型。
- 官方卡由 `CodexAdapter` 选择 `CodexOAuth` 认证，复用服务端账号管理器获取有效令牌及 workspace。代理配置不写入客户端的 ChatGPT 登录。
- 配置了网页访问密钥的服务上，官方请求须通过代理密钥验证。出站认证及 workspace 不接受客户端和 header override 覆盖。
- 官方卡可作为聚合成员。官方模型从对应账号获取；认证不可用时明确报告，并允许使用 CLI 自带目录同步其他渠道。
- 同步脚本备份并原子替换文件，保留路由，更新过期默认模型，移除覆盖所有模型的全局窗口声明。可选重启 daemon；对未托管服务仅定位当前 CODEX_HOME 控制 socket 的同用户监听进程。

## 验证

- TypeScript 类型检查及 Vite 构建通过。
- musl aarch64 release 构建通过。
- 后端相关过滤测试共 31 项通过：`aggregation`（19）、`official_proxy`（10）、`official_codex_proxy`（1）、`web_model_catalog`（1）。
- 安装器检查覆盖保留当前有效模型、替换失效默认模型、保持供应商路由、创建备份以及无效目录不改配置；同时覆盖无 tomllib 的 Python 环境。
- 两台部署客户端的 `codex debug models` 均加载 34 个带供应商标识的模型。通过实际控制 socket 的 WebSocket JSON-RPC 查询 `model/list`，两台运行中的 app-server 均返回同样 34 项，避免仅检查磁盘文件。
- 从两台主机分别通过公网代理请求两个供应商，均收到 HTTP 200 和 `response.completed`；使用量日志确认请求模型前缀对应供应商，真实上游模型未改写。
- 官方注入通过本地模拟上游验证：客户端无 auth.json，绑定账号的令牌和 workspace 均正确注入，未使用默认账号或客户端传入的 workspace。
- 部署时现存官方账号的刷新令牌失效。用户选择稍后重新登录，官方真实上游请求仍需登录后验证。

使用方式见 [远程聚合说明](../docs/remote-aggregation.md)。
