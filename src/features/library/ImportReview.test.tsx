import React from 'react';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { reviewImport, showImportError } from './ImportReview';
import { useImportSession } from './useImportSession';

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal)
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      writable: true,
      value() {
        this.open = true;
      },
    });
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) {
    this.open = true;
  });
});
afterEach(() => vi.restoreAllMocks());
const review = {
  title: 'Import Pads',
  items: ['Drive · 2 components'],
  details: ['Independent copies. Robot compatibility has not been checked.'],
  action: 'Import copies',
};

describe('inert import review', () => {
  it('shows exactly what will be created and accepts only after the explicit action', async () => {
    let result!: Promise<boolean>;
    act(() => {
      result = reviewImport(review);
    });
    const dialog = await screen.findByRole('dialog', { name: 'Import Pads' });
    expect(dialog).toHaveTextContent('Drive · 2 components');
    expect(dialog).toHaveTextContent('Robot compatibility has not been checked');
    expect(dialog.querySelector('canvas, iframe, input')).toBeNull();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Import copies' })));
    await expect(result).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('restores focus on cancel and handles native Escape cancellation', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    let result!: Promise<boolean>;
    act(() => {
      result = reviewImport(review);
    });
    await screen.findByRole('dialog');
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));
    await expect(result).resolves.toBe(false);
    expect(document.activeElement).toBe(button);
    act(() => {
      result = reviewImport(review);
    });
    act(() => fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true })));
    await expect(result).resolves.toBe(false);
    button.remove();
  });
  it('invalidates previous reviews and cancels on owner abort', async () => {
    let first!: Promise<boolean>, second!: Promise<boolean>;
    act(() => {
      first = reviewImport(review);
    });
    const controller = new AbortController();
    act(() => {
      second = reviewImport({ ...review, title: 'Second file' }, controller.signal);
    });
    await expect(first).resolves.toBe(false);
    expect(await screen.findByRole('dialog', { name: 'Second file' })).toBeVisible();
    act(() => controller.abort());
    await expect(second).resolves.toBe(false);
    await expect(reviewImport(review, controller.signal)).resolves.toBe(false);
  });
  it('renders errors as inert text with only a Close action', async () => {
    let result!: Promise<boolean>;
    act(() => {
      result = showImportError('<script>bad</script>');
    });
    expect(await screen.findByRole('dialog', { name: 'Unable to import' })).toHaveTextContent('<script>bad</script>');
    expect(document.querySelector('script')).toBeNull();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Close' })));
    await expect(result).resolves.toBe(false);
  });
});
describe('import owner lifetime', () => {
  it('aborts on replacement, connection change, inactive owner and unmount', async () => {
    const { result, rerender, unmount } = renderHook(({ owner, enabled }) => useImportSession(owner, enabled), {
      initialProps: { owner: 'robot-a', enabled: true },
    });
    const a = result.current(),
      b = result.current();
    expect(a.aborted).toBe(true);
    expect(b.aborted).toBe(false);
    rerender({ owner: 'robot-b', enabled: true });
    expect(b.aborted).toBe(true);
    const c = result.current();
    rerender({ owner: 'robot-b', enabled: false });
    expect(c.aborted).toBe(true);
    expect(result.current().aborted).toBe(true);
    rerender({ owner: 'robot-b', enabled: true });
    const d = result.current();
    unmount();
    await waitFor(() => expect(d.aborted).toBe(true));
  });
});
