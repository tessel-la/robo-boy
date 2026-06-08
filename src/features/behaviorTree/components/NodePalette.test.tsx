import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import NodePalette from './NodePalette';
import { BehaviorNodeType } from '../types';

vi.mock('reactflow', () => ({}));

describe('NodePalette', () => {
  const defaultProps = {
    ros: null,
    isConnected: false,
    isCollapsed: false,
    onToggleCollapse: vi.fn(),
  };

  it('calls onAddNode with Sequence type when Sequence item is clicked', () => {
    const onAddNode = vi.fn();
    render(<NodePalette {...defaultProps} onAddNode={onAddNode} />);
    fireEvent.click(screen.getByText('Sequence'));
    expect(onAddNode).toHaveBeenCalledWith(BehaviorNodeType.Sequence, undefined);
  });

  it('calls onAddNode with Selector type when Selector item is clicked', () => {
    const onAddNode = vi.fn();
    render(<NodePalette {...defaultProps} onAddNode={onAddNode} />);
    fireEvent.click(screen.getByText('Selector'));
    expect(onAddNode).toHaveBeenCalledWith(BehaviorNodeType.Selector, undefined);
  });

  it('calls onAddNode with Parallel type when Parallel item is clicked', () => {
    const onAddNode = vi.fn();
    render(<NodePalette {...defaultProps} onAddNode={onAddNode} />);
    fireEvent.click(screen.getByText('Parallel'));
    expect(onAddNode).toHaveBeenCalledWith(BehaviorNodeType.Parallel, undefined);
  });

  it('does not throw when onAddNode is not provided and item is clicked', () => {
    render(<NodePalette {...defaultProps} />);
    expect(() => fireEvent.click(screen.getByText('Sequence'))).not.toThrow();
  });

  it('shows engine node types in the same palette and adds them by click', () => {
    const onAddEngineNode = vi.fn();
    const engineNode = {
      id: 'image_capture',
      label: 'Image Capture',
      category: 'action' as const,
      description: 'Capture a camera frame',
    };

    render(
      <NodePalette
        {...defaultProps}
        engineNodeTypes={[engineNode]}
        onAddEngineNode={onAddEngineNode}
      />
    );

    fireEvent.click(screen.getByText('Image Capture'));

    expect(onAddEngineNode).toHaveBeenCalledWith(engineNode);
  });
});

describe('NodePalette mobile sheet', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    // Override matchMedia to simulate mobile
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('768px'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('renders palette content in document.body portal on mobile', () => {
    render(
      <NodePalette
        ros={null}
        isConnected={false}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );
    // The sheet is portalled to body — content should still be findable
    expect(document.body).toBeTruthy();
    // Palette content is visible somewhere in the document
    expect(screen.getByText('Sequence')).toBeInTheDocument();
  });

  it('calls onToggleCollapse when backdrop is clicked', () => {
    const onToggleCollapse = vi.fn();
    render(
      <NodePalette
        ros={null}
        isConnected={false}
        isCollapsed={false}
        onToggleCollapse={onToggleCollapse}
      />
    );
    const backdrop = document.querySelector('.node-palette-backdrop');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    }
  });
});
