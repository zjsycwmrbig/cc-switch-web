# 远程 Codex 聚合模型

在网页中开启 Codex 聚合模式，将需要使用的供应商加入聚合。供应商自己的模型列表仍在卡片编辑器中管理；不再维护独立的模型映射池。

网页的“同步聚合模型”提供复制命令和下载目录两个入口。复制命令并在每台远程主机运行即可，例如：

```bash
curl -fsSL -H 'Authorization: Bearer <网页访问密钥>' \
  'https://ccswitch.example/api/model-catalog/codex/aggregation/install.sh' \
  | CC_SWITCH_RESTART_APP_SERVER=1 bash
```

需要 curl、bash 和 Python 3（仅使用标准库，兼容未安装 tomllib 的旧版 Python）。脚本会下载当前聚合成员的模型，校验目录，备份并更新 `~/.codex/config.toml` 和 `cc-switch-aggregation-models.json`，然后尝试重启 Codex app-server。已有 CLI 会话需退出重进，VS Code 远程窗口需重新加载。

脚本保留有效的当前模型；旧模型不在新目录时改为聚合默认供应商的模型。各模型的窗口来自目录，因此会移除覆盖所有模型的顶层 `model_context_window` 和 `model_auto_compact_token_limit`。脚本保留供应商路由表和登录配置，路由地址需预先指向 CC Switch 的代理入口。

## 路由规则

- 目录包含默认供应商及所有已加入聚合的供应商；未加入的供应商不导出。
- 模型 ID 为 `ccs-<供应商 key>/<真实模型 ID>`，显示名为 `模型名（供应商名）`。
- 每个模型直接转发到指定供应商，剥除供应商前缀后使用真实模型名。不会应用已删除的映射、别名和默认模型兜底。
- 同名模型按供应商分别保留。移除供应商后旧 ID 报错，不会静默改用另一家。需重新同步客户端目录。
- 普通模型名仍请求默认供应商；聚合模式不自动故障转移。

## 官方 ChatGPT 账号

在 CC Switch 网页登录 ChatGPT。官方卡可以作为默认供应商，也可以作为聚合成员；可绑定指定账号，未绑定时使用服务端默认账号。CC Switch 负责获取有效令牌、刷新令牌，以及注入 `Authorization` 和 `chatgpt-account-id`。

远程 Codex 无需登录 ChatGPT，也不需要复制 `auth.json`。客户端只持有代理访问密钥。在设置了 `CC_SWITCH_WEB_ACCESS_KEY` 的服务器上，官方请求必须携带该密钥：

```toml
model_provider = "custom"

[model_providers.custom]
name = "OpenAI"
base_url = "https://proxy.example/v1"
wire_api = "responses"
requires_openai_auth = false
experimental_bearer_token = "<网页访问密钥>"
supports_websockets = false
```

官方模型目录从所选服务端账号获取，导出文件不包含账号令牌。账号暂时失效时，目录可回退到服务器 Codex 自带列表，同步命令会明确提示来源及重新登录要求；第三方渠道仍可使用。账号失效时在网页重新登录即可。原生直连模式继续采用 Codex 自身的登录方式。

## 接口

两个接口都采用网页访问密钥认证：

- `GET /api/model-catalog/codex/aggregation`：返回 `models` 目录、`default_model` 和 `warnings`。聚合未开启或没有可用的模型目录时返回错误，客户端保留已有文件。
- `GET /api/model-catalog/codex/aggregation/install.sh`：生成当前网页地址对应的同步脚本。

旧模型池读写、跨供应商模型并集和 Python 安装器接口已移除。
