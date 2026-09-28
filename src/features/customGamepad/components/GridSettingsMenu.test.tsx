import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GridSettingsMenu from './GridSettingsMenu';

describe('GridSettingsMenu', () => {
  it('does not shrink the grid past the last column and row a component uses', () => {
    const onGridSizeChange = vi.fn();
    render(
      <GridSettingsMenu
        contentOnly
        layoutName="Pad"
        layoutDescription=""
        gridWidth={6}
        gridHeight={4}
        minGridWidth={6}
        minGridHeight={3}
        onNameChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onGridSizeChange={onGridSizeChange}
      />
    );

    const narrower = screen.getByTitle('A component uses the last column: move or shrink it first');
    expect(narrower).toBeDisabled();
    fireEvent.click(screen.getByTitle('Decrease height'));
    expect(onGridSizeChange).toHaveBeenCalledWith(6, 3);
    fireEvent.click(screen.getByTitle('Increase width'));
    expect(onGridSizeChange).toHaveBeenCalledWith(7, 4);
  });
});
