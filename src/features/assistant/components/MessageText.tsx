import type { AssistantMessage } from '../types';

export interface ResourceTextProps {
  tags?: AssistantMessage['contextTags'];
  onOpen?: (id: string) => void;
  canOpen?: (id: string) => boolean;
}

/** Mentions are display references, not URLs or permissions. Code and links stay literal. */
export function MessageText({ text, tags, onOpen, canOpen }: ResourceTextProps & { text: string }) {
  if (!tags?.length) return <>{text}</>;
  const byMention = new Map(tags.map(tag => [`@${tag.mention ?? tag.label}`.toLowerCase(), tag]));
  const pattern = [...byMention.keys()].sort((a, b) => b.length - a.length)
    .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return <>{text.split(new RegExp(`(${pattern})`, 'gi')).map((part, index) => {
    const tag = byMention.get(part.toLowerCase());
    if (!tag) return part;
    const className = `assistant-inline-tag source-${tag.source}`;
    return onOpen && canOpen?.(tag.id)
      ? <button type="button" key={index} className={`${className} openable`} onClick={() => onOpen(tag.id)} title={`Open ${tag.label}`}>{part}</button>
      : <mark key={index} className={className}>{part}</mark>;
  })}</>;
}
