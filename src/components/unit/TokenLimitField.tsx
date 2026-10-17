import { useEffect, useRef, useState } from "react";
import { formatNumber } from "./client";

const UNITS = [
  { key: "K", scale: 1_000 },
  { key: "M", scale: 1_000_000 },
  { key: "G", scale: 1_000_000_000 },
] as const;

export type TokenUnit = (typeof UNITS)[number]["key"];

function unitScale(unit: TokenUnit): number {
  return UNITS.find((item) => item.key === unit)?.scale ?? 1;
}

/** 按数值大小挑一个顺眼的默认单位。 */
function pickUnit(value?: number | null): TokenUnit {
  const abs = Math.abs(value ?? 0);
  if (abs >= 1_000_000_000) return "G";
  if (abs >= 1_000_000) return "M";
  return "K";
}

function formatAmount(value: number | null | undefined, unit: TokenUnit): string {
  if (value == null) return "";
  const scaled = value / unitScale(unit);
  return Number.isInteger(scaled)
    ? String(scaled)
    : String(Number(scaled.toFixed(3)));
}

/**
 * Token 额度输入：数字 + 单位下拉（K/M/G）。
 *
 * 内部始终按绝对数值保存，切换单位只是换个显示刻度，不会悄悄改额度。
 */
export function TokenLimitField({
  value,
  change,
  placeholder = "不限",
}: {
  value?: number | null;
  change: (value: number | null) => void;
  placeholder?: string;
}) {
  const [unit, setUnit] = useState<TokenUnit>(() => pickUnit(value));
  const [text, setText] = useState(() => formatAmount(value, pickUnit(value)));
  // 记录最近一次由本控件写出的值，避免输入过程中被外部同步打断。
  const committed = useRef<number | null>(value ?? null);

  useEffect(() => {
    const next = value ?? null;
    if (next !== committed.current) {
      committed.current = next;
      const nextUnit = pickUnit(next);
      setUnit(nextUnit);
      setText(formatAmount(next, nextUnit));
    }
  }, [value]);

  const commit = (nextText: string, nextUnit: TokenUnit) => {
    const trimmed = nextText.trim();
    if (!trimmed) {
      committed.current = null;
      change(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const next = Math.round(parsed * unitScale(nextUnit));
    committed.current = next;
    change(next);
  };

  return (
    <div className="u-token-field">
      <input
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          commit(event.target.value, unit);
        }}
      />
      <select
        aria-label="Token 单位"
        value={unit}
        onChange={(event) => {
          const next = event.target.value as TokenUnit;
          setUnit(next);
          setText(formatAmount(value ?? null, next));
        }}
      >
        {UNITS.map((item) => (
          <option key={item.key} value={item.key}>
            {item.key}
          </option>
        ))}
      </select>
      <small>
        {value == null ? "不限" : `= ${formatNumber(value)} Token`}
      </small>
    </div>
  );
}
