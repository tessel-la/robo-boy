import { describe, it, expect, vi } from 'vitest';
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
});
