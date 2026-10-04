import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { ProviderForm } from "@/components/providers/forms/ProviderForm";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";
import { createTestQueryClient } from "../utils/testQueryClient";
import { server } from "../msw/server";
import { setSettings } from "../msw/state";

vi.mock("@/components/JsonEditor", () => ({
  default: ({ value }: { value: string }) => (
    <textarea readOnly value={value} />
  ),
}));
vi.mock("@/components/providers/forms/hooks", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/providers/forms/hooks")
  >()),
  useManagedAuth: () => ({ isAuthenticated: false, accounts: [] }),
}));
vi.mock("@/components/providers/forms/ProviderPresetSelector", () => ({
  ProviderPresetSelector: ({
    onPresetChange,
  }: {
    onPresetChange: (id: string) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          onPresetChange(
            `gemini-${geminiProviderPresets.findIndex((preset) => preset.category !== "official")}`,
          )
        }
      >
        choose-preset
      </button>
      <button type="button" onClick={() => onPresetChange("custom")}>
        choose-custom
      </button>
    </>
  ),
}));

describe("Gemini editor global baseline", () => {
  it("retains live globals when choosing a preset and returning to custom", async () => {
    setSettings({ commonConfigConfirmed: true });
    const snippetApps: string[] = [];
    server.use(
      http.post(
        "http://runtime.local/get_common_config_snippet",
        async ({ request }) => {
          const body = (await request.json()) as { app: string };
          snippetApps.push(body.app);
          return HttpResponse.json(null);
        },
      ),
    );
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ProviderForm
          appId="gemini"
          providerLiveBase={{
            env: { DEBUG: "live-debug" },
            config: {
              ui: { theme: "live-theme" },
              mcpServers: { mine: { command: "local" } },
            },
          }}
          submitLabel="save-provider"
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const assertGlobals = async () => {
      await waitFor(() => {
        const values = screen
          .getAllByRole("textbox")
          .map((element) => (element as HTMLInputElement).value);
        expect(values.some((value) => value.includes("DEBUG=live-debug"))).toBe(
          true,
        );
        expect(
          values.some(
            (value) =>
              value.includes('"live-theme"') && value.includes('"mine"'),
          ),
        ).toBe(true);
      });
    };
    await assertGlobals();
    fireEvent.click(screen.getByText("choose-preset"));
    await assertGlobals();
    fireEvent.click(screen.getByText("choose-custom"));
    await assertGlobals();
    expect(snippetApps).not.toContain("gemini");
    expect(
      screen.queryByText("geminiConfig.writeCommonConfig"),
    ).not.toBeInTheDocument();
  });
});
