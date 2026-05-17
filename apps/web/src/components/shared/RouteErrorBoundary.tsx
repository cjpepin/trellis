import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Route crashed", error, errorInfo);
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="trellis-panel mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-4 px-8 py-10 text-center">
          <p className="font-display text-2xl text-trellis-text">This view lost its thread.</p>
          <p className="max-w-md text-sm text-trellis-muted">
            Trellis kept the rest of the app alive. You can switch views or reload the
            current route to continue.
          </p>
          {import.meta.env.DEV && this.state.error ? (
            <pre className="max-h-40 max-w-lg overflow-auto rounded-field border border-trellis-border bg-trellis-surface px-3 py-2 text-left font-mono text-[11px] leading-relaxed text-trellis-muted">
              {this.state.error.message}
            </pre>
          ) : null}
        </div>
      );
    }

    return this.props.children;
  }
}

