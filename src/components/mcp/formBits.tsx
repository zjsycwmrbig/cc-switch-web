import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, CircleAlert } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";

export const FIELD_CLASS =
  "h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 read-only:bg-muted";
export const MONO_FIELD_CLASS = `${FIELD_CLASS} font-mono text-xs`;
export const CHECKBOX_CLASS = "h-4 w-4 accent-primary";
export const LABEL_CLASS = "text-sm font-medium text-foreground";

export function FieldError({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <span id={id} className="flex items-start gap-1 text-xs text-destructive">
      <CircleAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {children}
    </span>
  );
}
export function RequiredMark({ srText }: { srText: string }) {
  return (
    <>
      <span aria-hidden className="ms-0.5 text-destructive">
        *
      </span>
      <span className="sr-only">{srText}</span>
    </>
  );
}
export function DisclosureButton({
  open,
  controls,
  onToggle,
  children,
  hint,
}: {
  open: boolean;
  controls: string;
  onToggle: () => void;
  children: ReactNode;
  hint?: ReactNode;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="inline-flex h-8 items-center gap-1.5 self-start rounded-md text-sm font-medium hover:bg-muted"
    >
      <Icon aria-hidden className="h-4 w-4" />
      {children}
      {hint && (
        <span className="text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      )}
    </button>
  );
}
export function MiniSegmented<T extends string>({
  items,
  value,
  onValueChange,
  label,
}: {
  items: { value: T; label: string }[];
  value: T;
  onValueChange: (value: T) => void;
  label: string;
}) {
  return (
    <SegmentedControl
      items={items}
      value={value}
      onValueChange={onValueChange}
      aria-label={label}
      size="sm"
    />
  );
}
