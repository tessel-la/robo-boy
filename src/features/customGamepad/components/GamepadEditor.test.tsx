import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Ros } from 'roslib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GamepadEditor from './GamepadEditor';

const saveCustomGamepad = vi.fn(() => true);

vi.mock('../gamepadStorage', () => ({
  generateGamepadId: () => 'custom-new-gamepad',
  saveCustomGamepad: () => saveCustomGamepad(),
}));

vi.mock('./CustomGamepadLayout', () => ({
  default: ({ layout }: { layout: { name: string } }) => <div data-testid="editor-canvas">{layout.name}</div>,
}));

vi.mock('./ComponentPalette', () => ({
  default: ({ contentOnly }: { contentOnly?: boolean }) => (
    <div data-testid="component-gallery">{contentOnly ? 'contained gallery' : 'legacy gallery'}</div>
  ),
}));

vi.mock('./GridSettingsMenu', () => ({
  default: ({ contentOnly }: { contentOnly?: boolean }) => (
    <div data-testid="layout-settings">{contentOnly ? 'contained settings' : 'legacy settings'}</div>
  ),
}));

vi.mock('./ComponentSettingsModal', () => ({
  default: () => null,
}));

describe('GamepadEditor tool panels', () => {
  beforeEach(() => {
    saveCustomGamepad.mockClear();
  });

  it('keeps editor tools beside the design canvas and switches them from the header', () => {
    render(
      <GamepadEditor
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        ros={{} as Ros}
      />
    );

    const workspace = screen.getByTestId('editor-canvas').parentElement?.parentElement;
    expect(workspace).toHaveClass('editor-workspace', 'has-tools-panel');
    expect(screen.getByRole('complementary', { name: 'Components' }).parentElement).toBe(workspace);
    expect(screen.getByTestId('component-gallery')).toHaveTextContent('contained gallery');
    expect(screen.getByRole('button', { name: 'Components' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Layout settings' }));

    expect(screen.getByRole('complementary', { name: 'Layout settings' }).parentElement).toBe(workspace);
    expect(screen.getByTestId('layout-settings')).toHaveTextContent('contained settings');
    expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close editor tools' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(workspace).not.toHaveClass('has-tools-panel');
  });

  it('closes from the dedicated editor header control', () => {
    const onClose = vi.fn();
    render(<GamepadEditor isOpen onClose={onClose} onSave={vi.fn()} ros={{} as Ros} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close gamepad editor' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
