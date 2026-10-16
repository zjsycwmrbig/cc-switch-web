import { Component, type ErrorInfo, type ReactNode } from "react";
import { toast } from "sonner";

interface PanelErrorBoundaryProps {
  label: string;
  children: ReactNode;
}

/**
 * 懒加载面板的兜底：渲染或分块加载失败时给出可读提示。
 * 不做整页替换，出错后保持当前界面可用。
 */
export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[PanelErrorBoundary]", this.props.label, error, info);
    toast.error(
      `${this.props.label}打开失败：${
        error instanceof Error ? error.message : String(error)
      }`,
      { duration: 8000 },
    );
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
