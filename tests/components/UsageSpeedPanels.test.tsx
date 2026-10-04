import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RequestDetailPanel } from "@/components/usage/RequestDetailPanel";
import { ProviderStatsTable } from "@/components/usage/ProviderStatsTable";

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  stats: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("@/lib/query/usage", () => ({
  useRequestDetail: mocks.detail,
  useProviderStats: mocks.stats,
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
        { ...base, providerId: "z", providerName: "Zulu" },
        { ...base, providerId: "a", providerName: "alpha" },
      ],
    });
    render(
      <ProviderStatsTable range={{ preset: "today" }} refreshIntervalMs={0} />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("alpha");
    expect(rows[1]).toHaveTextContent("Zulu");
    expect(rows[0]).toHaveTextContent("100 tps");
    expect(rows[0]).toHaveTextContent("40 tps");
  });
});
