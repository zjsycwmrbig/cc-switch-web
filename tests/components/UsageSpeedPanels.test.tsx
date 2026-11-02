import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RequestDetailPanel } from "@/components/usage/RequestDetailPanel";
import { RequestLogTable } from "@/components/usage/RequestLogTable";
import { ProviderStatsTable } from "@/components/usage/ProviderStatsTable";
import { UserStatsTable } from "@/components/usage/UserStatsTable";

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  logs: vi.fn(),
  stats: vi.fn(),
  userStats: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("@/lib/query/usage", () => ({
  useRequestDetail: mocks.detail,
  useRequestLogs: mocks.logs,
  useProviderStats: mocks.stats,
  useUserStats: mocks.userStats,
}));

describe("用量详情与供应商速度", () => {
  it("详情读取失败展示真实错误并允许重试，不显示未找到", () => {
    mocks.detail.mockReturnValue({
      isLoading: false,
      error: new Error("query failed"),
      refetch: mocks.retry,
    });
    render(<RequestDetailPanel requestId="request" onClose={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("query failed");
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
  it("供应商统计仍按名称 A–Z，精确速度与会话估算分列", () => {
    const base = {
      requestCount: 1,
      totalTokens: 1000,
      totalCost: "0",
      successRate: 100,
      avgLatencyMs: 1000,
      speedOutputTokens: 1000,
      speedGenerationMs: 10000,
      estSpeedOutputTokens: 200,
      estSpeedDurationMs: 5000,
    };
    mocks.stats.mockReturnValue({
      isLoading: false,
      data: [
        { ...base, providerId: "z", providerName: "Zulu", ownerName: "Bob" },
        { ...base, providerId: "a", providerName: "alpha", ownerName: "alice" },
      ],
    });
    render(
      <ProviderStatsTable range={{ preset: "today" }} refreshIntervalMs={0} />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("alpha");
    expect(rows[0]).toHaveTextContent("alice");
    expect(rows[1]).toHaveTextContent("Zulu");
    expect(rows[1]).toHaveTextContent("Bob");
    expect(rows[0]).toHaveTextContent("100 tps");
    expect(rows[0]).toHaveTextContent("40 tps");
  });
  it("用户统计按用户名排序", () => {
    const base = {
      requestCount: 2,
      totalTokens: 300,
      totalCost: "0.01",
      successRate: 100,
      avgLatencyMs: 500,
    };
    mocks.userStats.mockReturnValue({
      isLoading: false,
      data: [
        { ...base, userId: "bob", username: "Bob" },
        { ...base, userId: "alice", username: "alice" },
      ],
    });

    render(
      <UserStatsTable range={{ preset: "today" }} refreshIntervalMs={0} />,
    );

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("alice");
    expect(rows[1]).toHaveTextContent("Bob");
  });
  it("请求日志只展示计费模型，不展示模型映射", () => {
    mocks.logs.mockReturnValue({
      isLoading: false,
      data: {
        data: [
          {
            requestId: "request",
            providerId: "bob",
            providerName: "Bob",
            ownerName: "bob",
            appType: "codex",
            requestModel: "ccs-openai/gpt-6.1-sol",
            model: "gpt-6.1-sol",
            username: "alice",
            costMultiplier: "1",
            inputTokens: 10,
            outputTokens: 20,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            inputCostUsd: "0",
            outputCostUsd: "0",
            cacheReadCostUsd: "0",
            cacheCreationCostUsd: "0",
            totalCostUsd: "0.01",
            isStreaming: false,
            latencyMs: 1000,
            statusCode: 200,
            createdAt: 1_750_000_000,
          },
        ],
        total: 1,
        page: 0,
        pageSize: 20,
      },
    });

    render(
      <RequestLogTable
        range={{ preset: "today" }}
        rangeLabel="today"
        refreshIntervalMs={0}
      />,
    );

    expect(screen.getByText("gpt-6.1-sol")).toBeInTheDocument();
    expect(
      screen.queryByText("ccs-openai/gpt-6.1-sol"),
    ).not.toBeInTheDocument();
  });
  it("待核用量的零值显示为未知而不是真实零消耗", () => {
    mocks.logs.mockReturnValue({
      isLoading: false,
      data: {
        data: [
          {
            requestId: "pending",
            providerId: "openai",
            providerName: "OpenAI Official",
            ownerName: "zhangjinsheng",
            appType: "codex",
            requestModel: "ccs-openai/gpt-6-astra",
            model: "gpt-6-astra",
            username: "zhangjinsheng",
            costMultiplier: "1",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            inputCostUsd: "0",
            outputCostUsd: "0",
            cacheReadCostUsd: "0",
            cacheCreationCostUsd: "0",
            totalCostUsd: "0",
            costUnknown: true,
            isStreaming: true,
            latencyMs: 29_300,
            statusCode: 200,
            errorMessage: "usage_unavailable",
            createdAt: 1_750_000_000,
            state: "pending_usage",
          },
        ],
        total: 1,
        page: 0,
        pageSize: 20,
      },
    });

    render(
      <RequestLogTable
        range={{ preset: "today" }}
        rangeLabel="today"
        refreshIntervalMs={0}
      />,
    );

    expect(screen.getByText("计量待核")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("$0.0000")).not.toBeInTheDocument();
  });
});
