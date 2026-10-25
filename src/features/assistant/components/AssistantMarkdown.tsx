import React, { createContext, useContext, useState } from 'react';
import Markdown, { defaultUrlTransform, type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessageText, type ResourceTextProps } from './MessageText';

const ResourceContext = createContext<ResourceTextProps>({});
function MentionChildren({ children }: { children: React.ReactNode }) {
  const resources = useContext(ResourceContext);
  return <>{React.Children.map(children, child => typeof child === 'string'
    ? <MessageText text={child} {...resources} /> : child)}</>;
}

function CodeBlock({ children, node }: React.ComponentProps<'pre'> & ExtraProps) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const code = node?.children.find(child => child.type === 'element' && child.tagName === 'code');
  const value = code?.type === 'element' ? code.children.map(child => child.type === 'text' ? child.value : '').join('') : '';
  const classes = code?.type === 'element' ? String(code.properties.className ?? '') : '';
  const language = /language-([^\s,]+)/.exec(classes)?.[1];
  const copyState = copiedValue === value ? 'Copied' : copyFailed ? 'Copy failed' : 'Copy code';
  return <div className="assistant-code-block">
    <div className="assistant-code-header"><span>{language ?? 'Code'}</span><button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setCopiedValue(value); setCopyFailed(false); }
      catch { setCopyFailed(true); }
    }}>{copyState}</button></div>
    <pre tabIndex={0} aria-label={language ? `${language} code` : 'Code block'}>{children}</pre>
    {copyState === 'Copy failed' && <small role="status">Could not copy. Select the code to copy it manually.</small>}
  </div>;
}

// Keep renderer types stable during streaming; expanding/copying a block must not reset it.
const components: Components = {
  p: ({ children }) => <p><MentionChildren>{children}</MentionChildren></p>,
  li: ({ children, ...props }) => <li className={props.className}><MentionChildren>{children}</MentionChildren></li>,
  strong: ({ children }) => <strong><MentionChildren>{children}</MentionChildren></strong>,
  em: ({ children }) => <em><MentionChildren>{children}</MentionChildren></em>,
  del: ({ children }) => <del><MentionChildren>{children}</MentionChildren></del>,
  h1: ({ children }) => <h3><MentionChildren>{children}</MentionChildren></h3>,
  h2: ({ children }) => <h4><MentionChildren>{children}</MentionChildren></h4>,
  h3: ({ children }) => <h5><MentionChildren>{children}</MentionChildren></h5>,
  h4: ({ children }) => <h6><MentionChildren>{children}</MentionChildren></h6>,
  h5: ({ children }) => <h6><MentionChildren>{children}</MentionChildren></h6>,
  h6: ({ children }) => <h6><MentionChildren>{children}</MentionChildren></h6>,
  th: ({ children, style }) => <th style={style}><MentionChildren>{children}</MentionChildren></th>,
  td: ({ children, style }) => <td style={style}><MentionChildren>{children}</MentionChildren></td>,
  table: ({ children }) => <div className="assistant-markdown-table" role="region" aria-label="Response table" tabIndex={0}><table>{children}</table></div>,
  pre: CodeBlock,
  a: ({ children, href }) => href
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  // Model output must not trigger network requests (tracking URLs or private endpoints).
  img: ({ alt }) => <span className="assistant-message-note">[Image not loaded{alt ? `: ${alt}` : ''}]</span>,
};
const remarkPlugins = [remarkGfm];
function safeUrl(value: string) {
  const safe = defaultUrlTransform(value);
  return /^(?:https?:\/\/|mailto:)/i.test(safe) ? safe : '';
}
// Transcript rerenders and resource state changes must not reparse every old response.
// Mention children still receive live resource context without rebuilding the Markdown AST.
const MarkdownDocument = React.memo(({ content }: { content: string }) =>
  <Markdown remarkPlugins={remarkPlugins} components={components} urlTransform={safeUrl}>{content}</Markdown>
);

/** One parser for live answers, completed answers and provider-exposed thinking.
 * Raw HTML is never parsed; tool diagnostics use their separate literal pre renderer. */
export function AssistantMarkdown({ content, ...resources }: ResourceTextProps & { content: string }) {
  return <div className="assistant-message-content assistant-markdown">
    <ResourceContext.Provider value={resources}>
      <MarkdownDocument content={content} />
    </ResourceContext.Provider>
  </div>;
}
