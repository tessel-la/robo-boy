import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CommaListInput, { parseCommaList } from './CommaListInput';

describe('CommaListInput', () => {
  it('parses a list: items trimmed, empty ones dropped', () => {
    expect(parseCommaList(' a, b ,, c,')).toEqual(['a', 'b', 'c']);
    expect(parseCommaList('')).toEqual([]);
  });

  it('shows the text as typed, separators included, while the parent keeps the reported list', () => {
    const reported: string[][] = [];
    const Parent = () => {
      const [items, setItems] = React.useState(['0']);
      return <CommaListInput aria-label="Axes" value={items} onChange={next => { reported.push(next); setItems(next); }} />;
    };
    render(<Parent />);
    const input = screen.getByLabelText('Axes');

    fireEvent.change(input, { target: { value: '0,' } });
    expect(input).toHaveValue('0,');
    fireEvent.change(input, { target: { value: '0, ' } });
    expect(input).toHaveValue('0, ');
    fireEvent.change(input, { target: { value: '0, 3' } });
    expect(input).toHaveValue('0, 3');
    expect(reported).toEqual([['0'], ['0'], ['0', '3']]);
  });

  it('replaces the text when the list is set elsewhere', () => {
    const { rerender } = render(<CommaListInput aria-label="Axes" value={['linear.x', 'linear.y']} onChange={vi.fn()} />);
    rerender(<CommaListInput aria-label="Axes" value={['linear.x', 'angular.z']} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Axes')).toHaveValue('linear.x, angular.z');
  });
});
