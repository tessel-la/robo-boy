import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { branding } from '../../../infra/enterprise/config.mjs';
import LoginCopy from './LoginCopy';

const slides = [
  { title: 'Start your shift.', message: 'Choose a robot and open your workspace.' },
  { title: 'See your fleet.', message: 'Use the tools your team needs.' },
];

describe('company login copy', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('preserves static branding and optional eyebrow without controls or timers', () => {
    const { rerender } = render(
      <LoginCopy branding={branding({ loginTitle: 'Company robots', loginMessage: 'Sign in here.' })} />
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Company robots');
    expect(screen.getByText('Sign in here.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    rerender(<LoginCopy branding={branding({ loginEyebrow: '', loginSlides: [slides[0]] })} />);
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
    expect(screen.queryByText('Your robotics workspace')).not.toBeInTheDocument();
  });

  it('selects a paired surprise once and keeps it across time and parent rerenders', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const brand = branding({ loginSlides: slides });
    const { rerender } = render(<LoginCopy branding={brand} />);
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading')).toHaveTextContent(slides[1].title);
    expect(screen.getByText(slides[1].message)).toBeInTheDocument();
    expect(screen.queryByText(slides[0].message)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60000));
    rerender(<LoginCopy branding={{ ...brand, loginSlides: [...slides] }} />);
    expect(screen.getByRole('heading')).toHaveTextContent(slides[1].title);
    expect(document.getElementById('enterprise-login-title')).toHaveTextContent(slides[1].title);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('avoids the last pair on the next visit, including under StrictMode', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const brand = branding({ loginSlides: slides });
    const first = render(
      <StrictMode>
        <LoginCopy branding={brand} />
      </StrictMode>
    );
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
    first.unmount();
    const next = render(
      <StrictMode>
        <LoginCopy branding={brand} />
      </StrictMode>
    );
    expect(screen.getByRole('heading')).toHaveTextContent(slides[1].title);
    expect(screen.getByText(slides[1].message)).toBeInTheDocument();
    next.unmount();
    render(<LoginCopy branding={brand} />);
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
  });

  it('isolates companies, tolerates stale history and updates changed message lists', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    localStorage.setItem('robo-boy-login-message-v1::Robo-Boy', 'corrupt or removed copy');
    const { rerender } = render(<LoginCopy branding={branding({ loginSlides: slides })} />);
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
    rerender(<LoginCopy branding={branding({ name: 'Another company', loginSlides: slides })} />);
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
    rerender(<LoginCopy branding={branding({ loginSlides: [slides[1], { title: 'New copy.', message: '' }] })} />);
    expect(screen.getByRole('heading')).toHaveTextContent(slides[1].title);
  });

  it('keeps a surprise usable when browser storage is blocked', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const brand = branding({ name: 'Storage-blocked company', loginSlides: slides });
    const first = render(<LoginCopy branding={brand} />);
    expect(screen.getByRole('heading')).toHaveTextContent(slides[0].title);
    first.unmount();
    render(<LoginCopy branding={brand} />);
    expect(screen.getByRole('heading')).toHaveTextContent(slides[1].title);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles duplicate messages and renders configured markup as plain text', () => {
    const message = { title: '<img src=x onerror=alert(1)>', message: '<script>bad()</script>' };
    const brand = branding({ loginSlides: [message, message] });
    const first = render(<LoginCopy branding={brand} />);
    expect(screen.getByRole('heading')).toHaveTextContent(message.title);
    first.unmount();
    const { container } = render(<LoginCopy branding={brand} />);
    expect(screen.getByRole('heading')).toHaveTextContent(message.title);
    expect(container.querySelector('img,script')).toBeNull();
  });
});
