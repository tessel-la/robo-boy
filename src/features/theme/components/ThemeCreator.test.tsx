import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeCreator from './ThemeCreator';
import { DEFAULT_THEME_FONT_FAMILY } from '../themeUtils';

vi.mock('uuid', () => ({ v4: () => 'generated-theme-id' }));

describe('ThemeCreator', () => {
  const onClose = vi.fn();
  const onSave = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('renders nothing when closed', () => {
    const { container } = render(<ThemeCreator isOpen={false} onClose={onClose} onSave={onSave} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('creates a new theme with selected colors, icon, and font', () => {
    render(<ThemeCreator isOpen onClose={onClose} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Theme Name'), { target: { value: ' Shop Floor ' } });
    fireEvent.change(screen.getByLabelText('Primary'), { target: { value: '#112233' } });
    fireEvent.click(screen.getByLabelText('Select star icon'));
    fireEvent.change(screen.getByLabelText('Font'), { target: { value: DEFAULT_THEME_FONT_FAMILY } });
    fireEvent.click(screen.getByText('Save Theme'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'generated-theme-id',
        name: 'Shop Floor',
        iconId: 'star',
        fontFamily: DEFAULT_THEME_FONT_FAMILY,
        colors: expect.objectContaining({ primary: '#112233' }),
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('requires a non-empty theme name', () => {
    render(<ThemeCreator isOpen onClose={onClose} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Theme Name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save Theme'));

    expect(window.alert).toHaveBeenCalledWith('Please enter a theme name.');
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('pre-populates and updates an existing theme', () => {
    render(
      <ThemeCreator
        isOpen
        onClose={onClose}
        onSave={onSave}
        existingTheme={{
          id: 'existing-theme',
          name: 'Existing',
          iconId: 'moon',
          fontFamily: DEFAULT_THEME_FONT_FAMILY,
          colors: { primary: '#000001', secondary: '#000002', background: '#ffffff' },
        }}
      />
    );

    expect(screen.getByLabelText('Theme Name')).toHaveValue('Existing');
    expect(screen.getByLabelText('Select moon icon')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByLabelText('Theme Name'), { target: { value: 'Updated' } });
    fireEvent.click(screen.getByText('Save Theme'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'existing-theme',
        name: 'Updated',
        iconId: 'moon',
      })
    );
  });
});
