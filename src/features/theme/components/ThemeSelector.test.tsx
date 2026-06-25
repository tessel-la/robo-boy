import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeSelector from './ThemeSelector';

const themes = [
  { id: 'light', name: 'Light', isDefault: true },
  { id: 'dark', name: 'Dark', isDefault: true },
  { id: 'custom-theme', name: 'Workshop', isDefault: false },
];

describe('ThemeSelector', () => {
  const selectTheme = vi.fn();
  const openThemeCreator = vi.fn();
  const deleteTheme = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('opens the menu and selects a theme', () => {
    render(
      <ThemeSelector
        currentThemeId="light"
        selectTheme={selectTheme}
        themes={themes}
        openThemeCreator={openThemeCreator}
        deleteTheme={deleteTheme}
      />
    );

    fireEvent.click(screen.getByLabelText('Select theme'));
    expect(screen.getByRole('button', { name: /dark/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dark/i }));

    expect(selectTheme).toHaveBeenCalledWith('dark');
    expect(screen.getByLabelText('Select theme')).toHaveAttribute('aria-expanded', 'false');
  });

  it('edits, deletes, and creates custom themes from the menu', () => {
    render(
      <ThemeSelector
        currentThemeId="custom-theme"
        selectTheme={selectTheme}
        themes={themes}
        openThemeCreator={openThemeCreator}
        deleteTheme={deleteTheme}
      />
    );

    fireEvent.click(screen.getByLabelText('Select theme'));
    fireEvent.click(screen.getByLabelText('Edit Workshop'));
    expect(openThemeCreator).toHaveBeenCalledWith('custom-theme');

    fireEvent.click(screen.getByLabelText('Select theme'));
    fireEvent.click(screen.getByLabelText('Delete Workshop'));
    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to delete the theme "Workshop"?');
    expect(deleteTheme).toHaveBeenCalledWith('custom-theme');

    fireEvent.click(screen.getByLabelText('Select theme'));
    fireEvent.click(screen.getByText('Create New Theme...'));
    expect(openThemeCreator).toHaveBeenCalledWith();
  });

  it('keeps the menu open when deletion is cancelled', () => {
    vi.mocked(window.confirm).mockReturnValue(false);

    render(
      <ThemeSelector
        currentThemeId="custom-theme"
        selectTheme={selectTheme}
        themes={themes}
        openThemeCreator={openThemeCreator}
        deleteTheme={deleteTheme}
      />
    );

    fireEvent.click(screen.getByLabelText('Select theme'));
    fireEvent.click(screen.getByLabelText('Delete Workshop'));

    expect(deleteTheme).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Select theme')).toHaveAttribute('aria-expanded', 'true');
  });
});
