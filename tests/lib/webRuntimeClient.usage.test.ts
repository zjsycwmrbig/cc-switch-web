import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getWebProviderUsage,
  setWebUserRole,
  testWebUsageScript,
} from "@/lib/runtime/client/web";

const usageResponse = () =>
  new Response(
    JSON.stringify({
      success: true,
      data: [{ planName: "钱包余额", remaining: 12.5, unit: "USD" }],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );

describe("Web runtime provider usage requests", () => {
  afterEach(() => {
    setWebUserRole(null);
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("uses the resource-aware Unit routes for unit users", async () => {
    setWebUserRole("user");
    sessionStorage.setItem("ccswitchuint-csrf", "csrf-token");
    const fetchMock = vi.fn().mockImplementation(async () => usageResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getWebProviderUsage("codex", "provider-1", "resource/1");
    await testWebUsageScript(
      "codex",
      "provider-1",
      {
        scriptCode: "({ extractor: function() { return { remaining: 1 }; } })",
        timeout: 5,
        templateType: "custom",
      },
      "resource/1",
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/unit/ui/library/codex/resource%2F1/usage",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": "csrf-token",
        },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/unit/ui/library/codex/resource%2F1/usage",
      expect.objectContaining({
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-token",
        },
        body: JSON.stringify({
          scriptCode:
            "({ extractor: function() { return { remaining: 1 }; } })",
          timeout: 5,
          templateType: "custom",
        }),
      }),
    );
  });

  it("keeps the administrator provider routes outside Unit mode", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => usageResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getWebProviderUsage("codex", "provider/1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/providers/codex/provider%2F1/usage",
      expect.objectContaining({
        headers: { Accept: "application/json" },
      }),
    );
  });
});
