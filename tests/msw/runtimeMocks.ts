import fetchPolyfill, { Request } from "cross-fetch";
import { vi } from "vitest";
import { server } from "./server";

const RUNTIME_ENDPOINT = "http://runtime.local";

// Keep jsdom's AbortSignal for DOM events and use a compatible fetch implementation.
Object.assign(globalThis, { fetch: fetchPolyfill, Request });

vi.mock("@/lib/runtime/client/core", () => ({
  invoke: async (command: string, payload: Record<string, unknown> = {}) => {
    const response = await fetch(`${RUNTIME_ENDPOINT}/${command}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload ?? {}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Invoke failed for ${command}`);
    }

    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  },
}));

const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();

const ensureListenerSet = (event: string) => {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  return listeners.get(event)!;
};

export const emitRuntimeEvent = (event: string, payload: unknown) => {
  const handlers = listeners.get(event);
  handlers?.forEach((handler) => handler({ payload }));
};

vi.mock("@/lib/runtime/client/event", () => ({
  listen: async (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    const set = ensureListenerSet(event);
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  },
}));

// Ensure the MSW server is referenced so tree shaking doesn't remove imports
void server;
