import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class RouteErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(): State {
    return {
      hasError: true
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
        </div>
      );
    }

    return this.props.children;
  }
}

