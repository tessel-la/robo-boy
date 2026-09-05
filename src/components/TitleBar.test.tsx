import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { appWindow, stopListening } = vi.hoisted(() => ({
  appWindow: {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(),
    onResized: vi.fn(),
    startResizeDragging: vi.fn(),
  },
  stopListening: vi.fn(),
}));

vi.mock('../runtime/desktopWindow', () => ({ getDesktopWindow: () => Promise.resolve(appWindow) }));

import TitleBar from './TitleBar';

const desktopWindow = window as typeof window & { __TAURI_INTERNALS__?: unknown };

describe('TitleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appWindow.isMaximized.mockResolvedValue(false);
    appWindow.onResized.mockResolvedValue(stopListening);
    desktopWindow.__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete desktopWindow.__TAURI_INTERNALS__;
    vi.unstubAllGlobals();
  });

  it('stays out of the browser, which keeps its own window chrome', () => {
    delete desktopWindow.__TAURI_INTERNALS__;

    const { container } = render(<TitleBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it('stays off a phone, which has no window controls to drive', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15',
      maxTouchPoints: 5,
    });

    const { container } = render(<TitleBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it('drives the window from its own controls', async () => {
    render(<TitleBar />);

    // Without a drag region the undecorated window could not be moved at all, and only "deep"
    // extends that to the strip's contents rather than the strip element alone.
    expect(document.querySelector('.title-bar')).toHaveAttribute('data-tauri-drag-region', 'deep');

    fireEvent.click(screen.getByLabelText('Minimise'));
    fireEvent.click(screen.getByLabelText('Maximise'));
    fireEvent.click(screen.getByLabelText('Close'));

    await waitFor(() => expect(appWindow.close).toHaveBeenCalledOnce());
    expect(appWindow.minimize).toHaveBeenCalledOnce();
    expect(appWindow.toggleMaximize).toHaveBeenCalledOnce();
  });

  it('offers to restore a window that is already maximised', async () => {
    appWindow.isMaximized.mockResolvedValue(true);

    render(<TitleBar />);

    expect(await screen.findByLabelText('Restore')).toBeInTheDocument();
    expect(screen.queryByLabelText('Maximise')).not.toBeInTheDocument();
  });

  it('follows a resize it did not start, so the button keeps telling the truth', async () => {
    let reportResize = () => {};
    appWindow.onResized.mockImplementation((handler: () => void) => {
      reportResize = handler;
      return Promise.resolve(stopListening);
    });

    render(<TitleBar />);
    expect(await screen.findByLabelText('Maximise')).toBeInTheDocument();

    appWindow.isMaximized.mockResolvedValue(true);
    reportResize();

    expect(await screen.findByLabelText('Restore')).toBeInTheDocument();
  });

  it('hands each edge back to the compositor to resize', async () => {
    render(<TitleBar />);

    fireEvent.mouseDown(document.querySelector('.title-bar-resize-se') as Element);
    await waitFor(() => expect(appWindow.startResizeDragging).toHaveBeenCalledWith('SouthEast'));

    fireEvent.mouseDown(document.querySelector('.title-bar-resize-n') as Element);
    await waitFor(() => expect(appWindow.startResizeDragging).toHaveBeenCalledWith('North'));

    expect(document.querySelectorAll('.title-bar-resize')).toHaveLength(8);
  });

  it('stops listening when the shell goes away', async () => {
    const { unmount } = render(<TitleBar />);
    await waitFor(() => expect(appWindow.onResized).toHaveBeenCalledOnce());

    unmount();

    expect(stopListening).toHaveBeenCalledOnce();
  });
});
