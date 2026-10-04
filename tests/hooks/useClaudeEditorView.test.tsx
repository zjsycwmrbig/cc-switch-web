import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { providersApi, type ProviderEditorView } from "@/lib/api/providers";
import { useProviderEditorView } from "@/hooks/useProviderEditorView";

afterEach(() => vi.restoreAllMocks());

describe("Claude editor snapshot", () => {
  it("ignores an old provider response and reloads after closing", async () => {
    let finishOld!: (view: ProviderEditorView) => void;
    const get = vi
      .spyOn(providersApi, "getClaudeEditorView")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValue({ settings: { theme: "new" }, inactive: [] });
    const { result, rerender } = renderHook(
      ({ open, id }) => useProviderEditorView(open, {}, id),
      { initialProps: { open: true, id: "a" } },
    );
    rerender({ open: true, id: "b" });
    await waitFor(() =>
      expect(result.current.view?.settings.theme).toBe("new"),
    );
    await act(async () =>
      finishOld({ settings: { theme: "old" }, inactive: [] }),
    );
    expect(result.current.view?.settings.theme).toBe("new");
    rerender({ open: false, id: "b" });
    expect(result.current.view).toBeUndefined();
    rerender({ open: true, id: "b" });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  });

  it("has no savable snapshot on read failure and supports retry", async () => {
    vi.spyOn(providersApi, "getClaudeEditorView")
      .mockRejectedValueOnce(new Error("malformed settings"))
      .mockResolvedValueOnce({ settings: { hooks: {} }, inactive: [] });
    const { result } = renderHook(() => useProviderEditorView(true, {}, "add"));
    await waitFor(() => expect(result.current.error).toContain("malformed"));
    expect(result.current.view).toBeUndefined();
    act(() => result.current.retry());
    await waitFor(() =>
      expect(result.current.view?.settings).toEqual({ hooks: {} }),
    );
    expect(result.current.error).toBeUndefined();
  });
});
