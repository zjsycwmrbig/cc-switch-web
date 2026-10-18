# CC Switch Uint

> Let a team use everyone's providers as if they were one.

CC Switch Uint is a multi-user AI provider and model aggregation platform for teams. It turns scattered API keys, official subscriptions and self-hosted relays into one shared capability that can be authorized, metered and routed.

## Vision

- **Providers belong to the team, not a machine**: everyone uploads, the team consumes by permission.
- **Capabilities are precisely delegated**: quota, model scope, deadline, request count and tokens are decided by the owner.
- **Clients need one endpoint**: automatically pick an available provider with balance and permission.

## Capabilities

- Multi-user workspace: accounts, API keys, personal quotas, concurrency and rate limits.
- Provider marketplace: public/private publishing, applications and approvals, per-user usage ranking and balance queries.
- Quotas and sharing: default/shared budgets, auto-approval rules and share codes.
- Models and routing: catalog management, 1:1 mappings and drag-ordered auto-routing.
- Official account center: Codex / Copilot / Grok login, binding and rotation.
- Usage and cost: request logs, per-user/provider/model stats, pricing and quota progress.

## Architecture

- Backend: Rust (axum) + SQLite; web console on 8890, shared gateway on 15721.
- Frontend: React + Vite; static assets served from disk, no Rust rebuild for UI changes.
- Sync: generates Codex config and aggregation catalog with fixed backups and restore.

## Upstream

Forked from [zuoliangyu/cc-switch-web](https://github.com/zuoliangyu/cc-switch-web), keeping the desktop experience while extending it into a multi-user web platform.

## License

MIT
