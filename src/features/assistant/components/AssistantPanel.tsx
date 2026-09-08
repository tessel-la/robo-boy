import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaCog, FaPaintBrush, FaPaperclip, FaPencilAlt, FaPlus, FaRedo, FaSyncAlt, FaTimes } from 'react-icons/fa';
import type {
  AssistantAttachment,
  AssistantContextChip,
  AssistantMessage,
  AssistantProviderId,
  AssistantSettings,
} from '../types';
import { transcribeAssistantAudio } from '../providers/transcription';
import AssistantSpeechTextarea from './AssistantSpeechTextarea';
import AssistantSketchEditor from './AssistantSketchEditor';
import AssistantSettingsPopover from './AssistantSettingsPopover';
import './AssistantPanel.css';

type AgentResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
interface PanelFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ContextPickerOption {
  id: string;
  label: string;
  description: string;
  onSelect: () => void;
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
  onRewind: (messageIndex: number) => void;

  contextChips: AssistantContextChip[];
  onRemoveContextChip: (id: string) => void;
  contextPickerOptions: ContextPickerOption[];
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

  onRunRosAction: (messageId: string) => void;
  onSavePadProposal: (messageId: string) => void;
  onSaveBehaviorTreeProposal: (messageId: string) => void;
  /** True when a mounted BehaviorTreePanel is registered as the active BT document, meaning a
   * `behaviorTree`-kind proposal is already shown as an on-canvas preview there instead of needing
   * an inline "save" affordance here. */
  hasActiveBehaviorTreeBridge: boolean;
}

const canGenerateFrom = (prompt: string, isGenerating: boolean) => Boolean(prompt.trim()) && !isGenerating;

const AssistantPanel: React.FC<AssistantPanelProps> = props => {
  const {
    open,
    onClose,
    messages,
    isGenerating,
    progressMessages,
    error,
    clarificationSuggestions,
    onSelectSuggestion,
    prompt,
    onPromptChange,
    onSubmit,
    onStop,
    onNewConversation,
    onRepeat,
    onRewind,
    contextChips,
    onRemoveContextChip,
    contextPickerOptions,
    isDiscoveringContext,
    attachments,
    attachmentError,
    onAttachFiles,
    onRemoveAttachment,
    onSketchAttach,
    settings,
    resolvedBaseUrl,
    onProviderChange,
    onUpdateSettings,
    ollamaModels,
    ollamaModelsError,
    isLoadingOllamaModels,
    onRefreshOllamaModels,
    onRunRosAction,
    onSavePadProposal,
    onSaveBehaviorTreeProposal,
    hasActiveBehaviorTreeBridge,
  } = props;

  const [showSettings, setShowSettings] = useState(false);
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [showSketchEditor, setShowSketchEditor] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [panelFrame, setPanelFrame] = useState<PanelFrame | null>(null);
  const [resizeCorner, setResizeCorner] = useState<AgentResizeCorner | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // Lightweight "@mention" support (plan follow-up, per explicit user request): typing "@" opens
  // the same context-picker options inline, filtered as you type, so referencing/tagging a
  // resource doesn't require reaching for the "+" button. Selecting one both inserts a token in
  // the text and adds the context chip — it does not create any new context source of its own.
  const mentionOptions = useMemo(() => {
    if (mentionQuery === null) return [];
    const needle = mentionQuery.toLocaleLowerCase();
    return contextPickerOptions
      .filter(option => `${option.label} ${option.description}`.toLocaleLowerCase().includes(needle))
      .slice(0, 12);
  }, [contextPickerOptions, mentionQuery]);
  const activeMentionIndex = Math.min(mentionActiveIndex, Math.max(mentionOptions.length - 1, 0));

  const handlePromptChange = (value: string) => {
    onPromptChange(value);
    const match = value.match(/(?:^|\s)@([^\s@]*)$/);
    const nextQuery = match?.[1] ?? null;
    setMentionQuery(nextQuery);
    setMentionActiveIndex(0);
    if (nextQuery !== null) setShowContextPicker(false);
  };

  const selectMentionOption = (option: ContextPickerOption) => {
    option.onSelect();
    const mentionToken = option.label.replace(/\s+/g, '_');
    onPromptChange(prompt.replace(/@([^\s@]*)$/, `@${mentionToken} `));
    setMentionQuery(null);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  };

  const handlePromptKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = event => {
    if (mentionQuery === null || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setMentionQuery(null);
      return;
    }
    if (mentionOptions.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setMentionActiveIndex((activeMentionIndex + direction + mentionOptions.length) % mentionOptions.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      selectMentionOption(mentionOptions[activeMentionIndex]);
    }
  };

  React.useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !showSketchEditor) onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open, showSketchEditor]);

  React.useEffect(() => {
    if (!open) setShowSketchEditor(false);
  }, [open]);

  const handleResizeStart = (corner: AgentResizeCorner, event: React.PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    event.preventDefault();
    event.stopPropagation();

    const parentRect = parent.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const start = {
      left: panelRect.left - parentRect.left,
      top: panelRect.top - parentRect.top,
      width: panelRect.width,
      height: panelRect.height,
    };
    const startRight = start.left + start.width;
    const startBottom = start.top + start.height;
    const startX = event.clientX;
    const startY = event.clientY;
    const margin = 12;
    const minWidth = Math.min(300, parentRect.width - margin * 2);
    const minHeight = Math.min(320, parentRect.height - margin * 2);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    setPanelFrame(start);
    setResizeCorner(corner);
    document.body.style.cursor = `${corner}-resize`;
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      let left = start.left;
      let right = startRight;
      let top = start.top;
      let bottom = startBottom;

      if (corner.includes('w')) left = Math.min(Math.max(start.left + deltaX, margin), startRight - minWidth);
      else right = Math.max(Math.min(startRight + deltaX, parentRect.width - margin), start.left + minWidth);
      if (corner.includes('n')) top = Math.min(Math.max(start.top + deltaY, margin), startBottom - minHeight);
      else bottom = Math.max(Math.min(startBottom + deltaY, parentRect.height - margin), start.top + minHeight);

      setPanelFrame({ left, top, width: right - left, height: bottom - top });
    };

    const handlePointerUp = () => {
      setResizeCorner(null);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const handleSketchAttachInternal = (dataUrl: string) => {
    onSketchAttach(dataUrl);
    setShowSketchEditor(false);
  };

  const promptLabel = clarificationSuggestions
    ? 'Your answer'
    : messages.length > 0
      ? 'Continue the conversation'
      : 'Ask the assistant';

  const lastError = error;
  const lastProgress = progressMessages[progressMessages.length - 1];

  const bridgeNoteFor = (message: AssistantMessage): string | null => {
    if (message.response?.kind !== 'behaviorTree' || message.resolution) return null;
    return hasActiveBehaviorTreeBridge
      ? 'Shown as a preview on the open Behavior Tree canvas — accept or reject it there.'
      : null;
  };

  if (!open) return null;

  return (
    <div className="assistant-overlay">
      <section
        className={`assistant-panel${resizeCorner ? ' is-resizing' : ''}${isMobileExpanded ? ' is-expanded' : ''}`}
        ref={panelRef}
        style={panelFrame ? { position: 'absolute', ...panelFrame } : undefined}
        data-testid="assistant-panel"
        role="dialog"
        aria-labelledby="assistant-title"
        onPointerDown={event => {
          const target = event.target;
          if (showContextPicker && target instanceof Element && !target.closest('.assistant-context-picker, .assistant-context-add')) {
            setShowContextPicker(false);
          }
          if (showSettings && target instanceof Element && !target.closest('.assistant-settings-popover, .assistant-settings-button')) {
            setShowSettings(false);
          }
          if (mentionQuery !== null && target instanceof Element && !target.closest('.assistant-mention-picker, .assistant-composer-speech')) {
            setMentionQuery(null);
          }
        }}
      >
        <div
          className="assistant-sheet-handle"
          aria-hidden="true"
          onClick={() => setIsMobileExpanded(value => !value)}
        />
        <header className="assistant-header">
          <div className="assistant-title">
            <span className="assistant-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3l1.3 4.2 4.2 1.3-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3zM18.5 14l.7 2.2 2.3.8-2.3.7-.7 2.3-.8-2.3-2.2-.7 2.2-.8.8-2.2z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div>
              <span className="assistant-kicker">Robo Boy AI</span>
              <h2 id="assistant-title">Assistant</h2>
            </div>
          </div>
          <div className="assistant-header-actions">
            {messages.length > 0 && (
              <button type="button" className="assistant-new" onClick={onNewConversation}>
                New chat
              </button>
            )}
            <button
              type="button"
              className="assistant-settings-button"
              onClick={() => setShowSettings(value => !value)}
              aria-label="Assistant settings"
              title="Assistant settings"
              aria-expanded={showSettings}
            >
              <FaCog aria-hidden="true" />
            </button>
            <button type="button" className="assistant-close" onClick={onClose} aria-label="Close assistant" title="Close">
              <FaTimes aria-hidden="true" />
            </button>
          </div>
        </header>

        {showSettings && (
          <AssistantSettingsPopover
            settings={settings}
            resolvedBaseUrl={resolvedBaseUrl}
            onProviderChange={onProviderChange}
            onUpdate={onUpdateSettings}
            onClose={() => setShowSettings(false)}
            ollamaModels={ollamaModels}
            ollamaModelsError={ollamaModelsError}
            isLoadingOllamaModels={isLoadingOllamaModels}
            onRefreshOllamaModels={onRefreshOllamaModels}
          />
        )}

        <div className="assistant-body">
          <div className="assistant-chat" aria-live="polite">
            {messages.map((message, index) => {
              const note = bridgeNoteFor(message);
              return (
                <div key={message.id} className={`assistant-message ${message.role}`}>
                  <span>{message.role === 'assistant' ? 'Assistant' : 'You'}</span>
                  <p>{message.content}</p>
                  {message.attachments.length > 0 && (
                    <div className="assistant-message-attachments">
                      {message.attachments.map(attachment => (
                        <span key={attachment.id}>{attachment.name}</span>
                      ))}
                    </div>
                  )}
                  {note && (
                    <p className="assistant-message-note" role="status">
                      {note}
                    </p>
                  )}
                  {message.response?.kind === 'rosAction' && !message.resolution && (
                    <div className="assistant-proposal-card" data-testid="assistant-ros-action-card">
                      <strong>Proposed {message.response.operation.kind}: {message.response.operation.name}</strong>
                      <p>{message.response.rationale}</p>
                      <pre>{JSON.stringify(message.response.operation.payload ?? {}, null, 2)}</pre>
                      <div className="assistant-proposal-actions">
                        <button type="button" onClick={() => onRunRosAction(message.id)}>
                          Run
                        </button>
                      </div>
                    </div>
                  )}
                  {message.response?.kind === 'rosAction' && message.resolution === 'ran' && (
                    <p className="assistant-message-note" role="status">Action executed.</p>
                  )}
                  {message.response?.kind === 'rosAction' && message.resolution === 'failed' && (
                    <p className="assistant-message-note" role="alert">Action failed — see the error above.</p>
                  )}
                  {message.response?.kind === 'padProposal' && !message.resolution && (
                    <div className="assistant-proposal-card" data-testid="assistant-pad-proposal-card">
                      <strong>Proposed Pad: {message.response.layout.name}</strong>
                      {message.response.issues.length > 0 && (
                        <ul>
                          {message.response.issues.map((issue, issueIndex) => (
                            <li key={issueIndex}>{issue.message}</li>
                          ))}
                        </ul>
                      )}
                      <div className="assistant-proposal-actions">
                        <button type="button" onClick={() => onSavePadProposal(message.id)}>
                          Save to Pad library
                        </button>
                      </div>
                    </div>
                  )}
                  {message.response?.kind === 'padProposal' && message.resolution === 'saved' && (
                    <p className="assistant-message-note" role="status">Saved to your Pad library.</p>
                  )}
                  {message.response?.kind === 'behaviorTree' && !hasActiveBehaviorTreeBridge && !message.resolution && (
                    <div className="assistant-proposal-card" data-testid="assistant-bt-proposal-card">
                      <strong>Built “{message.response.tree.name}”</strong>
                      <p>{message.response.tree.nodes.length} nodes, {message.response.tree.edges.length} connections.</p>
                      <div className="assistant-proposal-actions">
                        <button type="button" onClick={() => onSaveBehaviorTreeProposal(message.id)}>
                          Save to Behavior Tree library
                        </button>
                      </div>
                    </div>
                  )}
                  {message.response?.kind === 'behaviorTree' && message.resolution === 'saved' && (
                    <p className="assistant-message-note" role="status">Saved to your Behavior Tree library.</p>
                  )}
                  {message.role === 'user' && (
                    <div className="assistant-message-actions">
                      <button type="button" onClick={() => onRepeat(index)} disabled={isGenerating} aria-label="Repeat" title="Repeat">
                        <FaRedo aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRewind(index)}
                        disabled={isGenerating}
                        aria-label="Edit from here"
                        title="Go back and edit from here"
                      >
                        <FaPencilAlt aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {(lastProgress || lastError) && (
              <div className="assistant-message assistant status">
                <span>Assistant</span>
                <p role={lastError ? 'alert' : 'status'}>{lastError || lastProgress}</p>
              </div>
            )}
            {clarificationSuggestions && clarificationSuggestions.length > 0 && (
              <div className="assistant-suggestions">
                {clarificationSuggestions.map(suggestion => (
                  <button type="button" key={suggestion} onClick={() => onSelectSuggestion(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <form
          className="assistant-form"
          onSubmit={event => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="assistant-composer">
            {isDiscoveringContext && (
              <div className="assistant-composer-heading">
                <span role="status">
                  <FaSyncAlt className="spinning" aria-hidden="true" />
                  Gathering context…
                </span>
              </div>
            )}
            <div className="assistant-composer-context-line">
              <div className="assistant-context-tags" aria-label="Assistant context">
                {contextChips.map(chip => (
                  <span className={`assistant-context-tag${chip.stale ? ' stale' : ''}`} key={chip.id} title={chip.label}>
                    <span>{chip.label}</span>
                    <button type="button" onClick={() => onRemoveContextChip(chip.id)} aria-label={`Remove ${chip.label} from context`}>
                      <FaTimes aria-hidden="true" />
                    </button>
                  </span>
                ))}
                {attachments.map(attachment => (
                  <span className="assistant-context-tag attachment" key={attachment.id} title={attachment.name}>
                    <span>{attachment.name}</span>
                    <button type="button" onClick={() => onRemoveAttachment(attachment.id)} aria-label={`Remove attachment ${attachment.name}`}>
                      <FaTimes aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="assistant-composer-tools">
                <button
                  type="button"
                  className="assistant-composer-icon assistant-context-add"
                  onClick={() => setShowContextPicker(value => !value)}
                  aria-label="Add assistant context"
                  title="Add context"
                >
                  <FaPlus aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="assistant-composer-icon"
                  onClick={() => attachmentInputRef.current?.click()}
                  aria-label="Attach files"
                  title="Attach files"
                >
                  <FaPaperclip aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="assistant-composer-icon"
                  onClick={() => {
                    setShowContextPicker(false);
                    setShowSketchEditor(true);
                  }}
                  aria-label="Create sketch attachment"
                  title="Draw"
                >
                  <FaPaintBrush aria-hidden="true" />
                </button>
                <input
                  ref={attachmentInputRef}
                  className="assistant-attachment-input"
                  type="file"
                  multiple
                  accept="text/*,.md,.json,.yaml,.yml,.xml,.csv,.log,.launch,.urdf,.xacro,.py,.js,.jsx,.ts,.tsx,.css,.html,.sh,.toml,.ini,.cfg,image/png,image/jpeg,image/webp,image/gif"
                  onChange={event => {
                    onAttachFiles(event.target.files);
                    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
                  }}
                  aria-label="Assistant attachments"
                />
              </div>
            </div>
            {showContextPicker && (
              <div className="assistant-context-picker" role="dialog" aria-label="Add context" aria-busy={isDiscoveringContext}>
                <div className="assistant-context-picker-header">
                  <strong>Add context</strong>
                  <span>{isDiscoveringContext && <FaSyncAlt className="spinning" aria-label="Gathering context" />}</span>
                  <button type="button" onClick={() => setShowContextPicker(false)} aria-label="Close context picker">
                    <FaTimes aria-hidden="true" />
                  </button>
                </div>
                {contextPickerOptions.map(option => (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => {
                      option.onSelect();
                      setShowContextPicker(false);
                    }}
                  >
                    {option.label}
                    <span>{option.description}</span>
                  </button>
                ))}
                {contextPickerOptions.length === 0 && <span className="assistant-context-empty">No additional context available</span>}
              </div>
            )}
            {mentionQuery !== null && (
              <div
                className="assistant-context-picker assistant-mention-picker"
                role="listbox"
                aria-label="Mention context"
                aria-busy={isDiscoveringContext}
              >
                {mentionOptions.map((option, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeMentionIndex}
                    className={index === activeMentionIndex ? 'active' : undefined}
                    key={option.id}
                    onMouseEnter={() => setMentionActiveIndex(index)}
                    onClick={() => selectMentionOption(option)}
                  >
                    {option.label}
                    <span>{option.description}</span>
                  </button>
                ))}
                {mentionOptions.length === 0 && <span className="assistant-context-empty">No matching context</span>}
              </div>
            )}
            <AssistantSpeechTextarea
              id="assistant-prompt"
              className="assistant-composer-speech"
              label={promptLabel}
              value={prompt}
              onChange={handlePromptChange}
              onKeyDown={handlePromptKeyDown}
              onTranscribeAudio={audio => transcribeAssistantAudio(audio, { ...settings, baseUrl: resolvedBaseUrl })}
              rows={clarificationSuggestions ? 3 : 4}
              textareaRef={promptRef}
              placeholder={
                clarificationSuggestions
                  ? 'Answer the assistant’s question…'
                  : 'Ask about Pads, Behavior Trees, ROS topics, TF, or propose a change… (@ to tag a resource)'
              }
            />
            {attachmentError && (
              <span className="assistant-attachment-error" role="alert">
                {attachmentError}
              </span>
            )}
            <div className="assistant-form-actions">
              {isGenerating && (
                <button type="button" className="secondary" onClick={onStop}>
                  Stop
                </button>
              )}
              <button type="submit" disabled={!canGenerateFrom(prompt, isGenerating)}>
                {isGenerating ? 'Thinking…' : clarificationSuggestions ? 'Send answer' : 'Send'}
              </button>
            </div>
          </div>
        </form>

        {showSketchEditor &&
          createPortal(<AssistantSketchEditor onAttach={handleSketchAttachInternal} onClose={() => setShowSketchEditor(false)} />, document.body)}

        {(['nw', 'ne', 'sw', 'se'] as AgentResizeCorner[]).map(corner => (
          <div
            key={corner}
            className={`assistant-resize-handle ${corner}`}
            onPointerDown={event => handleResizeStart(corner, event)}
            role="separator"
            aria-label={`Resize assistant from ${corner} corner`}
          />
        ))}
      </section>
    </div>
  );
};

export default AssistantPanel;
