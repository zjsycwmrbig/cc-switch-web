import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SegmentedControl<T extends string>({
  items,
  value,
  onValueChange,
  size = "md",
  className,
  "aria-label": label,
}: {
  items: {
    value: T;
    label: ReactNode;
    disabled?: boolean;
    className?: string;
  }[];
  value: T;
  onValueChange: (value: T) => void;
  size?: "md" | "sm";
  className?: string;
  "aria-label": string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex rounded-lg bg-muted p-1", className)}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          disabled={item.disabled}
          aria-pressed={value === item.value}
          onClick={() => onValueChange(item.value)}
          className={cn(
            "rounded-md px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            size === "sm" ? "py-1 text-xs" : "py-1.5 text-sm",
            value === item.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
            "disabled:opacity-50 disabled:pointer-events-none",
            item.className,
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
