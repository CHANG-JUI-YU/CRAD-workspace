import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { name: string; children: ReactNode }
interface State { error?: Error }

export class PaneErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State { return { error }; }
  override componentDidCatch(error: Error, info: ErrorInfo): void { console.error(this.props.name, error, info.componentStack); }
  override render(): ReactNode {
    if (this.state.error) return <section className="pane-error"><strong>{this.props.name} 無法顯示</strong><p>{this.state.error.message}</p></section>;
    return this.props.children;
  }
}
