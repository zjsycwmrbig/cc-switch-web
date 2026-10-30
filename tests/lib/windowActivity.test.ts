import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeWindowActivity,
  isWindowSleeping,
  setWindowIdleSleepEnabled,
  WINDOW_IDLE_SLEEP_MS,
  WindowSleepingError,
} from "@/lib/windowActivity";
import { webFetch } from "@/lib/runtime/client/web";
import { focusManager } from "@tanstack/react-query";
import "@/lib/query/queryClient";

describe("initializeWindowActivity", () => {
  afterEach(() => {
    setWindowIdleSleepEnabled(true);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("一分钟无活动后休眠，交互唤醒前不发起后端请求", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    initializeWindowActivity();
    vi.advanceTimersByTime(WINDOW_IDLE_SLEEP_MS - 1);
    expect(isWindowSleeping()).toBe(false);
    expect(document.documentElement.dataset.windowSleeping).toBe("false");

    vi.advanceTimersByTime(1);
    expect(isWindowSleeping()).toBe(true);
    expect(document.documentElement.dataset.windowSleeping).toBe("true");
    expect(focusManager.isFocused()).toBe(false);

    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    expect(() => webFetch("/api/unit/me")).toThrow(WindowSleepingError);
    expect(fetchMock).not.toHaveBeenCalled();

    document.dispatchEvent(new Event("pointerdown"));
    expect(isWindowSleeping()).toBe(false);
    expect(focusManager.isFocused()).toBe(true);
    await webFetch("/api/unit/me");
    expect(fetchMock).toHaveBeenCalledOnce();

    let pendingSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          pendingSignal = init?.signal as AbortSignal;
          pendingSignal.addEventListener(
            "abort",
            () => reject(pendingSignal?.reason),
            { once: true },
          );
        }),
    );
    const pending = webFetch("/api/unit/pending");
    vi.advanceTimersByTime(WINDOW_IDLE_SLEEP_MS);

    expect(pendingSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("关闭前端休眠后不会因空闲暂停请求", () => {
    vi.useFakeTimers();
    setWindowIdleSleepEnabled(false);
    initializeWindowActivity();

    vi.advanceTimersByTime(WINDOW_IDLE_SLEEP_MS * 2);

    expect(isWindowSleeping()).toBe(false);
    expect(document.documentElement.dataset.windowSleeping).toBe("false");
  });
});
