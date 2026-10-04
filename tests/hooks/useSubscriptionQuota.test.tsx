import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { useCodexOauthQuotaByAccountId } from "@/lib/query/subscription";
import type { SubscriptionQuota } from "@/types/subscription";
import { createTestQueryClient } from "../utils/testQueryClient";

describe("subscription quota account isolation", () => {
  it("does not display the previous account's quota after a transient failure", async () => {
    const client = createTestQueryClient();
    const success: SubscriptionQuota = {
      tool: "codex",
      credentialStatus: "valid",
      credentialMessage: null,
      success: true,
      tiers: [{ name: "five_hour", utilization: 12, resetsAt: null }],
      extraUsage: null,
      error: null,
      queriedAt: Date.now(),
    };
    const failure: SubscriptionQuota = {
      ...success,
      success: false,
      tiers: [],
      error: "API error (HTTP 503)",
    };
    const key = (account: string) => ["codex_oauth", "quota", account];
    client.setQueryData(key("alice"), success);
    client.setQueryData(key("bob"), failure);
    const { result, rerender, unmount } = renderHook(
      ({ account }) =>
        useCodexOauthQuotaByAccountId(account, { enabled: false }),
      {
        initialProps: { account: "alice" },
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    expect(result.current.data?.success).toBe(true);
    act(() => client.setQueryData(key("alice"), failure));
    await waitFor(() => expect(result.current.data?.success).toBe(true));
    rerender({ account: "bob" });
    expect(result.current.data?.success).toBe(false);
    expect(result.current.data?.error).toBe("API error (HTTP 503)");
    unmount();
    client.clear();
  });
});
