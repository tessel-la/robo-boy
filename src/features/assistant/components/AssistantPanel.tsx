import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaArrowUp, FaCheck, FaCog, FaPaintBrush, FaPaperclip, FaPencilAlt, FaPlus, FaRedo, FaSearch, FaStop, FaSyncAlt, FaTimes } from 'react-icons/fa';
import type { AssistantAttachment, AssistantContextSourceKind, AssistantMessage, AssistantProviderId, AssistantSettings } from '../types';
import AssistantSpeechTextarea from './AssistantSpeechTextarea';
import AssistantSketchEditor from './AssistantSketchEditor';
import AssistantSettingsPopover from './AssistantSettingsPopover';
import './AssistantPanel.css';

export interface ContextPickerOption {
  id: string;
  label: string;
  /** Drops this resource from the context again. Choosing an already-selected row calls this. */
  onRemove?: () => void;
  /** Already in context on every turn, so the browser shows it as such and choosing it does
   * nothing. It can still be written as an `@mention` to point at it in a sentence. */
  alwaysIncluded?: boolean;
  /** Which kind of resource this is, so a mention of it can be coloured the moment it is written --
   * before the retrieval that pins it has finished. */
  source: AssistantContextSourceKind;
  description: string;
  selected?: boolean;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface ContextPickerSection {
  id: string;
  label: string;
  description?: string;
  options: ContextPickerOption[];
}

export interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
  messages: AssistantMessage[];
  isGenerating: boolean;
  progressMessages: string[];
  error: string;
  clarificationSuggestions?: string[];
  onSelectSuggestion: (suggestion: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onNewConversation: () => void;
  onRepeat: (messageIndex: number) => void;
  onEditMessage: (messageIndex: number, nextText: string) => void;
  /** Opens a tagged resource in the view that owns it; returns false when it has none. */
  onOpenResource?: (resourceId: string) => boolean;
  canOpenResource?: (resourceId: string) => boolean;
  contextPickerSections: ContextPickerSection[];
  attachments: AssistantAttachment[];
  attachmentError: string;
  onAttachFiles: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
  /** Turns a finished recording into text for the prompt. */
  onTranscribeAudio: (audio: Blob) => Promise<string>;
  onSketchAttach: (dataUrl: string) => void;
  settings: AssistantSettings;
  resolvedBaseUrl: string;
  onProviderChange: (provider: AssistantProviderId) => void;
  onUpdateSettings: (patch: Partial<AssistantSettings>) => void;
  ollamaModels: string[];
  ollamaModelsError: string;
  isLoadingOllamaModels: boolean;
  onRefreshOllamaModels: () => void;
  onReviewPadProposal: (messageId: string) => void;
  onSaveBehaviorTreeProposal: (messageId: string) => void;
  hasActiveBehaviorTreeBridge: boolean;
}

/** Binary attachments are held as bare base64 so they survive a JSON round trip; the DOM wants the
 * data URL back. */
const dataUrlFor = (attachment: AssistantAttachment) => `data:${attachment.mimeType};base64,${attachment.content}`;

const canGenerateFrom = (prompt: string, isGenerating: boolean, attachments: AssistantAttachment[] = []) =>
  (Boolean(prompt.trim()) || attachments.length > 0) && !isGenerating;

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The `@Label` text a tagged resource reads as, in the prompt and in the transcript. */
const mentionTextFor = (tag: { label: string; mention?: string }) => `@${tag.mention ?? tag.label}`;

/** Colours the `@Label` mentions a message was sent with. The tagged resource is shown where the
 * author put it rather than in a separate strip, so tagging costs no vertical space. */
const MessageText = ({ text, tags, onOpen, canOpen }: { text: string; tags?: AssistantMessage['contextTags']; onOpen?: (id: string) => void; canOpen?: (id: string) => boolean }) => {
  if (!tags?.length) return <>{text}</>;
  // Case-insensitively: a resource is named "TF tree" but nobody types it that way, and a mention
  // that does not light up reads as a tag that failed rather than a capital letter that differed.
  const byMention = new Map(tags.map(tag => [mentionTextFor(tag).toLowerCase(), tag]));
  const mentions = [...byMention.keys()].sort((a, b) => b.length - a.length).map(escapeForRegExp);
  const parts = text.split(new RegExp(`(${mentions.join('|')})`, 'gi'));
  return (
    <>
      {parts.map((part, index) => {
        const tag = byMention.get(part.toLowerCase());
        if (!tag) return part;
        const className = `assistant-inline-tag source-${tag.source}`;
        // Clickable only when something is actually open to show; otherwise it is a dead link.
        return onOpen && canOpen?.(tag.id) ? (
          <button type="button" key={index} className={`${className} openable`} onClick={() => onOpen(tag.id)} title={`Open ${tag.label}`}>{part}</button>
        ) : (
          <mark key={index} className={className}>{part}</mark>
        );
      })}
    </>
  );
};

const MessageContent = ({ content, tags, onOpen, canOpen }: { content: string; tags?: AssistantMessage['contextTags']; onOpen?: (id: string) => void; canOpen?: (id: string) => boolean }) => {
  const segments = content.split(/```([\s\S]*?)```/g);
  return (
    <div className="assistant-message-content">
      {segments.map((segment, index) =>
        index % 2 === 1 ? <pre key={index}>{segment.trim()}</pre> : segment ? <p key={index}><MessageText text={segment} tags={tags} onOpen={onOpen} canOpen={canOpen} /></p> : null
      )}
    </div>
  );
};

interface MentionPicker {
  isOpen: boolean;
  close: () => void;
  /** Feeds a new field value in; returns true when it ends in an open `@mention`. */
  trackValue: (value: string) => boolean;
  /** Returns true when the picker consumed the key. */
  handleKeyDown: (event: React.KeyboardEvent) => boolean;
  node: React.ReactNode;
}

/** `@` autocompletion over the context catalog. The composer and the in-place message editor each
 * own one, so a resource can be tagged while editing an earlier message and not only while
 * composing a new one. */
const useMentionPicker = (
  options: ContextPickerOption[],
  apply: (option: ContextPickerOption) => void,
  /** The composer sits at the bottom of the panel, so its list opens upwards; an editor in the
   * transcript would put that list under the header, so its list opens downwards. */
  placement: 'above' | 'below' = 'above'
): MentionPicker => {
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(() => {
    if (query === null) return [];
    const needle = query.toLocaleLowerCase();
    return options
      .filter(option => !option.disabled && `${option.label} ${option.description}`.toLocaleLowerCase().includes(needle))
      .slice(0, 10);
  }, [options, query]);
  const index = Math.min(activeIndex, Math.max(matches.length - 1, 0));

  const close = () => setQuery(null);
  const choose = (option: ContextPickerOption) => { close(); apply(option); };

  return {
    isOpen: query !== null,
    close,
    trackValue: value => {
      const match = value.match(/(?:^|\s)@([^\s@]*)$/);
      setQuery(match?.[1] ?? null);
      setActiveIndex(0);
      return Boolean(match);
    },
    handleKeyDown: event => {
      if (query === null) return false;
      if (event.key === 'Escape') { event.preventDefault(); close(); return true; }
      if (matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        setActiveIndex((index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
        return true;
      }
      if (matches.length && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); choose(matches[index]); return true; }
      return false;
    },
    node: query === null ? null : (
      <div className={`assistant-mention-picker ${placement}`} role="listbox" aria-label="Mention context">
        {matches.map((option, position) => (
          <button type="button" role="option" aria-selected={position === index} className={position === index ? 'active' : ''} key={option.id} onClick={() => choose(option)}>
            <strong>{option.label}</strong><span>{option.description}</span>
          </button>
        ))}
        {matches.length === 0 && <span>No matching context</span>}
      </div>
    ),
  };
};

const useCompactAssistant = () => {
  const [compact, setCompact] = useState(() => window.matchMedia?.('(max-width: 767px)').matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 767px)');
    if (!query) return;
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
};

const AssistantPanel: React.FC<AssistantPanelProps> = props => {
  const {
    open, onClose, messages, isGenerating, progressMessages, error, clarificationSuggestions, onSelectSuggestion,
    prompt, onPromptChange, onSubmit, onStop, onNewConversation, onRepeat, onEditMessage,
    onOpenResource, canOpenResource, contextPickerSections,
    attachments, attachmentError, onAttachFiles, onRemoveAttachment, onTranscribeAudio, onSketchAttach, settings, resolvedBaseUrl,
    onProviderChange, onUpdateSettings, ollamaModels, ollamaModelsError, isLoadingOllamaModels,
    onRefreshOllamaModels, onReviewPadProposal, onSaveBehaviorTreeProposal, hasActiveBehaviorTreeBridge,
  } = props;

  const compact = useCompactAssistant();
  const [showSettings, setShowSettings] = useState(false);
  const [showSketchEditor, setShowSketchEditor] = useState(false);
  const [loadingContextIds, setLoadingContextIds] = useState<string[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [expandedImage, setExpandedImage] = useState<AssistantAttachment | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [mobileViewportStyle, setMobileViewportStyle] = useState<React.CSSProperties>();
  const panelRef = useRef<HTMLElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const editingRef = useRef<HTMLTextAreaElement>(null);
  const editingHighlightRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const nearBottomRef = useRef(true);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const allContextOptions = useMemo(() => contextPickerSections.flatMap(section => section.options), [contextPickerSections]);
  /**
   * The tags a piece of text names, read from the text itself rather than from what a turn happened
   * to carry. A restored conversation has no chips behind it and a repeated or edited message is a
   * new turn, so deriving from the text is what keeps those messages highlighted. `sent` adds back
   * anything a turn did carry whose resource has since left the catalog. Filtering by `includes`
   * first keeps the pattern off the whole ROS graph.
   */
  const tagsForText = useCallback(
    (text: string, sent?: AssistantMessage['contextTags']): AssistantMessage['contextTags'] => {
      const haystack = text.toLowerCase();
      const byMention = new Map<string, NonNullable<AssistantMessage['contextTags']>[number]>();
      for (const option of allContextOptions) {
        const mention = `@${option.label}`;
        if (haystack.includes(mention.toLowerCase())) byMention.set(mention.toLowerCase(), { id: option.id, label: option.label, source: option.source });
      }
      for (const tag of sent ?? []) {
        const mention = `@${tag.mention ?? tag.label}`;
        if (haystack.includes(mention.toLowerCase())) byMention.set(mention.toLowerCase(), tag);
      }
      return [...byMention.values()];
    },
    [allContextOptions]
  );


  const retrieveContextOption = async (option: ContextPickerOption) => {
    setLoadingContextIds(previous => [...previous, option.id]);
    try {
      await option.onSelect();
    } finally {
      setLoadingContextIds(previous => previous.filter(id => id !== option.id));
    }
  };

  /** Writes the resource into a field as `@Label` -- the mention is the tag -- and retrieves it in
   * the background, so a second resource can be tagged while the first is still loading. */
  const tagInto = (
    option: ContextPickerOption,
    field: { value: string; setValue: (next: string) => void; ref: React.RefObject<HTMLTextAreaElement> },
    replaceOpenMention: boolean
  ) => {
    if (option.disabled) return;
    const mention = mentionTextFor({ label: option.label });
    const { value } = field;
    const next = replaceOpenMention
      ? value.replace(/@([^\s@]*)$/, `${mention} `)
      : `${value.trimEnd()}${value.trim() ? ' ' : ''}${mention} `;
    field.setValue(next);
    // Focusing a textarea whose value React just replaced leaves the caret at the start, so put it
    // back after the mention the user just chose.
    window.requestAnimationFrame(() => {
      const node = field.ref.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.length, next.length);
    });
    void retrieveContextOption(option);
  };

  /** Undefined when nothing can be opened, so tags stay plain marks rather than dead buttons. */
  const openResource = onOpenResource
    ? (id: string) => { if (onOpenResource(id) && compact) onClose(); }
    : undefined;

  const composerField = { value: prompt, setValue: onPromptChange, ref: promptRef };
  const editingField = { value: editingDraft, setValue: setEditingDraft, ref: editingRef };
  const composerMentions = useMentionPicker(allContextOptions, option => tagInto(option, composerField, true));
  const editingMentions = useMentionPicker(allContextOptions, option => tagInto(option, editingField, true), 'below');

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !showSketchEditor) {
        event.preventDefault();
        if (expandedImage) setExpandedImage(null);
        else if (showSettings) setShowSettings(false);
        else if (composerMentions.isOpen) composerMentions.close();
        else if (editingMentions.isOpen) editingMentions.close();
        else if (editingMessageId) { setEditingMessageId(null); setEditingDraft(''); }
        else onClose();
      }
      if (event.key === 'Tab' && compact && panelRef.current) {
        const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')].filter(element => element.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [compact, composerMentions, editingMentions, editingMessageId, expandedImage, onClose, open, showSettings, showSketchEditor]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      promptRef.current?.focus({ preventScroll: true });
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus({ preventScroll: true });
      previousFocusRef.current = null;
    };
  }, [open]);

  /**
   * Fits the panel to the room actually left under the app bar. The CSS starting point can only
   * guess at that bar's height, and a guess that is wrong by a few pixels on a platform whose
   * chrome differs -- the packaged desktop shell, a phone with a keyboard up -- either leaves a
   * strip of page showing above or pushes the composer off the bottom. Measuring is the same on
   * every platform, so it is done on every platform.
   */
  useEffect(() => {
    if (!open) { setMobileViewportStyle(undefined); return; }
    const place = () => {
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const toolbarBottom = document.querySelector('.top-bar')?.getBoundingClientRect().bottom ?? viewportTop;
      const top = Math.max(viewportTop, toolbarBottom);
      setMobileViewportStyle({ top, height: Math.max(240, viewportBottom - top) });
    };
    place();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    window.addEventListener('resize', place);
    return () => {
      viewport?.removeEventListener('resize', place);
      viewport?.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !compact) return;
    let popped = false;
    const marker = `assistant-${Date.now()}`;
    window.history.pushState({ ...window.history.state, roboBoyAssistant: marker }, '');
    const onPopState = () => { popped = true; onClose(); };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (!popped && window.history.state?.roboBoyAssistant === marker) window.history.back();
    };
  }, [compact, onClose, open]);

  useEffect(() => {
    if (!nearBottomRef.current || !chatRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, progressMessages.length, error]);

  const handlePromptChange = (value: string) => {
    onPromptChange(value);
    composerMentions.trackValue(value);
  };

  const handlePromptKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = event => {
    if (event.nativeEvent.isComposing) return;
    if (composerMentions.handleKeyDown(event)) return;
    if (event.key === 'Enter' && !event.shiftKey && canGenerateFrom(prompt, isGenerating, attachments)) {
      event.preventDefault();
      onSubmit();
    }
  };

  const startEditingMessage = (message: AssistantMessage) => { setEditingMessageId(message.id); setEditingDraft(message.content); };
  const submitEditedMessage = (messageIndex: number) => {
    const nextText = editingDraft.trim();
    if (!nextText) return;
    setEditingMessageId(null); setEditingDraft(''); onEditMessage(messageIndex, nextText);
  };

  if (!open) return null;
  const lastProgress = isGenerating ? progressMessages[progressMessages.length - 1] : '';
  const promptLabel = clarificationSuggestions ? 'Your answer' : messages.length ? 'Continue the conversation' : 'Ask the assistant';

  return (
    <div className="assistant-overlay" style={mobileViewportStyle}>
      <section
        ref={panelRef}
        className={`assistant-panel${isDropTarget ? ' is-drop-target' : ''}`}
        // Dropping a file anywhere on the panel attaches it, which is where people aim.
        onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setIsDropTarget(true); } }}
        onDragLeave={event => { if (!panelRef.current?.contains(event.relatedTarget as Node | null)) setIsDropTarget(false); }}
        onDrop={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setIsDropTarget(false); onAttachFiles(event.dataTransfer.files); } }}
        data-testid="assistant-panel" role={compact ? 'dialog' : 'complementary'} aria-modal={compact || undefined} aria-labelledby="assistant-title">
        <header className="assistant-header">
          <div className="assistant-title"><span className="assistant-avatar" aria-hidden="true">✦</span><h2 id="assistant-title">Robo-Boy AI</h2></div>
          <div className="assistant-header-actions">
            {messages.length > 0 && <button type="button" className="assistant-new" onClick={onNewConversation}>New chat</button>}
            <button type="button" className="assistant-icon-button" onClick={() => setShowSettings(true)} aria-label="Assistant settings" title="Assistant settings"><FaCog aria-hidden="true" /></button>
            <button type="button" className="assistant-icon-button" onClick={onClose} aria-label="Close assistant" title="Close"><FaTimes aria-hidden="true" /></button>
          </div>
        </header>

        {showSettings && <AssistantSettingsPopover settings={settings} resolvedBaseUrl={resolvedBaseUrl} onProviderChange={onProviderChange} onUpdate={onUpdateSettings} onClose={() => setShowSettings(false)} ollamaModels={ollamaModels} ollamaModelsError={ollamaModelsError} isLoadingOllamaModels={isLoadingOllamaModels} onRefreshOllamaModels={onRefreshOllamaModels} />}

        <div ref={chatRef} className="assistant-chat" onScroll={event => { const element = event.currentTarget; nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72; }}>
          {messages.length === 0 && <div className="assistant-empty"><span aria-hidden="true">✦</span><h3>Robo-Boy AI</h3><p>Ask Robo-Boy AI to build a Pad or a Behavior Tree, look up a transform, or explain anything in your current workspace.</p><p className="assistant-empty-hint">Type <strong>@</strong> to tag a topic, node, Pad, or tree.</p></div>}
          {messages.map((message, index) => (
            <article key={message.id} className={`assistant-message ${message.role}`}>
              <span className="assistant-message-role">{message.role === 'assistant' ? 'Assistant' : 'You'}</span>
              {editingMessageId === message.id ? (
                <div className="assistant-message-edit">
                  <span className="assistant-textarea-shell has-highlight">
                    <div className="assistant-textarea-highlight" ref={editingHighlightRef} aria-hidden="true"><MessageText text={editingDraft} tags={tagsForText(editingDraft)} /></div>
                    <textarea
                      ref={editingRef}
                      value={editingDraft}
                      onChange={event => { setEditingDraft(event.target.value); editingMentions.trackValue(event.target.value); }}
                      onScroll={event => { if (editingHighlightRef.current) editingHighlightRef.current.scrollTop = event.currentTarget.scrollTop; }}
                      onKeyDown={event => {
                        if (event.nativeEvent.isComposing) return;
                        if (editingMentions.handleKeyDown(event)) return;
                        if (event.key === 'Escape') { event.preventDefault(); setEditingMessageId(null); }
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submitEditedMessage(index); }
                      }}
                      aria-label="Edit message"
                      autoFocus
                    />
                  </span>
                  {editingMentions.node}
                  <div className="assistant-inline-actions"><button type="button" className="secondary" onClick={() => setEditingMessageId(null)}>Cancel</button><button type="button" onClick={() => submitEditedMessage(index)} disabled={!editingDraft.trim()}>Save &amp; resend</button></div>
                </div>
              ) : <MessageContent content={message.content} tags={tagsForText(message.content, message.contextTags)} onOpen={openResource} canOpen={canOpenResource} />}
              {message.attachments.length > 0 && (
                <div className="assistant-message-attachments">
                  {message.attachments.map(item =>
                    item.kind === 'image' ? (
                      <button type="button" className="assistant-message-image" key={item.id} onClick={() => setExpandedImage(item)} aria-label={`Expand ${item.name}`}>
                        <img src={dataUrlFor(item)} alt={item.name} />
                      </button>
                    ) : (
                      <span key={item.id}>{item.name}</span>
                    )
                  )}
                </div>
              )}

              {message.response?.kind === 'rosAction' && <div className="assistant-proposal-card"><strong>Review-only {message.response.operation.kind}: {message.response.operation.name}</strong><p>{message.response.rationale}</p><pre>{JSON.stringify(message.response.operation, null, 2)}</pre>{message.response.issues.map((issue, issueIndex) => <p className="assistant-proposal-warning" key={issueIndex}>{issue.message}</p>)}<small>Robo-Boy does not run robot operations from assistant chat. Add the reviewed operation through a Pad or Behavior Tree.</small></div>}
              {message.response?.kind === 'padProposal' && !message.resolution && <div className="assistant-proposal-card" data-testid="assistant-pad-proposal-card"><strong>Proposed Pad: {message.response.layout.name}</strong><p>{message.response.layout.components.length} components · review every binding before saving.</p>{message.response.issues.map((issue, issueIndex) => <p className="assistant-proposal-warning" key={issueIndex}>{issue.message}</p>)}<div className="assistant-inline-actions"><button type="button" onClick={() => onReviewPadProposal(message.id)}>Review in Pad editor</button></div></div>}
              {message.response?.kind === 'padProposal' && message.resolution === 'applied' && <p className="assistant-message-note">Opened in the Pad editor for review.</p>}
              {message.response?.kind === 'behaviorTree' && !hasActiveBehaviorTreeBridge && !message.resolution && <div className="assistant-proposal-card" data-testid="assistant-bt-proposal-card"><strong>Built “{message.response.tree.name}”</strong><p>{message.response.tree.nodes.length} nodes · {message.response.tree.edges.length} connections</p><div className="assistant-inline-actions"><button type="button" onClick={() => onSaveBehaviorTreeProposal(message.id)}>Save to Behavior Tree library</button></div></div>}
              {message.response?.kind === 'behaviorTree' && hasActiveBehaviorTreeBridge && !message.resolution && <p className="assistant-message-note">Previewed on the open Behavior Tree canvas. Accept or reject it there.</p>}
              {message.response?.kind === 'behaviorTree' && message.resolution === 'saved' && <p className="assistant-message-note">Saved to the Behavior Tree library.</p>}

              {message.contextUsed && message.contextUsed.length > 0 && <details className="assistant-context-used"><summary>Context used ({message.contextUsed.length})</summary><ul>{message.contextUsed.map((item, itemIndex) => <li key={`${item.label}-${itemIndex}`}><span>{item.label}</span><em>{item.source}{item.ageSeconds ? ` · ${item.ageSeconds}s ago` : ''}{item.stale ? ' · stale' : ''}</em></li>)}</ul></details>}
              {message.role === 'user' && editingMessageId !== message.id && <div className="assistant-message-actions"><button type="button" onClick={() => onRepeat(index)} disabled={isGenerating} aria-label="Repeat" title="Repeat"><FaRedo aria-hidden="true" /></button><button type="button" onClick={() => startEditingMessage(message)} disabled={isGenerating} aria-label="Edit message" title="Edit and resend"><FaPencilAlt aria-hidden="true" /></button></div>}
            </article>
          ))}
          {(lastProgress || error) && <div className={`assistant-status${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>{error || lastProgress}</div>}
          {clarificationSuggestions && <div className="assistant-suggestions">{clarificationSuggestions.map(item => <button type="button" key={item} onClick={() => onSelectSuggestion(item)}>{item}</button>)}</div>}
        </div>

        <form className="assistant-form" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
          <div className="assistant-composer-attachments" aria-label="Assistant attachments">
            {attachments.map(item => (
              <span className={`assistant-context-tag attachment ${item.kind}`} key={item.id}>
                {item.kind === 'image' && <img src={dataUrlFor(item)} alt="" aria-hidden="true" />}
                <span>{item.name}</span>
                <button type="button" onClick={() => onRemoveAttachment(item.id)} aria-label={`Remove attachment ${item.name}`}><FaTimes aria-hidden="true" /></button>
              </span>
            ))}
          </div>

          {composerMentions.node}

          <div className="assistant-composer">
            <AssistantSpeechTextarea
              id="assistant-prompt"
              className="assistant-composer-speech"
              label={promptLabel}
              value={prompt}
              onChange={handlePromptChange}
              onKeyDown={handlePromptKeyDown}
              onTranscribeAudio={onTranscribeAudio}
              holdToRecord={compact}
              language={settings.voiceLanguage}
              voiceButtonSlot={compact ? 'end' : 'start'}
              rows={1}
              autoGrow
              highlight={<MessageText text={prompt} tags={tagsForText(prompt)} />}
              textareaRef={promptRef}
              placeholder={compact ? 'Ask Robo-Boy about your robot, or to build a Pad…' : 'Ask Robo-Boy about your workspace, or to build a Pad or a Behavior Tree…'}
              toolbar={{
                start: (
                  <>
                    <button type="button" onClick={() => attachmentInputRef.current?.click()} aria-label="Attach files" title="Attach files"><FaPaperclip aria-hidden="true" /></button>
                    <button type="button" onClick={() => setShowSketchEditor(true)} aria-label="Create sketch attachment" title="Draw"><FaPaintBrush aria-hidden="true" /></button>
                    <input ref={attachmentInputRef} className="assistant-attachment-input" type="file" multiple accept="text/*,.md,.json,.yaml,.yml,.xml,.csv,.log,.launch,.urdf,.xacro,.py,.js,.jsx,.ts,.tsx,.css,.html,.sh,.toml,.ini,.cfg,image/png,image/jpeg,image/webp,image/gif" onChange={event => { onAttachFiles(event.target.files); event.currentTarget.value = ''; }} aria-label="Assistant attachments" />
                  </>
                ),
                // Left out on a phone with nothing to send, so the microphone takes this slot
                // rather than appearing a second time further down the row.
                end: !compact || isGenerating || canGenerateFrom(prompt, false, attachments) ? (
                  <button type={isGenerating ? 'button' : 'submit'} className="assistant-send" onClick={isGenerating ? onStop : undefined} disabled={!isGenerating && !canGenerateFrom(prompt, false, attachments)} aria-label={isGenerating ? 'Stop generating' : 'Send'}>{isGenerating ? <FaStop aria-hidden="true" /> : <FaArrowUp aria-hidden="true" />}</button>
                ) : undefined,
              }}
            />
          </div>
          {attachmentError && <span className="assistant-attachment-error" role="alert">{attachmentError}</span>}
          <small className="assistant-enter-hint">Enter to send · Shift+Enter for a new line</small>
        </form>

        {isDropTarget && <div className="assistant-drop-overlay" aria-hidden="true"><FaPaperclip aria-hidden="true" /><span>Drop to attach</span></div>}

        {expandedImage && createPortal(
          <div className="assistant-lightbox" role="dialog" aria-label={expandedImage.name} onClick={() => setExpandedImage(null)}>
            <img src={dataUrlFor(expandedImage)} alt={expandedImage.name} />
            <button type="button" onClick={() => setExpandedImage(null)} aria-label="Close image"><FaTimes aria-hidden="true" /></button>
          </div>,
          document.body
        )}

        {showSketchEditor && createPortal(<AssistantSketchEditor onAttach={dataUrl => { onSketchAttach(dataUrl); setShowSketchEditor(false); }} onClose={() => setShowSketchEditor(false)} />, document.body)}
      </section>
    </div>
  );
};

export default AssistantPanel;
