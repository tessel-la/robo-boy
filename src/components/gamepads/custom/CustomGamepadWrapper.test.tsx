import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomGamepadWrapper from './CustomGamepadWrapper';

const getGamepadLayout = vi.fn();
const customLayout = vi.fn(({ layout, ros, isEditing }) => (
  <div data-testid="custom-layout" data-layout-id={layout.id} data-ros={String(Boolean(ros))} data-editing={String(isEditing)} />
));

vi.mock('../../../features/customGamepad/gamepadStorage', () => ({
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
});
