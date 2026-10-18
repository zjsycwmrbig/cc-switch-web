import {
  Boxes,
  GitFork,
  Layers,
  ShieldCheck,
  Users,
  WalletCards,
  Workflow,
  Zap,
} from "lucide-react";

const features = [
  {
    icon: <Users className="h-4 w-4" />,
    title: "多用户工作空间",
    description:
      "账号注册、登录、API Key、个人额度与并发/速率限制，管理员统一管理用户与资源。",
  },
  {
    icon: <Layers className="h-4 w-4" />,
    title: "供应商库与申请审批",
    description:
      "供应商可发布到公共库或仅自己可见；其他用户提交申请，拥有者可按时间截止、请求次数、Token、模型范围审批。",
  },
  {
    icon: <WalletCards className="h-4 w-4" />,
    title: "额度与共享",
    description:
      "按供应商配置默认额度、共享预算、免审规则与分享口令；额度支持 K/M/G 预设与自定义单位。",
  },
  {
    icon: <Workflow className="h-4 w-4" />,
    title: "模型与自动路由",
    description:
      "供应商目录可拉取/增删改模型，支持单对单映射与多供应商自动路由，顺序可拖动调整。",
  },
  {
    icon: <ShieldCheck className="h-4 w-4" />,
    title: "官方账号授权中心",
    description:
      "Codex / Copilot / Grok 等官方账号统一登录、绑定供应商、按授权范围自动轮询。",
  },
  {
    icon: <Zap className="h-4 w-4" />,
    title: "用量与余额查询",
    description:
      "请求日志、按用户/供应商/模型统计、官方套餐配额进度、供应商余额查询，均带缓存与失败降级。",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-3 py-5 md:px-6">
      <section className="rounded-2xl border border-border-default bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Boxes className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              CC Switch Web · ccSwitchUint
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              面向团队的多用户供应商、模型与额度聚合平台
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          本项目 fork 自开源项目
          <a
            className="mx-1 text-primary hover:underline"
            href="https://github.com/zuoliangyu/cc-switch-web"
            target="_blank"
            rel="noreferrer"
          >
            zuoliangyu/cc-switch-web
          </a>
          ，在保留原桌面端供应商切换体验的基础上，增加了多用户体系、供应商市场、额度分配、自动路由与官方账号授权中心等能力，并针对 Web
          部署做了构建与静态资源托管优化。
        </p>
      </section>

      <section className="rounded-2xl border border-border-default bg-card p-6">
        <div className="flex items-center gap-2">
          <GitFork className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">我们的改造</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-xl border border-border-default p-4"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="text-primary">{feature.icon}</span>
                {feature.title}
              </div>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border-default bg-card p-6">
        <h2 className="text-base font-semibold">架构与部署</h2>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
          <li>
            后端：Rust（axum）+ SQLite，内置 Web 控制台与共享代理网关（默认
            8890 / 15721）。
          </li>
          <li>
            前端：React + Vite；生产环境静态资源由 `/opt/cc-switch-web/dist`
            磁盘托管，前端改动无需重编 Rust。
          </li>
          <li>
            日常联调：`bash backend/scripts/build-dev.sh`；正式发布：release +
            musl 静态链接。
          </li>
        </ul>
      </section>

      <p className="pb-4 text-center text-xs text-muted-foreground">
        原项目版权归原作者所有；本 fork 的改造代码遵循仓库根目录 LICENSE。
      </p>
    </div>
  );
}
