import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { branding } from '../../../infra/enterprise/config.mjs';
import LoginCopy from './LoginCopy';

const slides = [
  { title: 'Start your shift.', message: 'Choose a robot and open your workspace.' },
  { title: 'See your fleet.', message: 'Use the tools your team needs.' },
];

describe('company login copy', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const tick = () => act(() => vi.advanceTimersByTime(8000));

  it('preserves static branding without rotation controls or timers', () => {
    render(<LoginCopy branding={branding({ loginTitle: 'Company robots', loginMessage: 'Sign in here.' })} />);
    expect(screen.getByRole('heading')).toHaveTextContent('Company robots');
    expect(screen.getByText('Sign in here.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('customizes the eyebrow and treats a single slide as static copy', () => {
    const { rerender } = render(
      <LoginCopy branding={branding({ loginEyebrow: 'Company operations', loginSlides: [slides[0]] })} />
    );
    expect(screen.getByText('Company operations')).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    rerender(<LoginCopy branding={branding({ loginEyebrow: '' })} />);
    expect(screen.queryByText('Your robotics workspace')).not.toBeInTheDocument();
  });

  it('rotates heading and message together, wraps, and exposes only the current slide', () => {
    render(<LoginCopy branding={branding({ loginSlides: slides })} />);
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
    tick();
    expect(screen.getByRole('heading')).toHaveTextContent(slides[1].title);
    expect(screen.getByText(slides[1].message).closest('[role="group"]')).toHaveAttribute('aria-hidden', 'false');
    expect(document.getElementById('enterprise-login-title')).toHaveTextContent(slides[1].title);
    tick();
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
  });

  it('pauses and resumes from the keyboard without restarting on manual navigation', () => {
    render(<LoginCopy branding={branding({ loginSlides: slides })} />);
    const pause = screen.getByRole('button', { name: 'Pause messages' });
    fireEvent.focus(pause);
    fireEvent.click(pause);
    tick();
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
    fireEvent.click(screen.getByRole('button', { name: 'Play messages' }));
    tick();
    expect(screen.getByRole('heading')).toHaveTextContent(slides[1].title);
    fireEvent.focus(screen.getByRole('button', { name: 'Next message' }));
    tick();
    expect(screen.getByRole('heading')).toHaveTextContent(slides[1].title);
    fireEvent.click(screen.getByRole('button', { name: 'Next message' }));
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
    tick();
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
    fireEvent.click(screen.getByRole('button', { name: 'Previous message' }));
    expect(screen.getByRole('heading')).toHaveTextContent(slides[1].title);
    expect(screen.getByRole('heading').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
  });

  it('stops while hovered or hidden and releases its timer and listeners on unmount', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<LoginCopy branding={branding({ loginSlides: slides })} />);
    const copy = screen.getByRole('region', { name: 'Company messages' });
    fireEvent.mouseEnter(copy);
    tick();
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
    fireEvent.mouseLeave(copy);
    tick();
    expect(screen.getByRole('heading')).toHaveTextContent(slides[1].title);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    tick();
    expect(screen.getByRole('heading')).toHaveTextContent(slides[1].title);
    hidden.mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    tick();
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('honors reduced motion at startup and when the preference changes', () => {
    let onChange: () => void = () => {};
    const media = {
      matches: true,
      addEventListener: vi.fn((_event, callback) => {
        onChange = callback;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => media);
    const { unmount } = render(<LoginCopy branding={branding({ loginSlides: slides })} />);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByRole('button', { name: /messages/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next message' }));
    expect(screen.getByRole('heading')).toHaveTextContent(slides[1].title);
    act(() => {
      media.matches = false;
      onChange();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play messages' }));
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      media.matches = true;
      onChange();
    });
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', onChange);
  });

  it('renders configured markup as text without injecting elements', () => {
    const title = '<img src=x onerror=alert(1)>';
    const { container } = render(
      <LoginCopy branding={branding({ loginSlides: [{ title, message: '<script>bad()</script>' }] })} />
    );
    expect(screen.getByRole('heading')).toHaveTextContent(title);
    expect(container.querySelector('img,script')).toBeNull();
  });
});
