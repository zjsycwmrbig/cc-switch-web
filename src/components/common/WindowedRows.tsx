import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/** Small collections retain ordinary DOM; large ones measure only visible rows. */
export function WindowedRows({
  children,
  grid = false,
}: {
  children: ReactNode;
  grid?: boolean;
}) {
  const items = Children.toArray(children);
  const parent = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const enabled = items.length > 100;
  useEffect(() => {
    const element = parent.current;
    if (!grid || !enabled || !element) return;
    const measure = () =>
      setColumns(
        element.clientWidth >= 1100 ? 3 : element.clientWidth >= 700 ? 2 : 1,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [grid, enabled]);
  const stride = grid ? columns : 1;
  const virtual = useVirtualizer({
    count: Math.ceil(items.length / stride),
    enabled,
    getScrollElement: () => parent.current,
    estimateSize: () => (grid ? 230 : 84),
    overscan: 5,
    getItemKey: (index) =>
      `${stride}:${(items[index * stride] as { key?: string }).key ?? index}`,
  });
  if (!enabled)
    return (
      <div
        className={
          grid
            ? "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
            : undefined
        }
      >
        {items}
      </div>
    );
  return (
    <div ref={parent} className="h-[65vh] min-h-0 overflow-y-auto">
      <div
        style={{
          height: virtual.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtual.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtual.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${row.start}px)`,
              ...(grid
                ? {
                    display: "grid",
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gap: 16,
                    paddingBottom: 16,
                  }
                : {}),
            }}
          >
            {items.slice(row.index * stride, (row.index + 1) * stride)}
          </div>
        ))}
      </div>
    </div>
  );
}
