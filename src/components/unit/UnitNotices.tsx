import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { unit, type UnitNotices } from "./client";
import { useUnitSession } from "./session";

const POLL_MS = 60_000;
const DISMISS_KEY = "ccswitchuint-application-notice";

/** 待我审批的申请数量：登录期间轮询，供侧栏角标与登录提示共用。 */
export function usePendingApplications(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => {
      void unit<UnitNotices>("/notices")
        .then((value) => {
          if (live) setCount(Number(value.pendingApplications) || 0);
        })
        .catch(() => {
          // 通知失败不影响主流程，例如未登录或网络抖动。
        });
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return count;
}

/** 登录后展示的申请提醒：有申请待处理时给出直达入口。 */
export function UnitApplicationNotice({ onOpen }: { onOpen: () => void }) {
  const session = useUnitSession();
  const pending = usePendingApplications(Boolean(session));
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === "true",
  );
  if (!session || pending <= 0 || dismissed) return null;
  return (
    <div className="u-notice" role="status">
      <BellRing size={16} />
      <span>
        你有 {pending} 条供应商申请待审批，处理通过后申请者才能使用。
      </span>
      <button type="button" className="u-button" onClick={onOpen}>
        去处理
      </button>
      <button
        type="button"
        className="u-quiet"
        onClick={() => {
          setDismissed(true);
          sessionStorage.setItem(DISMISS_KEY, "true");
        }}
      >
        稍后
      </button>
    </div>
  );
}
