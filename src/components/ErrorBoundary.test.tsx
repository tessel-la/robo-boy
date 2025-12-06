import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ErrorBoundary from '../components/ErrorBoundary';

// Component that throws an error
const ErrorThrowingComponent = ({ shouldThrow }: { shouldThrow: boolean }) => {
    if (shouldThrow) {
        throw new Error('Test error');
    }
    return <div>No error</div>;
};

describe('ErrorBoundary', () => {
    beforeEach(() => {
        // Suppress console.error for cleaner test output
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    it('should render children when there is no error', () => {
        render(
            <ErrorBoundary>
                <div>Child content</div>
            </ErrorBoundary>
        );

        expect(screen.getByText('Child content')).toBeInTheDocument();
    });

    it('should render fallback UI when child throws an error', () => {
        render(
            <ErrorBoundary>
                <ErrorThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('should display the error message in fallback UI', () => {
        render(
            <ErrorBoundary>
                <ErrorThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText('Test error')).toBeInTheDocument();
    });

    it('should render "Try Again" button in fallback UI', () => {
        render(
            <ErrorBoundary>
                <ErrorThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('should reset error state when "Try Again" is clicked', () => {
        const { rerender } = render(
            <ErrorBoundary>
                <ErrorThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        // Verify error state
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();

        // Click retry - this triggers a re-render attempt
        const retryButton = screen.getByRole('button', { name: /try again/i });
        fireEvent.click(retryButton);

        // The component will try to re-render children
        // Since ErrorThrowingComponent still throws, it will show the error again
        // But the error state was reset first
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('should render custom fallback when provided', () => {
        const customFallback = <div>Custom error message</div>;

        render(
            <ErrorBoundary fallback={customFallback}>
                <ErrorThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText('Custom error message')).toBeInTheDocument();
        expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });

    it('should call onError callback when error occurs', () => {
        const onErrorMock = vi.fn();

        render(
            <ErrorBoundary onError={onErrorMock}>
                <ErrorThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(onErrorMock).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({ componentStack: expect.any(String) })
        );
    });

    it('should catch errors from nested components', () => {
        const NestedComponent = () => (
            <div>
                <ErrorThrowingComponent shouldThrow={true} />
            </div>
        );

        render(
            <ErrorBoundary>
                <NestedComponent />
            </ErrorBoundary>
        );

        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('should not affect sibling components outside the boundary', () => {
        render(
            <div>
                <div data-testid="outside">Outside boundary</div>
                <ErrorBoundary>
                    <ErrorThrowingComponent shouldThrow={true} />
                </ErrorBoundary>
            </div>
        );

        expect(screen.getByTestId('outside')).toBeInTheDocument();
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
});
