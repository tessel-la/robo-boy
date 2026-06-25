import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddPanelMenu from './AddPanelMenu';

const deleteCustomGamepad = vi.fn();
const downloadGamepadLayout = vi.fn();
const importGamepadFile = vi.fn();
const loadGamepadLibrary = vi.fn();

vi.mock('../features/customGamepad/gamepadStorage', () => ({
  deleteCustomGamepad: (...args: unknown[]) => deleteCustomGamepad(...args),
  downloadGamepadLayout: (...args: unknown[]) => downloadGamepadLayout(...args),
  importGamepadFile: (...args: unknown[]) => importGamepadFile(...args),
  loadGamepadLibrary: (...args: unknown[]) => loadGamepadLibrary(...args),
}));

const library = [
  {
    id: 'template-drive',
    name: 'Drive Template',
    description: 'Template description',
    layout: { id: 'template-layout' },
    isDefault: true,
  },
  {
    id: 'custom-arm',
    name: 'Arm Console',
    description: 'Custom description',
    layout: { id: 'custom-layout' },
    isDefault: false,
  },
];

const createButtonRef = () => {
  const button = document.createElement('button');
  button.getBoundingClientRect = vi.fn(() => ({
    top: 100,
    left: 240,
    right: 300,
    bottom: 132,
    width: 60,
    height: 32,
    x: 240,
    y: 100,
    toJSON: () => {},
  }));
  document.body.appendChild(button);
  return { current: button } as React.RefObject<HTMLButtonElement>;
};

describe('AddPanelMenu', () => {
  const onSelectLayout = vi.fn();
  const onClose = vi.fn();
  const onOpenCustomEditor = vi.fn();
  const onOpenTemplate = vi.fn();
  const onCustomGamepadDeleted = vi.fn();
  const onGamepadLibraryChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    loadGamepadLibrary.mockReturnValue(library);
    downloadGamepadLayout.mockReturnValue(true);
    importGamepadFile.mockResolvedValue({ success: true, imported: 1, errors: [] });
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
  });

  const renderMenu = (isOpen = true) =>
    render(
      <AddPanelMenu
        isOpen={isOpen}
        onSelectLayout={onSelectLayout}
        onClose={onClose}
        onOpenCustomEditor={onOpenCustomEditor}
        onOpenTemplate={onOpenTemplate}
        addButtonRef={createButtonRef()}
        onCustomGamepadDeleted={onCustomGamepadDeleted}
        onGamepadLibraryChanged={onGamepadLibraryChanged}
      />
    );

  it('renders nothing when closed', () => {
    renderMenu(false);

    expect(screen.queryByText('Templates')).not.toBeInTheDocument();
  });

  it('renders templates and custom layouts from storage', () => {
    renderMenu();

    expect(loadGamepadLibrary).toHaveBeenCalled();
    expect(screen.getByText('Templates')).toBeInTheDocument();
    expect(screen.getByText('Drive Template')).toBeInTheDocument();
    expect(screen.getByText('Custom Layouts')).toBeInTheDocument();
    expect(screen.getByText('Arm Console')).toBeInTheDocument();
  });

  it('routes template, custom, edit, and delete actions', () => {
    renderMenu();

    fireEvent.click(screen.getByText('Drive Template'));
    expect(onOpenTemplate).toHaveBeenCalledWith('template-drive');

    fireEvent.click(screen.getByText('Arm Console'));
    expect(onSelectLayout).toHaveBeenCalledWith('custom-arm');

    fireEvent.click(screen.getByLabelText('Edit'));
    expect(onOpenCustomEditor).toHaveBeenCalledWith('custom-arm');

    fireEvent.click(screen.getByLabelText('Delete'));
    expect(deleteCustomGamepad).toHaveBeenCalledWith('custom-arm');
    expect(onCustomGamepadDeleted).toHaveBeenCalledWith('custom-arm');
  });

  it('exports custom layouts and reports success', () => {
    renderMenu();

    fireEvent.click(screen.getByLabelText('Export Arm Console'));

    expect(downloadGamepadLayout).toHaveBeenCalledWith('custom-arm');
    expect(screen.getByRole('status')).toHaveTextContent('Gamepad exported');
  });

  it('imports a gamepad file and refreshes the library', async () => {
    renderMenu();

    fireEvent.click(screen.getByText('Import Gamepad'));
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['{}'], 'pad.json', { type: 'application/json' })],
      },
    });

    await waitFor(() => {
      expect(importGamepadFile).toHaveBeenCalledWith(expect.any(File));
      expect(onGamepadLibraryChanged).toHaveBeenCalled();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Imported 1 gamepad');
  });

  it('closes on outside clicks but ignores clicks on the add button', () => {
    const addButtonRef = createButtonRef();
    render(
      <AddPanelMenu
        isOpen
        onSelectLayout={onSelectLayout}
        onClose={onClose}
        onOpenCustomEditor={onOpenCustomEditor}
        onOpenTemplate={onOpenTemplate}
        addButtonRef={addButtonRef}
      />
    );

    fireEvent.mouseDown(addButtonRef.current!);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
