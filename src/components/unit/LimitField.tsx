import { useEffect, useRef, useState } from "react";
import { formatNumber } from "./client";
import "./unit.css";

const UNITS = [
  { key: "1", label: "无", scale: 1 },
  { key: "K", label: "K", scale: 1_000 },
  { key: "M", label: "M", scale: 1_000_000 },
  { key: "G", label: "G", scale: 1_000_000_000 },
] as const;

type LimitUnit = (typeof UNITS)[number]["key"];
export type LimitKind = "requests" | "tokens";

/** 常用档位；最后一项永远是“自定义”。 */
const PRESETS: Record<LimitKind, number[]> = {
  tokens: [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 100_000_000],
  requests: [10, 100, 1_000, 10_000, 100_000, 1_000_000],
};

function unitScale(unit: LimitUnit): number {
  return UNITS.find((item) => item.key === unit)?.scale ?? 1;
}

function pickUnit(value?: number | null): LimitUnit {
  const abs = Math.abs(value ?? 0);
  if (abs >= 1_000_000_000) return "G";
  if (abs >= 1_000_000) return "M";
  if (abs >= 1_000) return "K";
  return "1";
}

function formatIn(value: number, unit: LimitUnit): string {
  const scaled = value / unitScale(unit);
  return Number.isInteger(scaled)
    ? String(scaled)
    : String(Number(scaled.toFixed(3)));
}

/** 100000 -> 100K，10000000 -> 10M */
function compact(value: number): string {
  const unit = pickUnit(value);
  if (unit === "1") return String(value);
  return `${formatIn(value, unit)}${unit}`;
}

/**
 * 额度输入：常用档位下拉 + 自定义数值。
 *
 * 自定义模式下单位会按数值自动切换（输入 10000000 失焦后显示为 10M），
 * 内部始终按绝对数值保存。
 */
export function LimitField({
  value,
  change,
  kind = "tokens",
}: {
  value?: number | null;
  change: (value: number | null) => void;
  kind?: LimitKind;
}) {
  const presets = PRESETS[kind];
  const isPreset = value != null && presets.includes(value);
  const [custom, setCustom] = useState(
    () => value != null && !presets.includes(value),
  );
  const [unit, setUnit] = useState<LimitUnit>(() => pickUnit(value));
  const [text, setText] = useState(() =>
    value == null ? "" : formatIn(value, pickUnit(value)),
  );
  // 记录最近一次写出的值，避免输入过程中被外部同步打断。
  const committed = useRef<number | null>(value ?? null);

  useEffect(() => {
    const next = value ?? null;
    if (next === committed.current) return;
    committed.current = next;
    const preset = next != null && presets.includes(next);
    setCustom(next != null && !preset);
    const nextUnit = pickUnit(next);
    setUnit(nextUnit);
    setText(next == null ? "" : formatIn(next, nextUnit));
    // presets 是常量表，无需列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (nextText: string) => {
    const trimmed = nextText.trim();
    if (!trimmed) {
      committed.current = null;
      change(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    // 自定义输入按“绝对值”理解，单位只用于显示（输入 10000000 -> 10M）。
    const next = Math.round(parsed);
    committed.current = next;
    change(next);
  };

  const selectValue = value == null ? "unlimited" : isPreset ? String(value) : "custom";

  return (
    <div className="u-limit-field">
      <div className="u-limit-chips">
        <button
          type="button"
          className={selectValue === "unlimited" ? "active" : ""}
          onClick={() => {
            setCustom(false);
            committed.current = null;
            change(null);
          }}
        >
          不限
        </button>
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={selectValue === String(preset) ? "active" : ""}
            onClick={() => {
              setCustom(false);
              committed.current = preset;
              change(preset);
            }}
          >
            {compact(preset)}
          </button>
        ))}
        <div className={`u-limit-custom ${selectValue === "custom" ? "active" : ""}`}>
          <input
            type="text"
            inputMode="decimal"
            placeholder="自定义"
            value={custom ? text : ""}
            onFocus={() => {
              setCustom(true);
              if (value != null) {
                const nextUnit = pickUnit(value);
                setUnit(nextUnit);
                setText(String(value));
              }
            }}
            onChange={(event) => {
              setCustom(true);
              setText(event.target.value);
              commit(event.target.value);
            }}
            onBlur={() => {
              if (value == null) {
                setText("");
                return;
              }
              const nextUnit = pickUnit(value);
              setUnit(nextUnit);
              setText(formatIn(value, nextUnit));
            }}
          />
          {text.trim() ? (
            <span className="u-limit-unit" aria-label="额度单位">
              {UNITS.find((item) => item.key === unit)?.label ?? "无"}
            </span>
          ) : null}
        </div>
      </div>
      {custom && (
        <small className="u-limit-hint">
          {value == null
            ? "留空表示不限"
            : `= ${formatNumber(value)}${kind === "requests" ? " 次" : " Token"}`}
        </small>
      )}
    </div>
  );
}
