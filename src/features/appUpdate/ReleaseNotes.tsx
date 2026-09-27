import { Fragment, type ReactNode } from 'react';

/**
 * Release Please notes, readable in a small card: its version heading is dropped (the card says the
 * version), section headings become labels, and links, commit hashes and pull-request numbers give
 * way to the words they are attached to.
 */
const inline = (text: string): ReactNode[] =>
  text
    .replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)/g, '')
    .replace(/\s*\(\[#\d+\]\([^)]*\)\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, index) => (part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part));

export function ReleaseNotes({ notes }: { notes: string }) {
  const lines = notes.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const blocks: ReactNode[] = [];
  let items: ReactNode[] = [];
  const flush = () => {
    if (items.length) blocks.push(<ul key={`list-${blocks.length}`}>{items}</ul>);
    items = [];
  };
  lines.forEach((line, index) => {
    if (/^#{1,2}\s/.test(line)) return;
    const heading = /^#{3,6}\s+(.*)$/.exec(line);
    const item = /^[*-]\s+(.*)$/.exec(line);
    if (heading) { flush(); blocks.push(<h4 key={index}>{inline(heading[1])}</h4>); }
    else if (item) items.push(<li key={index}>{inline(item[1])}</li>);
    else { flush(); blocks.push(<p key={index}>{inline(line)}</p>); }
  });
  flush();
  return blocks.length ? <div className="app-update-notes">{blocks.map((block, index) => <Fragment key={index}>{block}</Fragment>)}</div>
    : <p className="app-update-muted">This release has no notes.</p>;
}
