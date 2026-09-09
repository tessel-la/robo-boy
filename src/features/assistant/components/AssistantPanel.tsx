import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaArrowUp, FaCheck, FaCog, FaPaintBrush, FaPaperclip, FaPencilAlt, FaPlus, FaRedo, FaSearch, FaStop, FaSyncAlt, FaTimes } from 'react-icons/fa';
import type { AssistantAttachment, AssistantContextSourceKind, AssistantMessage, AssistantProviderId, AssistantSettings } from '../types';
import { transcribeAssistantAudio } from '../providers/transcription';
import AssistantSpeechTextarea from './AssistantSpeechTextarea';
import AssistantSketchEditor from './AssistantSketchEditor';
import AssistantSettingsPopover from './AssistantSettingsPopover';
import './AssistantPanel.css';

export interface ContextPickerOption {
  id: string;
  label: string;
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
  automaticContextLabels: string[];
  contextPickerSections: ContextPickerSection[];
  onRequestContextCatalog: () => void;
  isDiscoveringContext: boolean;
  attachments: AssistantAttachment[];
  attachmentError: string;
  onAttachFiles: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
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

const canGenerateFrom = (prompt: string, isGenerating: boolean) => Boolean(prompt.trim()) && !isGenerating;

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The `@Label` text a tagged resource reads as, in the prompt and in the transcript. */
const mentionTextFor = (tag: { label: string; mention?: string }) => `@${tag.mention ?? tag.label}`;

/** Colours the `@Label` mentions a message was sent with. The tagged resource is shown where the
 * author put it rather than in a separate strip, so tagging costs no vertical space. */
const MessageText = ({ text, tags }: { text: string; tags?: AssistantMessage['contextTags'] }) => {
  if (!tags?.length) return <>{text}</>;
  const sourceByMention = new Map(tags.map(tag => [mentionTextFor(tag), tag.source]));
  const mentions = [...sourceByMention.keys()].sort((a, b) => b.length - a.length).map(escapeForRegExp);
  const parts = text.split(new RegExp(`(${mentions.join('|')})`, 'g'));
  return (
    <>
      {parts.map((part, index) => {
        const source = sourceByMention.get(part);
        return source ? <mark key={index} className={`assistant-inline-tag source-${source}`}>{part}</mark> : part;
      })}
    </>
  );
};

const MessageContent = ({ content, tags }: { content: string; tags?: AssistantMessage['contextTags'] }) => {
  const segments = content.split(/```([\s\S]*?)```/g);
  return (
    <div className="assistant-message-content">
      {segments.map((segment, index) =>
        index % 2 === 1 ? <pre key={index}>{segment.trim()}</pre> : segment ? <p key={index}><MessageText text={segment} tags={tags} /></p> : null
      )}
    </div>
  );
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
    automaticContextLabels, contextPickerSections, onRequestContextCatalog, isDiscoveringContext,
    attachments, attachmentError, onAttachFiles, onRemoveAttachment, onSketchAttach, settings, resolvedBaseUrl,
    onProviderChange, onUpdateSettings, ollamaModels, ollamaModelsError, isLoadingOllamaModels,
    onRefreshOllamaModels, onReviewPadProposal, onSaveBehaviorTreeProposal, hasActiveBehaviorTreeBridge,
  } = props;

  const compact = useCompactAssistant();
  const [showSettings, setShowSettings] = useState(false);
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [showSketchEditor, setShowSketchEditor] = useState(false);
  const [contextSearch, setContextSearch] = useState('');
  const [loadingContextIds, setLoadingContextIds] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [mobileViewportStyle, setMobileViewportStyle] = useState<React.CSSProperties>();
  const panelRef = useRef<HTMLElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const nearBottomRef = useRef(true);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const allContextOptions = useMemo(() => contextPickerSections.flatMap(section => section.options), [contextPickerSections]);
  const mentionOptions = useMemo(() => {
    if (mentionQuery === null) return [];
    const needle = mentionQuery.toLocaleLowerCase();
    return allContextOptions
      .filter(option => !option.disabled && `${option.label} ${option.description}`.toLocaleLowerCase().includes(needle))
      .slice(0, 10);
  }, [allContextOptions, mentionQuery]);
  const activeMentionIndex = Math.min(mentionActiveIndex, Math.max(mentionOptions.length - 1, 0));
  // Only the resources the draft actually names, so the backdrop never builds a pattern over the
  // whole ROS graph.
  const draftTags = useMemo(
    () => allContextOptions.filter(option => prompt.includes(`@${option.label}`)).map(option => ({ id: option.id, label: option.label, source: option.source })),
    [allContextOptions, prompt]
  );

  const filteredSections = useMemo(() => {
    const needle = contextSearch.trim().toLocaleLowerCase();
    if (!needle) return contextPickerSections;
    return contextPickerSections
      .map(section => ({ ...section, options: section.options.filter(option => `${section.label} ${option.label} ${option.description}`.toLocaleLowerCase().includes(needle)) }))
      .filter(section => section.options.length > 0);
  }, [contextPickerSections, contextSearch]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !showSketchEditor) {
        event.preventDefault();
        if (showContextPicker) setShowContextPicker(false);
        else if (showSettings) setShowSettings(false);
        else if (mentionQuery !== null) setMentionQuery(null);
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
  }, [compact, editingMessageId, mentionQuery, onClose, open, showContextPicker, showSettings, showSketchEditor]);

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

  useEffect(() => {
    if (!open || !compact) { setMobileViewportStyle(undefined); return; }
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
  }, [compact, open]);

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
    const match = value.match(/(?:^|\s)@([^\s@]*)$/);
    setMentionQuery(match?.[1] ?? null);
    setMentionActiveIndex(0);
    if (match) setShowContextPicker(false);
  };

  /** Writes the resource into the prompt as `@Label` -- the mention is the tag -- and retrieves it
   * in the background so a second resource can be tagged while the first is still loading. */
  const selectContextOption = async (option: ContextPickerOption, fromMention = false) => {
    if (option.disabled) return;
    const mention = mentionTextFor({ label: option.label });
    const next = fromMention ? prompt.replace(/@([^\s@]*)$/, `${mention} `) : `${prompt.trimEnd()}${prompt.trim() ? ' ' : ''}${mention} `;
    onPromptChange(next);
    setMentionQuery(null);
    // Focusing a textarea whose value React just replaced leaves the caret at the start, so put it
    // back after the mention the user just chose.
    window.requestAnimationFrame(() => {
      const node = promptRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.length, next.length);
    });
    setLoadingContextIds(previous => [...previous, option.id]);
    try {
      await option.onSelect();
    } finally {
      setLoadingContextIds(previous => previous.filter(id => id !== option.id));
    }
  };

  const handlePromptKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = event => {
    if (event.nativeEvent.isComposing) return;
    if (mentionQuery !== null) {
      if (event.key === 'Escape') { event.preventDefault(); setMentionQuery(null); return; }
      if (mentionOptions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setMentionActiveIndex((activeMentionIndex + direction + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (mentionOptions.length && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void selectContextOption(mentionOptions[activeMentionIndex], true);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && canGenerateFrom(prompt, isGenerating)) {
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
      <section ref={panelRef} className="assistant-panel" data-testid="assistant-panel" role={compact ? 'dialog' : 'complementary'} aria-modal={compact || undefined} aria-labelledby="assistant-title">
        <header className="assistant-header">
          <div className="assistant-title"><span className="assistant-avatar" aria-hidden="true">✦</span><div><span className="assistant-kicker">Robo-Boy AI</span><h2 id="assistant-title">Assistant</h2></div></div>
          <div className="assistant-header-actions">
            {messages.length > 0 && <button type="button" className="assistant-new" onClick={onNewConversation}>New chat</button>}
            <button type="button" className="assistant-icon-button" onClick={() => setShowSettings(true)} aria-label="Assistant settings" title="Assistant settings"><FaCog aria-hidden="true" /></button>
            <button type="button" className="assistant-icon-button" onClick={onClose} aria-label="Close assistant" title="Close"><FaTimes aria-hidden="true" /></button>
          </div>
        </header>

        {showSettings && <AssistantSettingsPopover settings={settings} resolvedBaseUrl={resolvedBaseUrl} onProviderChange={onProviderChange} onUpdate={onUpdateSettings} onClose={() => setShowSettings(false)} ollamaModels={ollamaModels} ollamaModelsError={ollamaModelsError} isLoadingOllamaModels={isLoadingOllamaModels} onRefreshOllamaModels={onRefreshOllamaModels} />}

        <div ref={chatRef} className="assistant-chat" onScroll={event => { const element = event.currentTarget; nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72; }}>
          {messages.length === 0 && <div className="assistant-empty"><span aria-hidden="true">✦</span><h3>Work with the whole robot workspace</h3><p>Inspect the current Pad, Behavior Tree, ROS graph, TF, panels, and selected live data. Changes stay in the existing editors for review.</p></div>}
          {messages.map((message, index) => (
            <article key={message.id} className={`assistant-message ${message.role}`}>
              <span className="assistant-message-role">{message.role === 'assistant' ? 'Assistant' : 'You'}</span>
              {editingMessageId === message.id ? (
                <div className="assistant-message-edit"><textarea value={editingDraft} onChange={event => setEditingDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setEditingMessageId(null); } if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submitEditedMessage(index); } }} aria-label="Edit message" autoFocus /><div className="assistant-inline-actions"><button type="button" className="secondary" onClick={() => setEditingMessageId(null)}>Cancel</button><button type="button" onClick={() => submitEditedMessage(index)} disabled={!editingDraft.trim()}>Save &amp; resend</button></div></div>
              ) : <MessageContent content={message.content} tags={message.contextTags} />}
              {message.attachments.length > 0 && <div className="assistant-message-attachments">{message.attachments.map(item => <span key={item.id}>{item.name}</span>)}</div>}

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

        <div className="assistant-context-summary"><button type="button" onClick={() => { setShowContextPicker(value => !value); setShowSettings(false); if (!showContextPicker) onRequestContextCatalog(); }} aria-expanded={showContextPicker} aria-controls="assistant-context-browser"><FaPlus aria-hidden="true" /><span>Context</span><small>{automaticContextLabels.slice(0, 3).join(' · ')}{automaticContextLabels.length > 3 ? ` +${automaticContextLabels.length - 3}` : ''}</small></button></div>

        <form className="assistant-form" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
          <div className="assistant-context-tags" aria-label="Assistant attachments">
            {attachments.map(item => <span className="assistant-context-tag attachment" key={item.id}><span>{item.name}</span><button type="button" onClick={() => onRemoveAttachment(item.id)} aria-label={`Remove attachment ${item.name}`}><FaTimes aria-hidden="true" /></button></span>)}
          </div>

          {showContextPicker && <div id="assistant-context-browser" className="assistant-context-picker" role="dialog" aria-label="Add context" aria-busy={isDiscoveringContext || loadingContextIds.length > 0}>
            <header><div><strong>Add context</strong><span>Choose exact workspace or robot data</span></div><button type="button" onClick={() => setShowContextPicker(false)} aria-label="Close context picker"><FaTimes aria-hidden="true" /></button></header>
            <label className="assistant-context-search"><FaSearch aria-hidden="true" /><input value={contextSearch} onChange={event => setContextSearch(event.target.value)} placeholder="Search Pads, trees, topics, services…" autoFocus /></label>
            <div className="assistant-context-sections">{filteredSections.map(section => <section key={section.id}><div className="assistant-context-section-heading"><strong>{section.label}</strong>{section.description && <span>{section.description}</span>}</div>{section.options.map(option => <button type="button" key={option.id} disabled={option.disabled} onClick={() => void selectContextOption(option)}><span className="assistant-context-option-copy"><strong>{option.label}</strong><small>{option.description}</small></span>{loadingContextIds.includes(option.id) ? <FaSyncAlt className="spinning" aria-label="Loading context" /> : option.selected ? <FaCheck aria-label="Selected" /> : null}</button>)}</section>)}{filteredSections.length === 0 && <p className="assistant-context-empty">No matching context</p>}</div>
          </div>}

          {mentionQuery !== null && <div className="assistant-mention-picker" role="listbox" aria-label="Mention context">{mentionOptions.map((option, index) => <button type="button" role="option" aria-selected={index === activeMentionIndex} className={index === activeMentionIndex ? 'active' : ''} key={option.id} onClick={() => void selectContextOption(option, true)}><strong>{option.label}</strong><span>{option.description}</span></button>)}{mentionOptions.length === 0 && <span>No matching context</span>}</div>}

          <div className="assistant-composer">
            <AssistantSpeechTextarea
              id="assistant-prompt"
              className="assistant-composer-speech"
              label={promptLabel}
              value={prompt}
              onChange={handlePromptChange}
              onKeyDown={handlePromptKeyDown}
              onTranscribeAudio={audio => transcribeAssistantAudio(audio, { ...settings, baseUrl: resolvedBaseUrl })}
              rows={1}
              autoGrow
              highlight={<MessageText text={prompt} tags={draftTags} />}
              textareaRef={promptRef}
              placeholder={compact ? 'Ask about this workspace…' : 'Ask about this workspace, a Pad, ROS, TF, or a Behavior Tree…'}
              toolbar={{
                start: (
                  <>
                    <button type="button" onClick={() => attachmentInputRef.current?.click()} aria-label="Attach files" title="Attach files"><FaPaperclip aria-hidden="true" /></button>
                    <button type="button" onClick={() => setShowSketchEditor(true)} aria-label="Create sketch attachment" title="Draw"><FaPaintBrush aria-hidden="true" /></button>
                    <input ref={attachmentInputRef} className="assistant-attachment-input" type="file" multiple accept="text/*,.md,.json,.yaml,.yml,.xml,.csv,.log,.launch,.urdf,.xacro,.py,.js,.jsx,.ts,.tsx,.css,.html,.sh,.toml,.ini,.cfg,image/png,image/jpeg,image/webp,image/gif" onChange={event => { onAttachFiles(event.target.files); event.currentTarget.value = ''; }} aria-label="Assistant attachments" />
                  </>
                ),
                end: (
                  <button type={isGenerating ? 'button' : 'submit'} className="assistant-send" onClick={isGenerating ? onStop : undefined} disabled={!isGenerating && !canGenerateFrom(prompt, false)} aria-label={isGenerating ? 'Stop generating' : 'Send'}>{isGenerating ? <FaStop aria-hidden="true" /> : <FaArrowUp aria-hidden="true" />}</button>
                ),
              }}
            />
          </div>
          {attachmentError && <span className="assistant-attachment-error" role="alert">{attachmentError}</span>}
          <small className="assistant-enter-hint">Enter to send · Shift+Enter for a new line</small>
        </form>

        {showSketchEditor && createPortal(<AssistantSketchEditor onAttach={dataUrl => { onSketchAttach(dataUrl); setShowSketchEditor(false); }} onClose={() => setShowSketchEditor(false)} />, document.body)}
      </section>
    </div>
  );
};

export default AssistantPanel;
