import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomGamepadWrapper from './CustomGamepadWrapper';

const getGamepadLayout = vi.fn();
const customLayout = vi.fn(({ layout, ros, isEditing }) => (
  <div data-testid="custom-layout" data-layout-id={layout.id} data-ros={String(Boolean(ros))} data-editing={String(isEditing)} />
));

vi.mock('../../../features/customGamepad/gamepadStorage', () => ({
  GAMEPAD_STORAGE_EVENT: 'robo-boy-gamepads-changed',
  getGamepadLayout: (...args: unknown[]) => getGamepadLayout(...args),
}));

vi.mock('../../../features/customGamepad/components/CustomGamepadLayout', () => ({
  default: (props: any) => customLayout(props),
}));

describe('CustomGamepadWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the stored custom layout in play mode', () => {
    getGamepadLayout.mockReturnValue({ layout: { id: 'layout-1' } });

    render(<CustomGamepadWrapper ros={{ connected: true } as any} layoutId="layout-1" />);

    expect(getGamepadLayout).toHaveBeenCalledWith('layout-1');
    expect(screen.getByTestId('custom-layout')).toHaveAttribute('data-layout-id', 'layout-1');
    expect(screen.getByTestId('custom-layout')).toHaveAttribute('data-editing', 'false');
  });

  it('shows a clear error when the layout cannot be loaded', () => {
    getGamepadLayout.mockReturnValue(null);

    render(<CustomGamepadWrapper ros={{} as any} layoutId="missing-layout" />);

    expect(screen.getByText('Layout Not Found')).toBeInTheDocument();
    expect(screen.getByText('The gamepad layout "missing-layout" could not be loaded.')).toBeInTheDocument();
  });

  it('does not rebind live controls after an authoring save until operator activation', () => {
    const before = { layout: { id: 'layout-1', name: 'Original' } };
    getGamepadLayout.mockReturnValue(before);
    render(<CustomGamepadWrapper ros={{} as any} layoutId="layout-1" />);
    getGamepadLayout.mockReturnValue({ layout: { id: 'layout-1', name: 'Updated' } });
    act(() => window.dispatchEvent(new CustomEvent('robo-boy-gamepads-changed')));
    expect(customLayout.mock.calls[customLayout.mock.calls.length - 1]?.[0].layout).toEqual(before.layout);
    fireEvent.click(screen.getByRole('button', { name: 'Activate updated controls' }));
    expect(customLayout.mock.calls[customLayout.mock.calls.length - 1]?.[0].layout.name).toBe('Updated');
  });
});
