export const WINDOW_ACTIVITY_CHANGE_EVENT = "cc-switch-window-activity-change";
export const WINDOW_IDLE_SLEEP_MS = 60_000;
export const WINDOW_IDLE_SLEEP_STORAGE_KEY =
  "cc-switch-window-idle-sleep-enabled";

export interface WindowActivityChangeDetail {
  sleeping: boolean;
}

const HEARTBEAT_INTERVAL_MS = 3000;
const HEARTBEAT_DIM_MS = 300;

let initialized = false;
let sleeping = false;
let idleTimer: number | undefined;
let heartbeatInterval: number | undefined;
let heartbeatReset: number | undefined;
let idleSleepEnabled = readIdleSleepPreference();

function readIdleSleepPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return (
      window.localStorage.getItem(WINDOW_IDLE_SLEEP_STORAGE_KEY) !== "false"
    );
  } catch {
    return true;
  }
}

export class WindowSleepingError extends Error {
  readonly code = "WINDOW_SLEEPING";

  constructor() {
    super("页面已休眠，请先进行操作唤醒");
    this.name = "WindowSleepingError";
  }
}

export function isWindowSleeping(): boolean {
  return (
    sleeping ||
    (typeof document !== "undefined" &&
      document.documentElement.dataset.windowSleeping === "true")
  );
}

export function isWindowIdleSleepEnabled(): boolean {
  return idleSleepEnabled;
}

export function setWindowIdleSleepEnabled(enabled: boolean): void {
  idleSleepEnabled = enabled;
  try {
    window.localStorage.setItem(WINDOW_IDLE_SLEEP_STORAGE_KEY, String(enabled));
  } catch {
    // The setting still applies for this page when storage is unavailable.
  }
  if (enabled) {
    recordActivity();
    return;
  }
  if (idleTimer !== undefined) {
    window.clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  setSleeping(false);
  syncHeartbeat();
}

export function assertWindowAwake(): void {
  if (isWindowSleeping()) {
    throw new WindowSleepingError();
  }
}

function stopHeartbeat() {
  if (heartbeatInterval !== undefined) window.clearInterval(heartbeatInterval);
  if (heartbeatReset !== undefined) window.clearTimeout(heartbeatReset);
  heartbeatInterval = undefined;
  heartbeatReset = undefined;
  delete document.documentElement.dataset.statusHeartbeat;
}

function syncHeartbeat() {
  const active =
    !sleeping && document.visibilityState === "visible" && document.hasFocus();
  document.documentElement.dataset.windowActive = String(active);
  if (!active) {
    stopHeartbeat();
    return;
  }
  if (heartbeatInterval !== undefined) return;

  heartbeatInterval = window.setInterval(() => {
    document.documentElement.dataset.statusHeartbeat = "true";
    heartbeatReset = window.setTimeout(() => {
      delete document.documentElement.dataset.statusHeartbeat;
      heartbeatReset = undefined;
    }, HEARTBEAT_DIM_MS);
  }, HEARTBEAT_INTERVAL_MS);
}

function setSleeping(next: boolean) {
  if (sleeping === next) return;
  sleeping = next;
  document.documentElement.dataset.windowSleeping = String(sleeping);
  syncHeartbeat();
  window.dispatchEvent(
    new CustomEvent<WindowActivityChangeDetail>(WINDOW_ACTIVITY_CHANGE_EVENT, {
      detail: { sleeping },
    }),
  );
}

function scheduleSleep() {
  if (idleTimer !== undefined) window.clearTimeout(idleTimer);
  if (!idleSleepEnabled) {
    idleTimer = undefined;
    return;
  }
  idleTimer = window.setTimeout(() => {
    idleTimer = undefined;
    setSleeping(true);
  }, WINDOW_IDLE_SLEEP_MS);
}

function recordActivity() {
  setSleeping(false);
  if (idleSleepEnabled) {
    scheduleSleep();
  }
  syncHeartbeat();
}

export function initializeWindowActivity() {
  if (initialized) return;
  initialized = true;
  document.documentElement.dataset.windowSleeping = String(sleeping);

  const updateVisibility = () => {
    if (document.visibilityState === "visible") {
      recordActivity();
    } else {
      syncHeartbeat();
    }
  };
  const capture = { capture: true, passive: true } as const;

  syncHeartbeat();
  scheduleSleep();
  window.addEventListener("focus", recordActivity);
  window.addEventListener("blur", syncHeartbeat);
  document.addEventListener("visibilitychange", updateVisibility);
  document.addEventListener("pointerdown", recordActivity, capture);
  document.addEventListener("pointermove", recordActivity, capture);
  document.addEventListener("keydown", recordActivity, capture);
  document.addEventListener("touchstart", recordActivity, capture);
  document.addEventListener("wheel", recordActivity, capture);
  document.addEventListener("scroll", recordActivity, capture);
}
