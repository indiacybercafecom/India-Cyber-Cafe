import { Component, ReactNode, ErrorInfo } from 'react';
import { IconRenderer } from './Icons';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center p-6 sm:p-8 bg-red-50 rounded-2xl border-2 border-red-200 min-h-40">
          <IconRenderer name="circle-exclamation" className="w-8 h-8 sm:w-10 sm:h-10 text-red-500 mb-3" />
          <h3 className="text-lg sm:text-xl font-bold text-red-700 mb-2">Something went wrong</h3>
          <p className="text-sm text-red-600 text-center mb-4 max-w-sm">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="btn-primary py-2 px-4 text-sm"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
