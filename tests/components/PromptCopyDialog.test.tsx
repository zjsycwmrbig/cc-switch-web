import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptCopyDialog } from "@/components/prompts/PromptCopyDialog";
const upsert = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ promptsApi: { upsertPrompt: upsert } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
describe("PromptCopyDialog", () => {
  beforeEach(() => upsert.mockReset());
  it("copies disabled records and retries only failed destinations", async () => {
    upsert.mockImplementation((app: string) =>
      app === "gemini"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(),
    );
    const close = vi.fn();
    render(
      <PromptCopyDialog
        source="claude"
        prompt={{
          id: "original",
          name: "Rules",
          content: "keep",
          enabled: true,
        }}
        onClose={close}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Codex" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gemini CLI" }));
    fireEvent.click(screen.getByRole("button", { name: "common.copy" }));
    await screen.findByRole("alert");
    expect(upsert).toHaveBeenCalledTimes(2);
    for (const [, id, prompt] of upsert.mock.calls) {
      expect(id).not.toBe("original");
      expect(prompt).toMatchObject({ id, content: "keep", enabled: false });
    }
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Codex" })).toBeDisabled();
    upsert.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "common.copy" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert.mock.calls[2][0]).toBe("gemini");
  });
});
