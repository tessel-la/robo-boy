import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Markdown from 'react-markdown';
vi.mock('react-markdown', async importOriginal => {
  const actual = await importOriginal<typeof import('react-markdown')>();
  return { ...actual, default: vi.fn(actual.default) };
});
import { AssistantMarkdown } from './AssistantMarkdown';

describe('assistant Markdown', () => {
  it('does not reparse unchanged responses when resource handlers change', () => {
    const { rerender } = render(<AssistantMarkdown content={'**Stable** @My Pad'} tags={[{ id: 'pad:test', label: 'My Pad', source: 'pad' }]} canOpen={() => false} />);
    const calls = vi.mocked(Markdown).mock.calls.length;
    const onOpen = vi.fn();
    rerender(<AssistantMarkdown content={'**Stable** @My Pad'} tags={[{ id: 'pad:test', label: 'My Pad', source: 'pad' }]} canOpen={() => true} onOpen={onOpen} />);
    expect(vi.mocked(Markdown).mock.calls).toHaveLength(calls);
    fireEvent.click(screen.getByRole('button', { name: '@My Pad' }));
    expect(onOpen).toHaveBeenCalledWith('pad:test');
    rerender(<AssistantMarkdown content={'**Changed**'} />);
    expect(vi.mocked(Markdown).mock.calls.length).toBe(calls + 1);
  });
  it('renders headings, emphasis, lists, inline code, blockquotes and GFM tables semantically', () => {
    render(<AssistantMarkdown content={'# Result\n\n**Ready** and *verified* `linear.x`.\n\n- One\n- Two\n\n> Evidence\n\n| Axis | Speed |\n| --- | --- |\n| X | 0.05 |\n\n- [x] Checked'} />);
    expect(screen.getByRole('heading', { name: 'Result' }).tagName).toBe('H3');
    expect(screen.getByText('Ready').tagName).toBe('STRONG');
    expect(screen.getByText('verified').tagName).toBe('EM');
    expect(screen.getByText('linear.x').tagName).toBe('CODE');
    expect(screen.getByText('One').tagName).toBe('LI');
    expect(screen.getByText('Evidence').closest('blockquote')).not.toBeNull();
    expect(screen.getByRole('table')).toHaveTextContent('X0.05');
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
  it('does not parse HTML, load images, or allow dangerous/relative link schemes', () => {
    const { container } = render(<AssistantMarkdown content={'<script>alert(1)</script>\n\n<img src="https://tracker.invalid/raw" onerror="alert(2)">\n\n![remote](https://tracker.invalid/pixel)\n\n[bad](javascript:alert%281%29) [data](data:text/html,evil) [local](file:///etc/passwd) [relative](/private) [good](https://example.org)'} />);
    expect(container.querySelector('script, img')).toBeNull();
    expect(screen.getByText('[Image not loaded: remote]')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'good' })).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('supports unfinished streamed fences and does not claim newly streamed code was already copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    try {
      const { rerender } = render(<AssistantMarkdown content={'```json\n{\n  "x": 1'} />);
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
      expect(writeText).toHaveBeenCalledWith('{\n  "x": 1\n');
      rerender(<AssistantMarkdown content={'```json\n{\n  "x": 1\n}\n```'} />);
      expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
      expect(screen.getByLabelText('json code')).toHaveTextContent('"x": 1');
    } finally { vi.unstubAllGlobals(); }
  });
  it('reports clipboard failure without losing the source', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    try {
      render(<AssistantMarkdown content={'```sh\necho test\n```'} />);
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Select the code');
      expect(screen.getByLabelText('sh code')).toHaveTextContent('echo test');
    } finally { vi.unstubAllGlobals(); }
  });
  it('opens resource mentions only in prose, not code or links', () => {
    const onOpen = vi.fn();
    const { container } = render(<AssistantMarkdown content={'**@My Pad** and `@My Pad`\n\n[@My Pad](https://example.org)\n\n```text\n@My Pad\n```'} tags={[{ id: 'pad:test', label: 'My Pad', source: 'pad' }]} onOpen={onOpen} canOpen={() => true} />);
    expect(container.querySelectorAll('.assistant-inline-tag')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '@My Pad' }));
    expect(onOpen).toHaveBeenCalledWith('pad:test');
    expect(screen.getByRole('link', { name: '@My Pad' }).querySelector('button')).toBeNull();
  });
});
