import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * Error Boundary component for gracefully handling errors in child components.
 * Particularly useful for catching errors in 3D visualization components that
 * may fail due to WebGL issues, resource loading, or ROS connection problems.
 * 
 * Usage:
 * ```tsx
 * <ErrorBoundary fallback={<div>Something went wrong</div>}>
 *   <VisualizationComponent />
 * </ErrorBoundary>
 * ```
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        console.error('[ErrorBoundary] Caught error:', error);
        console.error('[ErrorBoundary] Error info:', errorInfo);

        // Call optional callback for external error tracking
        this.props.onError?.(error, errorInfo);
    }

    handleRetry = (): void => {
        this.setState({ hasError: false, error: null });
    };

    render(): ReactNode {
        if (this.state.hasError) {
            // Use custom fallback if provided
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // Default fallback UI
            return (
                <div className="error-boundary-fallback" style={styles.container}>
                    <div style={styles.content}>
                        <div style={styles.icon}>⚠️</div>
                        <h3 style={styles.title}>Something went wrong</h3>
                        <p style={styles.message}>
                            {this.state.error?.message || 'An unexpected error occurred'}
                        </p>
                        <button
                            onClick={this.handleRetry}
                            style={styles.button}
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

// Inline styles for the default fallback UI
const styles: Record<string, React.CSSProperties> = {
    container: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: '200px',
        backgroundColor: 'var(--error-bg, rgba(220, 53, 69, 0.1))',
        borderRadius: '8px',
        padding: '20px',
    },
    content: {
        textAlign: 'center',
        maxWidth: '400px',
    },
    icon: {
        fontSize: '48px',
        marginBottom: '16px',
    },
    title: {
        margin: '0 0 8px 0',
        fontSize: '1.25rem',
        color: 'var(--text-color, #333)',
    },
    message: {
        margin: '0 0 16px 0',
        fontSize: '0.875rem',
        color: 'var(--text-secondary, #666)',
        wordBreak: 'break-word',
    },
    button: {
        padding: '8px 24px',
        fontSize: '0.875rem',
        fontWeight: 500,
        color: 'white',
        backgroundColor: 'var(--primary-color, #4a90d9)',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
    },
};

export default ErrorBoundary;
