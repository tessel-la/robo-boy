import type { ApiKeyStoragePolicy, ApiKeyStorageState } from '../../../runtime/assistantSubscription';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FaArrowLeft,
  FaArrowRight,
  FaArrowUp,
  FaCheck,
  FaChevronDown,
  FaCog,
  FaHistory,
  FaPaperclip,
  FaPen,
  FaPencilAlt,
  FaPlus,
  FaRedo,
  FaSearch,
  FaStop,
  FaSyncAlt,
  FaTimes,
  FaTrashAlt,
} from 'react-icons/fa';
import { HiSparkles } from 'react-icons/hi2';
import type {
  AssistantAttachment,
  AssistantContextSourceKind,
  AssistantMessage,
  AssistantProviderId,
  AssistantSettings,
} from '../types';
import AssistantSpeechTextarea from './AssistantSpeechTextarea';
import { AssistantModelControl } from './AssistantModelControl';
import AssistantThinkingSettings from './AssistantThinkingSettings';
import { AssistantDisclosure } from './AssistantDisclosure';
import AssistantSettingsPopover from './AssistantSettingsPopover';
import { AssistantActivity } from './AssistantActivity';
import { MessageText, type ResourceTextProps } from './MessageText';
import { resolveCompactAssistantFrame, type CompactAssistantFrame } from './mobileAssistantLayout';
import '../../treePanel/components/TreePanelChrome.css';
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
  monitors?: import('../runtime/monitors').MonitorStatus[];
  onStopMonitor?: (id: string) => void;
  sessions?: Array<{ id: string; title: string; archived?: boolean }>;
  activeSessionId?: string;
  onSwitchSession?: (id: string) => void;
  onRenameSession?: (id: string, title: string) => void;
  onDeleteSession?: (id: string) => void;
  onArchiveSession?: (id: string) => void;
  onForkSession?: () => void;
  documentChanges?: Array<{ id: string; label: string; diff?: string }>;
  onUndoDocument?: (id: string) => void;
  events?: import('../runtime/session').AgentEvent[];
  pendingInputs?: import('../runtime/session').PendingInput[];
  onPendingInputChange?: (id: string, text: string) => void;
  onMovePendingInput?: (id: string, direction: -1 | 1) => void;
  onRemovePendingInput?: (id: string) => void;
  open: boolean;
  compact: boolean;
  onClose: () => void;
  messages: AssistantMessage[];
  isGenerating: boolean;
  progressMessages: string[];
  thinking?: string;
  streamedAnswer?: string;
  error: string;
  clarificationSuggestions?: string[];
  onSelectSuggestion: (suggestion: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: (delivery?: import('../runtime/session').InputDelivery) => void;
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
  onAttachFiles: (files: FileList | readonly File[] | null) => void;
  onRemoveAttachment: (id: string) => void;
  /** Turns a finished recording into text for the prompt. */
  onTranscribeAudio: (audio: Blob) => Promise<string>;
  settings: AssistantSettings;
  resolvedBaseUrl: string;
  onProviderChange: (provider: AssistantProviderId) => void;
  onUpdateSettings: (patch: Partial<AssistantSettings>) => void;
  apiKeyStorage?: ApiKeyStorageState;
  loadingCredentials?: boolean;
  onApiKeyStorageChange?: (policy: ApiKeyStoragePolicy) => void;
  ollamaModels: string[];
  ollamaModelsError: string;
  isLoadingOllamaModels: boolean;
  onRefreshOllamaModels: () => void;
  onReviewPadProposal: (messageId: string) => void;
  onSaveBehaviorTreeProposal: (messageId: string) => void;
  onRejectProposal?: (messageId: string) => void;
  hasActiveBehaviorTreeBridge: boolean;
}

/** Binary attachments are held as bare base64 so they survive a JSON round trip; the DOM wants the
 * data URL back. */
const dataUrlFor = (attachment: AssistantAttachment) => `data:${attachment.mimeType};base64,${attachment.content}`;

const canGenerateFrom = (prompt: string, isGenerating: boolean, attachments: AssistantAttachment[] = []) =>
  (Boolean(prompt.trim()) || attachments.length > 0) && !isGenerating;

// Keep the Markdown parser out of the workspace's initial chunk (including the mobile PWA).
const MarkdownRenderer = React.lazy(() =>
  import('./AssistantMarkdown').then(module => ({ default: module.AssistantMarkdown }))
);
const SketchEditor = React.lazy(() => import('./AssistantSketchEditor'));
function AssistantMarkdown(props: ResourceTextProps & { content: string }) {
  return (
    <React.Suspense
      fallback={
        <div className="assistant-message-content">
          <p>{props.content}</p>
        </div>
      }
    >
      <MarkdownRenderer {...props} />
    </React.Suspense>
  );
}

/** The `@Label` text a tagged resource reads as, in the prompt and in the transcript. */
const mentionTextFor = (tag: { label: string; mention?: string }) => `@${tag.mention ?? tag.label}`;

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
      .filter(
        option => !option.disabled && `${option.label} ${option.description}`.toLocaleLowerCase().includes(needle)
      )
      .slice(0, 10);
  }, [options, query]);
  const index = Math.min(activeIndex, Math.max(matches.length - 1, 0));

  const close = () => setQuery(null);
  const choose = (option: ContextPickerOption) => {
    close();
    apply(option);
  };

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
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return true;
      }
      if (matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        setActiveIndex((index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
        return true;
      }
      if (matches.length && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        choose(matches[index]);
        return true;
      }
      return false;
    },
    node:
      query === null ? null : (
        <div className={`assistant-mention-picker ${placement}`} role="listbox" aria-label="Mention context">
          {matches.map((option, position) => (
            <button
              type="button"
              role="option"
              aria-selected={position === index}
              className={position === index ? 'active' : ''}
              key={option.id}
              onClick={() => choose(option)}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
          {matches.length === 0 && <span>No matching context</span>}
        </div>
      ),
  };
};

import { useFloatingFrame, type ResizeEdge } from './useFloatingFrame';

const RESIZE_EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const ASSISTANT_EXIT_FALLBACK_MS = 260;
type AssistantMotionPhase = 'closed' | 'entering' | 'open' | 'closing';

const AssistantPanel: React.FC<AssistantPanelProps> = props => {
  const {
    open,
    compact,
    onClose,
    messages,
    isGenerating,
    progressMessages,
    thinking,
    streamedAnswer,
    error,
    clarificationSuggestions,
    onSelectSuggestion,
    prompt,
    onPromptChange,
    onSubmit,
    onStop,
    onNewConversation,
    onRepeat,
    onEditMessage,
    onOpenResource,
    canOpenResource,
    contextPickerSections,
    attachments,
    attachmentError,
    onAttachFiles,
    onRemoveAttachment,
    onTranscribeAudio,
    settings,
    resolvedBaseUrl,
    onProviderChange,
    onUpdateSettings,
    apiKeyStorage,
    loadingCredentials,
    onApiKeyStorageChange,
    ollamaModels,
    ollamaModelsError,
    isLoadingOllamaModels,
    onRefreshOllamaModels,
    onReviewPadProposal,
    onSaveBehaviorTreeProposal,
    hasActiveBehaviorTreeBridge,
  } = props;

  const [activeView, setActiveView] = useState<'chat' | 'settings' | 'sessions'>('chat');
  const showSettings = activeView === 'settings';
  const showSessions = activeView === 'sessions';
  const [delivery, setDelivery] = useState<import('../runtime/session').InputDelivery>('steer');
  const [sessionSearch, setSessionSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const selectedSession =
    props.sessions?.find(session => session.id === selectedSessionId) ??
    props.sessions?.find(session => session.id === props.activeSessionId);
  const [showLatest, setShowLatest] = useState(false);
  const [showComposerOptions, setShowComposerOptions] = useState(false);
  const waitingQuestion = props.events?.find(event => event.type === 'question' && event.status === 'running');
  const [sessionAction, setSessionAction] = useState<{ kind: 'rename' | 'delete'; id: string; title: string }>();
  const [loadingContextIds, setLoadingContextIds] = useState<string[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [expandedImage, setExpandedImage] = useState<AssistantAttachment | null>(null);
  const [showSketch, setShowSketch] = useState(false);
  const sketchButtonRef = useRef<HTMLButtonElement>(null);
  const closeSketch = useCallback(() => {
    setShowSketch(false);
    sketchButtonRef.current?.focus();
  }, []);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [compactFrame, setCompactFrame] = useState<CompactAssistantFrame>();
  const [isMobileResizing, setIsMobileResizing] = useState(false);
  const [isRendered, setIsRendered] = useState(open);
  const [motionPhase, setMotionPhase] = useState<AssistantMotionPhase>(open ? 'entering' : 'closed');
  const panelRef = useRef<HTMLElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const editingRef = useRef<HTMLTextAreaElement>(null);
  const editingHighlightRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const composerOptionsRef = useRef<HTMLDivElement>(null);
  const composerOptionsButtonRef = useRef<HTMLButtonElement>(null);
  const nearBottomRef = useRef(true);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const mobileHeightRef = useRef<number>();
  const mobileResizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

  // Keep the surface mounted just long enough to play its exit. Reopening during that short exit
  // cancels the pending unmount and runs the entrance again from the persistent launcher.
  useEffect(() => {
    if (open) {
      setIsRendered(true);
      setMotionPhase('entering');
      return;
    }
    mobileResizeRef.current = null;
    setShowSketch(false);
    setIsMobileResizing(false);
    document.documentElement.classList.remove('assistant-mobile-resizing');
    if (!isRendered) return;
    setMotionPhase('closing');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setIsRendered(false);
      setMotionPhase('closed');
      return;
    }
    const timeout = window.setTimeout(() => {
      setIsRendered(false);
      setMotionPhase('closed');
    }, ASSISTANT_EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timeout);
  }, [isRendered, open]);

  const allContextOptions = useMemo(
    () => contextPickerSections.flatMap(section => section.options),
    [contextPickerSections]
  );
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
        if (haystack.includes(mention.toLowerCase()))
          byMention.set(mention.toLowerCase(), { id: option.id, label: option.label, source: option.source });
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
    ? (id: string) => {
        if (onOpenResource(id) && compact) onClose();
      }
    : undefined;

  const composerField = { value: prompt, setValue: onPromptChange, ref: promptRef };
  const editingField = { value: editingDraft, setValue: setEditingDraft, ref: editingRef };
  const composerMentions = useMentionPicker(allContextOptions, option => tagInto(option, composerField, true));
  const editingMentions = useMentionPicker(allContextOptions, option => tagInto(option, editingField, true), 'below');

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (showSketch) closeSketch();
        else if (showComposerOptions) {
          setShowComposerOptions(false);
          composerOptionsButtonRef.current?.focus();
        } else if (sessionAction) setSessionAction(undefined);
        else if (expandedImage) setExpandedImage(null);
        else if (activeView !== 'chat') {
          const previousView = activeView;
          setActiveView('chat');
          window.requestAnimationFrame(() =>
            panelRef.current
              ?.querySelector<HTMLButtonElement>(
                previousView === 'settings' ? '[aria-label="Assistant settings"]' : '[aria-label="Chats"]'
              )
              ?.focus({ preventScroll: true })
          );
        } else if (composerMentions.isOpen) composerMentions.close();
        else if (editingMentions.isOpen) editingMentions.close();
        else if (editingMessageId) {
          setEditingMessageId(null);
          setEditingDraft('');
        } else onClose();
      }
      if (event.key === 'Tab' && !showSketch && compactFrame?.takeover && panelRef.current) {
        const focusable = [
          ...panelRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
          ),
        ].filter(element => element.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeView,
    compactFrame?.takeover,
    composerMentions,
    editingMentions,
    editingMessageId,
    expandedImage,
    onClose,
    open,
    sessionAction,
    showComposerOptions,
    showSketch,
    closeSketch,
  ]);

  useEffect(() => {
    if (!showComposerOptions) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (
        !composerOptionsRef.current?.contains(event.target as Node) &&
        !composerOptionsButtonRef.current?.contains(event.target as Node)
      )
        setShowComposerOptions(false);
    };
    composerOptionsRef.current?.querySelector<HTMLSelectElement>('select')?.focus();
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [showComposerOptions]);

  useEffect(() => {
    setShowComposerOptions(false);
  }, [open, activeView]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      // Opening a mobile sheet must not immediately summon the software keyboard and turn the
      // docked layout into a full-height keyboard layout. The composer focuses when it is tapped.
      if (!compact) promptRef.current?.focus({ preventScroll: true });
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus({ preventScroll: true });
      previousFocusRef.current = null;
    };
  }, [compact, open]);

  const placeCompactPanel = useCallback((requestedHeight = mobileHeightRef.current) => {
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const toolbarBottom = document.querySelector('.top-bar')?.getBoundingClientRect().bottom ?? viewportTop;
    const frame = resolveCompactAssistantFrame({
      viewportTop,
      viewportHeight: viewport?.height ?? window.innerHeight,
      viewportWidth: viewport?.width ?? window.innerWidth,
      toolbarBottom,
      requestedHeight,
    });
    setCompactFrame(frame);
    const root = document.documentElement;
    root.style.setProperty('--assistant-mobile-workspace-inset', `${frame.workspaceInset}px`);
    root.classList.toggle('assistant-mobile-takeover', frame.takeover);
  }, []);

  /** Fits the mobile sheet to the visual viewport and tells the workspace how much room it owns. */
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!compact || !isRendered) {
      setCompactFrame(undefined);
      root.style.removeProperty('--assistant-mobile-workspace-inset');
      root.classList.remove('assistant-mobile-resizing', 'assistant-mobile-takeover');
      return;
    }
    const place = () => placeCompactPanel();
    place();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    window.addEventListener('resize', place);
    return () => {
      viewport?.removeEventListener('resize', place);
      viewport?.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
      root.style.removeProperty('--assistant-mobile-workspace-inset');
      root.classList.remove('assistant-mobile-resizing', 'assistant-mobile-takeover');
    };
  }, [compact, isRendered, placeCompactPanel]);

  const startMobileResize: React.PointerEventHandler<HTMLElement> = event => {
    if (!compactFrame || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    mobileResizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: compactFrame.height };
    setIsMobileResizing(true);
    document.documentElement.classList.add('assistant-mobile-resizing');
  };

  const moveMobileResize: React.PointerEventHandler<HTMLElement> = event => {
    const gesture = mobileResizeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const requestedHeight = gesture.startHeight + gesture.startY - event.clientY;
    mobileHeightRef.current = requestedHeight;
    placeCompactPanel(requestedHeight);
  };

  const finishMobileResize: React.PointerEventHandler<HTMLElement> = event => {
    if (mobileResizeRef.current?.pointerId !== event.pointerId) return;
    mobileResizeRef.current = null;
    setIsMobileResizing(false);
    document.documentElement.classList.remove('assistant-mobile-resizing');
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    if (!open || !compact) return;
    let popped = false;
    const marker = `assistant-${Date.now()}`;
    window.history.pushState({ ...window.history.state, roboBoyAssistant: marker }, '');
    const onPopState = () => {
      popped = true;
      onClose();
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (!popped && window.history.state?.roboBoyAssistant === marker) window.history.back();
    };
  }, [compact, onClose, open]);

  useEffect(() => {
    nearBottomRef.current = true;
    setShowLatest(false);
  }, [props.activeSessionId]);

  useEffect(() => {
    if (!nearBottomRef.current || !chatRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, progressMessages.length, streamedAnswer, thinking, props.events, error, activeView]);

  const handlePromptChange = (value: string) => {
    onPromptChange(value);
    composerMentions.trackValue(value);
  };

  const handlePromptKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = event => {
    if (event.nativeEvent.isComposing) return;
    if (composerMentions.handleKeyDown(event)) return;
    if (event.key === 'Enter' && !event.shiftKey && canGenerateFrom(prompt, false, attachments)) {
      event.preventDefault();
      onSubmit(delivery);
    }
  };

  const startEditingMessage = (message: AssistantMessage) => {
    setEditingMessageId(message.id);
    setEditingDraft(message.content);
  };
  const submitEditedMessage = (messageIndex: number) => {
    const nextText = editingDraft.trim();
    if (!nextText) return;
    setEditingMessageId(null);
    setEditingDraft('');
    onEditMessage(messageIndex, nextText);
  };

  const floating = useFloatingFrame(!compact);

  if (!isRendered) return null;
  const lastProgress = isGenerating ? progressMessages[progressMessages.length - 1] : '';
  const promptLabel = clarificationSuggestions
    ? 'Your answer'
    : messages.length
      ? 'Continue the conversation'
      : 'Ask the assistant';

  const overlayStyle = compact
    ? compactFrame
      ? { top: compactFrame.top, height: compactFrame.height }
      : undefined
    : floating.frame
      ? {
          left: floating.frame.left,
          top: floating.frame.top,
          width: floating.frame.width,
          height: floating.frame.height,
        }
      : undefined;
  // Limit the growing draft against the actual sheet/frame, including a software-keyboard resize.
  const frameHeight = (compact ? compactFrame?.height : floating.frame?.height) ?? window.innerHeight;
  // Reserve transcript space after the header, inline pickers and action row, including
  // keyboard-shortened sheets. A long draft scrolls internally instead of hiding the task.
  const composerMaxHeight = `${Math.max(34, Math.min(220, frameHeight * 0.2, frameHeight - 300))}px`;
  const panelOverlayStyle: React.CSSProperties & {
    '--assistant-composer-max-height': string;
    '--assistant-options-max-height': string;
  } = {
    ...overlayStyle,
    '--assistant-composer-max-height': composerMaxHeight,
    '--assistant-options-max-height': `${Math.max(80, frameHeight - 200)}px`,
  };

  return (
    <div
      className={`assistant-overlay${compact ? ' is-compact' : ' is-floating'}${compactFrame?.takeover ? ' is-mobile-takeover' : ''}${isMobileResizing ? ' is-mobile-resizing' : ''}${floating.isDragging ? ' is-dragging' : ''}`}
      style={panelOverlayStyle}
    >
      <section
        id="robo-boy-assistant-panel"
        ref={panelRef}
        className={`assistant-panel is-${motionPhase}${compact ? '' : ' tree-panel-resize-frame'}${floating.isDragging ? ' is-resizing' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
        onAnimationEnd={event => {
          if (event.target !== panelRef.current) return;
          if (open && motionPhase === 'entering') setMotionPhase('open');
          else if (!open && motionPhase === 'closing') {
            setIsRendered(false);
            setMotionPhase('closed');
          }
        }}
        // Dropping a file anywhere on the panel attaches it, which is where people aim.
        onDragOver={event => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setIsDropTarget(true);
          }
        }}
        onDragLeave={event => {
          if (!panelRef.current?.contains(event.relatedTarget as Node | null)) setIsDropTarget(false);
        }}
        onDrop={event => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setIsDropTarget(false);
            onAttachFiles(event.dataTransfer.files);
          }
        }}
        data-testid="assistant-panel"
        role={compact ? 'dialog' : 'complementary'}
        aria-modal={compactFrame?.takeover || undefined}
        aria-hidden={open ? undefined : true}
        aria-labelledby="assistant-title"
      >
        <header
          className="assistant-header"
          // Desktop: the header is the drag handle; a double-click puts the panel back on its dock.
          // Mobile: dragging the same surface vertically resizes a docked sheet without adding a
          // second toolbar. Buttons remain normal touch targets; a default takeover can be pulled
          // down into a sheet when the user wants more workspace.
          onPointerDown={
            compact
              ? startMobileResize
              : event => {
                  if (!(event.target as HTMLElement).closest('button')) floating.startGesture(event, 'move');
                }
          }
          onPointerMove={compact ? moveMobileResize : undefined}
          onPointerUp={compact ? finishMobileResize : undefined}
          onPointerCancel={compact ? finishMobileResize : undefined}
          onDoubleClick={
            compact
              ? undefined
              : event => {
                  if (!(event.target as HTMLElement).closest('button')) floating.reset();
                }
          }
          title={compact ? undefined : 'Drag to move · double-click to dock'}
        >
          <div className="assistant-title">
            <span className="assistant-avatar" aria-hidden="true">
              <HiSparkles />
            </span>
            <div className="assistant-title-text">
              <h2 id="assistant-title">Robo-Boy AI</h2>
              {messages.length > 0 && (
                <small title={props.sessions?.find(session => session.id === props.activeSessionId)?.title}>
                  {isGenerating ? 'Working · ' : ''}
                  {props.sessions?.find(session => session.id === props.activeSessionId)?.title ?? 'Current chat'}
                </small>
              )}
            </div>
          </div>
          <div className="assistant-header-actions">
            {!!props.sessions?.length && (
              <button
                type="button"
                className={`assistant-icon-button${showSessions ? ' is-active' : ''}`}
                onClick={() => setActiveView(current => (current === 'sessions' ? 'chat' : 'sessions'))}
                aria-label={showSessions ? 'Back to conversation' : 'Chats'}
                aria-pressed={showSessions}
                title={showSessions ? 'Back to conversation' : 'Chats'}
              >
                {showSessions ? <FaArrowLeft aria-hidden="true" /> : <FaHistory aria-hidden="true" />}
              </button>
            )}
            <button
              type="button"
              className="assistant-icon-button"
              onClick={() => {
                setActiveView('chat');
                onNewConversation();
              }}
              aria-label="New chat"
              title="New chat"
            >
              <FaPlus aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`assistant-icon-button${showSettings ? ' is-active' : ''}`}
              onClick={() => setActiveView(current => (current === 'settings' ? 'chat' : 'settings'))}
              aria-label={showSettings ? 'Back to assistant' : 'Assistant settings'}
              aria-pressed={showSettings}
              title={showSettings ? 'Back to assistant' : 'Assistant settings'}
            >
              <span className="assistant-settings-icon-swap" aria-hidden="true">
                <FaCog className="assistant-settings-icon-gear" />
                <FaArrowLeft className="assistant-settings-icon-back" />
              </span>
            </button>
            <button
              type="button"
              className="assistant-icon-button"
              onClick={onClose}
              aria-label="Close assistant"
              title="Close"
            >
              <FaTimes aria-hidden="true" />
            </button>
          </div>
        </header>

        {!compact &&
          RESIZE_EDGES.map(edge => (
            <div
              key={edge}
              className={`assistant-resize-handle ${edge}${edge.length === 2 ? ' tree-panel-menu-resize-handle' : ''}`}
              role="separator"
              aria-label={`Resize assistant from ${edge}`}
              onPointerDown={event => floating.startGesture(event, edge)}
            />
          ))}

        {showSettings && (
          <AssistantSettingsPopover
            settings={settings}
            resolvedBaseUrl={resolvedBaseUrl}
            onProviderChange={onProviderChange}
            onUpdate={onUpdateSettings}
            apiKeyStorage={apiKeyStorage}
            loadingCredentials={loadingCredentials}
            onApiKeyStorageChange={onApiKeyStorageChange}
            ollamaModels={ollamaModels}
            ollamaModelsError={ollamaModelsError}
            isLoadingOllamaModels={isLoadingOllamaModels}
            onRefreshOllamaModels={onRefreshOllamaModels}
          />
        )}

        {showSessions && (
          <section className="assistant-sessions-view" aria-label="Chats">
            <div className="assistant-settings-popover-header">
              <h3>Chats</h3>
            </div>
            <div className="assistant-sessions-body">
              <label>
                Search chats
                <input
                  type="search"
                  aria-label="Search chats"
                  placeholder="Search by title"
                  value={sessionSearch}
                  onChange={event => setSessionSearch(event.target.value)}
                />
              </label>
              <label className="assistant-checkbox-row">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={event => setShowArchived(event.target.checked)}
                />
                Show archived chats
              </label>
              <ul className="assistant-session-list" aria-label="Saved chats">
                {props.sessions
                  ?.filter(
                    session =>
                      (showArchived || !session.archived) &&
                      session.title.toLowerCase().includes(sessionSearch.trim().toLowerCase())
                  )
                  .map(session => (
                    <li key={session.id} className="assistant-session-row">
                      <button
                        type="button"
                        aria-current={session.id === props.activeSessionId ? 'page' : undefined}
                        aria-pressed={session.id === selectedSession?.id}
                        onClick={() => {
                          setSelectedSessionId(session.id);
                        }}
                      >
                        <span>{session.title}</span>
                        <small>
                          {session.archived
                            ? 'Archived'
                            : session.id === props.activeSessionId
                              ? isGenerating
                                ? 'Working'
                                : 'Current'
                              : 'Chat'}
                        </small>
                      </button>
                      <div className="assistant-session-row-actions">
                        <button
                          type="button"
                          aria-label={`Open chat ${session.title}`}
                          title="Open conversation"
                          onClick={() => {
                            props.onSwitchSession?.(session.id);
                            setActiveView('chat');
                          }}
                        >
                          <FaArrowRight aria-hidden="true" />
                        </button>
                        {props.onRenameSession && (
                          <button
                            type="button"
                            aria-label={`Rename chat ${session.title}`}
                            onClick={() => setSessionAction({ kind: 'rename', id: session.id, title: session.title })}
                          >
                            <FaPencilAlt aria-hidden="true" />
                          </button>
                        )}
                        {props.onDeleteSession && (
                          <button
                            type="button"
                            aria-label={`Delete chat ${session.title}`}
                            onClick={() => setSessionAction({ kind: 'delete', id: session.id, title: session.title })}
                          >
                            <FaTrashAlt aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
              {sessionAction && (
                <div
                  className="assistant-session-confirm"
                  role={sessionAction.kind === 'delete' ? 'alertdialog' : 'dialog'}
                  aria-label={sessionAction.kind === 'delete' ? 'Delete chat permanently' : 'Rename chat'}
                >
                  {sessionAction.kind === 'rename' ? (
                    <label>
                      Chat name
                      <input
                        aria-label="Chat name"
                        autoFocus
                        maxLength={80}
                        value={sessionAction.title}
                        onChange={event => setSessionAction({ ...sessionAction, title: event.target.value })}
                        onKeyDown={event => {
                          if (event.key === 'Enter' && sessionAction.title.trim()) {
                            props.onRenameSession?.(sessionAction.id, sessionAction.title);
                            setSessionAction(undefined);
                          }
                        }}
                      />
                    </label>
                  ) : (
                    <p>
                      Delete “{sessionAction.title}” permanently from this device? Robot documents and provider records
                      are not deleted.
                    </p>
                  )}
                  <div className="assistant-inline-actions">
                    <button type="button" onClick={() => setSessionAction(undefined)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!sessionAction.title.trim()}
                      onClick={() => {
                        if (sessionAction.kind === 'rename')
                          props.onRenameSession?.(sessionAction.id, sessionAction.title);
                        else props.onDeleteSession?.(sessionAction.id);
                        setSessionAction(undefined);
                      }}
                    >
                      {sessionAction.kind === 'rename' ? 'Save name' : 'Delete permanently'}
                    </button>
                  </div>
                </div>
              )}
              {!props.sessions?.some(
                session =>
                  (showArchived || !session.archived) &&
                  session.title.toLowerCase().includes(sessionSearch.trim().toLowerCase())
              ) && <p role="status">No matching chats.</p>}
              <div className="assistant-session-actions">
                <button
                  type="button"
                  disabled={selectedSession?.id !== props.activeSessionId}
                  onClick={() => {
                    props.onForkSession?.();
                    setActiveView('chat');
                  }}
                >
                  Fork chat
                </button>
                <button type="button" onClick={() => selectedSession && props.onArchiveSession?.(selectedSession.id)}>
                  {selectedSession?.archived ? 'Unarchive chat' : 'Archive chat'}
                </button>
                <button
                  type="button"
                  disabled={selectedSession?.id !== props.activeSessionId}
                  onClick={() => {
                    const blob = new Blob(
                      [
                        JSON.stringify(
                          messages.map(({ role, content, createdAt }) => ({ role, content, createdAt })),
                          null,
                          2
                        ),
                      ],
                      { type: 'application/json' }
                    );
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'robo-boy-chat.json';
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export chat
                </button>
              </div>
              <p className="assistant-view-note">Chats belong to this robot connection and stay on this device.</p>
            </div>
          </section>
        )}

        <div
          ref={chatRef}
          className="assistant-chat"
          hidden={activeView !== 'chat'}
          onScroll={event => {
            const element = event.currentTarget;
            nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
            setShowLatest(!nearBottomRef.current);
          }}
        >
          {messages.length === 0 && (
            <div className="assistant-empty">
              <span aria-hidden="true">
                <HiSparkles />
              </span>
              <h3>What would you like to do?</h3>
              <p>
                Inspect robot data, build a Pad or behavior tree, or arrange your workspace. Robot motion stays in your
                hands.
              </p>
              <p className="assistant-empty-hint">
                Type <strong>@</strong> to reference a topic, node, Pad, or tree. Tags are optional.
              </p>
            </div>
          )}
          {messages.map((message, index) => (
            <article key={message.id} className={`assistant-message ${message.role}`}>
              <span className="assistant-message-role">{message.role === 'assistant' ? 'Assistant' : 'You'}</span>
              {message.role === 'assistant' &&
                (message.thinking || (!message.events?.length && message.activity?.length)) && (
                  <AssistantDisclosure
                    className="assistant-thinking"
                    summary={message.thinking ? 'Thinking' : 'Tools used'}
                  >
                    {message.thinking && <AssistantMarkdown content={message.thinking} />}
                    {!message.events?.length && message.activity?.length ? (
                      <ul>
                        {message.activity.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </AssistantDisclosure>
                )}
              {message.role === 'assistant' && !!message.events?.length && (
                <AssistantActivity events={message.events} />
              )}
              {editingMessageId === message.id ? (
                <div className="assistant-message-edit">
                  <span className="assistant-textarea-shell has-highlight">
                    <div className="assistant-textarea-highlight" ref={editingHighlightRef} aria-hidden="true">
                      <MessageText text={editingDraft} tags={tagsForText(editingDraft)} />
                    </div>
                    <textarea
                      ref={editingRef}
                      value={editingDraft}
                      onChange={event => {
                        setEditingDraft(event.target.value);
                        editingMentions.trackValue(event.target.value);
                      }}
                      onScroll={event => {
                        if (editingHighlightRef.current)
                          editingHighlightRef.current.scrollTop = event.currentTarget.scrollTop;
                      }}
                      onKeyDown={event => {
                        if (event.nativeEvent.isComposing) return;
                        if (editingMentions.handleKeyDown(event)) return;
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditingMessageId(null);
                        }
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault();
                          submitEditedMessage(index);
                        }
                      }}
                      aria-label="Edit message"
                      autoFocus
                    />
                  </span>
                  {editingMentions.node}
                  <div className="assistant-inline-actions">
                    <button type="button" className="secondary" onClick={() => setEditingMessageId(null)}>
                      Cancel
                    </button>
                    <button type="button" onClick={() => submitEditedMessage(index)} disabled={!editingDraft.trim()}>
                      Save &amp; resend
                    </button>
                  </div>
                </div>
              ) : message.role === 'assistant' ? (
                <AssistantMarkdown
                  content={message.content}
                  tags={tagsForText(message.content, message.contextTags)}
                  onOpen={openResource}
                  canOpen={canOpenResource}
                />
              ) : (
                <div className="assistant-message-content">
                  <p>
                    <MessageText
                      text={message.content}
                      tags={tagsForText(message.content, message.contextTags)}
                      onOpen={openResource}
                      canOpen={canOpenResource}
                    />
                  </p>
                </div>
              )}
              {message.attachments.length > 0 && (
                <div className="assistant-message-attachments">
                  {message.attachments.map(item =>
                    item.kind === 'image' ? (
                      <button
                        type="button"
                        className="assistant-message-image"
                        key={item.id}
                        onClick={() => setExpandedImage(item)}
                        aria-label={`Expand ${item.name}`}
                      >
                        <img src={dataUrlFor(item)} alt={item.name} />
                      </button>
                    ) : (
                      <span key={item.id}>{item.name}</span>
                    )
                  )}
                </div>
              )}

              {message.response?.kind === 'rosAction' && (
                <div className="assistant-proposal-card">
                  <strong>
                    Review-only {message.response.operation.kind}: {message.response.operation.name}
                  </strong>
                  <p>{message.response.rationale}</p>
                  <pre>{JSON.stringify(message.response.operation, null, 2)}</pre>
                  {message.response.issues.map((issue, issueIndex) => (
                    <p className="assistant-proposal-warning" key={issueIndex}>
                      {issue.message}
                    </p>
                  ))}
                  <small>
                    Robo-Boy does not run robot operations from assistant chat. Add the reviewed operation through a Pad
                    or Behavior Tree.
                  </small>
                </div>
              )}
              {message.response?.kind === 'workspaceEdit' && (
                <div className="assistant-proposal-card" data-testid="assistant-workspace-edit-card">
                  <strong>Workspace changes</strong>
                  <ul className="assistant-result-list">
                    {(message.response.results ?? []).map((result, resultIndex) => (
                      <li key={resultIndex} className={result.ok ? 'is-ok' : 'is-failed'}>
                        {result.message}
                      </li>
                    ))}
                    {message.response.rejected.map((reason, reasonIndex) => (
                      <li key={`rejected-${reasonIndex}`} className="is-failed">
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {message.response?.kind === 'padProposal' && !message.resolution && (
                <div className="assistant-proposal-card" data-testid="assistant-pad-proposal-card">
                  <strong>Proposed Pad: {message.response.layout.name}</strong>
                  <p>{message.response.layout.components.length} components · review every binding before saving.</p>
                  {message.response.issues.map((issue, issueIndex) => (
                    <p className="assistant-proposal-warning" key={issueIndex}>
                      {issue.message}
                    </p>
                  ))}
                  <div className="assistant-inline-actions">
                    <button type="button" onClick={() => onReviewPadProposal(message.id)}>
                      Review in Pad editor
                    </button>
                    {props.onRejectProposal && (
                      <button type="button" className="secondary" onClick={() => props.onRejectProposal?.(message.id)}>
                        Reject Pad proposal
                      </button>
                    )}
                  </div>
                </div>
              )}
              {message.response?.kind === 'padProposal' && message.resolution === 'applied' && (
                <p className="assistant-message-note">Opened in the Pad editor for review.</p>
              )}
              {message.response?.kind === 'behaviorTree' && !hasActiveBehaviorTreeBridge && !message.resolution && (
                <div className="assistant-proposal-card" data-testid="assistant-bt-proposal-card">
                  <strong>Proposed “{message.response.tree.name}”</strong>
                  <p>
                    {message.response.tree.nodes.length} nodes · {message.response.tree.edges.length} connections
                  </p>
                  <div className="assistant-inline-actions">
                    <button type="button" onClick={() => onSaveBehaviorTreeProposal(message.id)}>
                      Save to Behavior Tree library
                    </button>
                    {props.onRejectProposal && (
                      <button type="button" className="secondary" onClick={() => props.onRejectProposal?.(message.id)}>
                        Reject tree proposal
                      </button>
                    )}
                  </div>
                </div>
              )}
              {message.response?.kind === 'behaviorTree' && hasActiveBehaviorTreeBridge && !message.resolution && (
                <p className="assistant-message-note">
                  Previewed on the open Behavior Tree canvas. Accept or reject it there.
                </p>
              )}
              {message.response?.kind === 'behaviorTree' && message.resolution === 'saved' && (
                <p className="assistant-message-note">Saved to the Behavior Tree library.</p>
              )}
              {message.resolution === 'rejected' && (
                <p className="assistant-message-note">Proposal rejected. No authoring changes were saved.</p>
              )}

              {message.contextUsed && message.contextUsed.length > 0 && (
                <AssistantDisclosure
                  className="assistant-context-used"
                  summary={`Context used (${message.contextUsed.length})`}
                >
                  <ul>
                    {message.contextUsed.map((item, itemIndex) => (
                      <li key={`${item.label}-${itemIndex}`}>
                        <span>{item.label}</span>
                        <em>
                          {item.source}
                          {item.ageSeconds ? ` · ${item.ageSeconds}s ago` : ''}
                          {item.stale ? ' · stale' : ''}
                        </em>
                      </li>
                    ))}
                  </ul>
                </AssistantDisclosure>
              )}
              {waitingQuestion?.id === message.id && (
                <p className="assistant-message-note" role="status">
                  Waiting for your answer. Reply below to continue this task.
                </p>
              )}
              {message.role === 'user' && editingMessageId !== message.id && (
                <div className="assistant-message-actions">
                  <button
                    type="button"
                    onClick={() => onRepeat(index)}
                    disabled={isGenerating}
                    aria-label="Repeat"
                    title="Repeat"
                  >
                    <FaRedo aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => startEditingMessage(message)}
                    disabled={isGenerating}
                    aria-label="Edit message"
                    title="Edit and resend"
                  >
                    <FaPencilAlt aria-hidden="true" />
                  </button>
                </div>
              )}
            </article>
          ))}
          {isGenerating && (
            <article className="assistant-message assistant" aria-label="Assistant activity">
              <span className="assistant-message-role">Assistant</span>
              {thinking && (
                <AssistantDisclosure className="assistant-thinking" summary="Thinking…">
                  <AssistantMarkdown content={thinking} />
                </AssistantDisclosure>
              )}
              <AssistantActivity
                events={props.events ?? []}
                live
                modelResponding={Boolean(thinking || streamedAnswer)}
              />
              {streamedAnswer && (
                <AssistantMarkdown
                  content={streamedAnswer}
                  tags={tagsForText(streamedAnswer)}
                  onOpen={openResource}
                  canOpen={canOpenResource}
                />
              )}
            </article>
          )}
          {(error || (lastProgress && !thinking && !props.events?.length)) && (
            <div className={`assistant-status${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>
              {error || lastProgress}
            </div>
          )}
          {clarificationSuggestions && (
            <div className="assistant-suggestions">
              {clarificationSuggestions.map(item => (
                <button type="button" key={item} onClick={() => onSelectSuggestion(item)}>
                  {item}
                </button>
              ))}
            </div>
          )}
          <div className="assistant-task-panels">
            {!!props.monitors?.some(monitor => monitor.status !== 'stopped') && (
              <details className="assistant-pending">
                <summary>Active watches</summary>
                {props.monitors
                  .filter(monitor => monitor.status !== 'stopped')
                  .map(monitor => (
                    <div key={monitor.id}>
                      <span>
                        {monitor.topic} · {monitor.remaining} analyses left
                      </span>
                      <button type="button" onClick={() => props.onStopMonitor?.(monitor.id)}>
                        Stop watch
                      </button>
                    </div>
                  ))}
              </details>
            )}
            {!!props.documentChanges?.length && (
              <details className="assistant-pending">
                <summary>Changes ({props.documentChanges.length})</summary>
                {props.documentChanges.map(change => (
                  <div key={change.id}>
                    <details>
                      <summary>{change.label}</summary>
                      <pre>{change.diff || 'Read the document for this older checkpoint.'}</pre>
                    </details>
                    <button type="button" disabled={isGenerating} onClick={() => props.onUndoDocument?.(change.id)}>
                      Undo
                    </button>
                  </div>
                ))}
              </details>
            )}
            {!!props.pendingInputs?.length && (
              <details className="assistant-pending">
                <summary>Pending messages ({props.pendingInputs.length})</summary>
                {props.pendingInputs.map((item, index) => (
                  <div className="assistant-pending-message" key={item.id}>
                    <input
                      aria-label={`Queued message ${index + 1}`}
                      value={item.text}
                      onChange={event => props.onPendingInputChange?.(item.id, event.target.value)}
                    />
                    <button
                      type="button"
                      disabled={index === 0}
                      aria-label="Move queued message earlier"
                      onClick={() => props.onMovePendingInput?.(item.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === props.pendingInputs!.length - 1}
                      aria-label="Move queued message later"
                      onClick={() => props.onMovePendingInput?.(item.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label="Remove queued message"
                      onClick={() => props.onRemovePendingInput?.(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </details>
            )}
          </div>
        </div>

        {activeView === 'chat' && showLatest && (
          <button
            type="button"
            className="assistant-jump-latest"
            onClick={() => {
              nearBottomRef.current = true;
              setShowLatest(false);
              chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'auto' });
            }}
          >
            ↓ Latest message
          </button>
        )}

        <form
          className="assistant-form"
          hidden={activeView !== 'chat'}
          onSubmit={event => {
            event.preventDefault();
            onSubmit(delivery);
          }}
        >
          {showComposerOptions && (
            <div
              ref={composerOptionsRef}
              className="assistant-composer-options"
              role="dialog"
              aria-label="Composer options"
            >
              <div className="assistant-composer-options-heading">
                <strong>Message options</strong>
                <button
                  type="button"
                  className="assistant-icon-button"
                  onClick={() => {
                    setShowComposerOptions(false);
                    composerOptionsButtonRef.current?.focus();
                  }}
                  aria-label="Close message options"
                >
                  <FaTimes aria-hidden="true" />
                </button>
              </div>
              {isGenerating && (
                <label>
                  Next message
                  <select
                    aria-label="Message delivery"
                    value={delivery}
                    onChange={event => setDelivery(event.target.value as typeof delivery)}
                  >
                    <option value="steer">{waitingQuestion ? 'Answer question' : 'Steer after current tool'}</option>
                    <option value="queue">Queue for next turn</option>
                    <option value="interrupt">Stop task and send</option>
                  </select>
                </label>
              )}
              <p>Pad and Behavior Tree edits are reviewed in their own editors. Robot controls remain manual.</p>
            </div>
          )}
          <div className="assistant-composer-attachments" aria-label="Assistant attachments">
            {attachments.map(item => (
              <span className={`assistant-context-tag attachment ${item.kind}`} key={item.id}>
                {item.kind === 'image' && <img src={dataUrlFor(item)} alt="" aria-hidden="true" />}
                <span>{item.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(item.id)}
                  aria-label={`Remove attachment ${item.name}`}
                >
                  <FaTimes aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>

          {composerMentions.node}
          <div className="assistant-chat-controls">
            <label>
              Mode
              <select
                aria-label="Agent mode"
                disabled={isGenerating}
                value={settings.mode ?? 'edit'}
                onChange={event => onUpdateSettings({ mode: event.target.value as AssistantSettings['mode'] })}
              >
                <option value="edit">Edit</option>
                <option value="goal">Goal</option>
                <option value="plan">Plan</option>
                <option value="ask">Ask</option>
              </select>
            </label>
            {activeView === 'chat' && (
              <AssistantModelControl
                settings={settings}
                ollamaModels={ollamaModels}
                disabled={isGenerating}
                onUpdate={onUpdateSettings}
              />
            )}
            <AssistantThinkingSettings
              provider={settings.provider}
              model={settings.model}
              subscription={settings.authMode === 'subscription'}
              value={settings.thinkingEffort}
              onChange={thinkingEffort => onUpdateSettings({ thinkingEffort })}
              disabled={isGenerating}
              compact
            />
          </div>

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
              placeholder="Message Robo-Boy…"
              toolbar={{
                start: (
                  <>
                    {isGenerating && (
                      <button
                        ref={composerOptionsButtonRef}
                        type="button"
                        className="assistant-composer-options-trigger"
                        onClick={() => setShowComposerOptions(value => !value)}
                        aria-expanded={showComposerOptions}
                        aria-label="Message options"
                        title="How to send the next message"
                      >
                        <span>
                          {waitingQuestion
                            ? 'Answer'
                            : delivery === 'queue'
                              ? 'Queue'
                              : delivery === 'interrupt'
                                ? 'Interrupt'
                                : 'Steer'}
                        </span>
                        <FaChevronDown aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => attachmentInputRef.current?.click()}
                      aria-label="Attach files"
                      title="Attach files"
                    >
                      <FaPaperclip aria-hidden="true" />
                    </button>
                    <button
                      ref={sketchButtonRef}
                      type="button"
                      aria-label="Create sketch attachment"
                      title="Sketch"
                      onClick={() => setShowSketch(true)}
                    >
                      <FaPen aria-hidden="true" />
                    </button>
                    <input
                      ref={attachmentInputRef}
                      className="assistant-attachment-input"
                      type="file"
                      multiple
                      accept="text/*,.md,.json,.yaml,.yml,.xml,.csv,.log,.launch,.urdf,.xacro,.py,.js,.jsx,.ts,.tsx,.css,.html,.sh,.toml,.ini,.cfg,image/png,image/jpeg,image/webp,image/gif"
                      onChange={event => {
                        onAttachFiles(event.target.files);
                        event.currentTarget.value = '';
                      }}
                      aria-label="Assistant attachments"
                    />
                  </>
                ),
                // Left out on a phone with nothing to send, so the microphone takes this slot
                // rather than appearing a second time further down the row.
                end:
                  !compact || isGenerating || canGenerateFrom(prompt, false, attachments) ? (
                    <div className="assistant-composer-primary-actions">
                      {isGenerating && canGenerateFrom(prompt, false, attachments) && (
                        <button
                          type="button"
                          className="assistant-stop-action"
                          onClick={onStop}
                          aria-label="Stop generating"
                          title="Stop generating"
                        >
                          <FaStop aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type={isGenerating && !canGenerateFrom(prompt, false, attachments) ? 'button' : 'submit'}
                        className={`assistant-send${isGenerating && !canGenerateFrom(prompt, false, attachments) ? ' is-stop' : ''}`}
                        onClick={isGenerating && !canGenerateFrom(prompt, false, attachments) ? onStop : undefined}
                        disabled={!isGenerating && !canGenerateFrom(prompt, false, attachments)}
                        aria-label={
                          isGenerating && !canGenerateFrom(prompt, false, attachments) ? 'Stop generating' : 'Send'
                        }
                      >
                        {isGenerating && !canGenerateFrom(prompt, false, attachments) ? (
                          <FaStop aria-hidden="true" />
                        ) : (
                          <FaArrowUp aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  ) : undefined,
              }}
            />
          </div>
          {attachmentError && (
            <span className="assistant-attachment-error" role="alert">
              {attachmentError}
            </span>
          )}
          <small className="assistant-enter-hint">Enter to send · Shift+Enter for a new line</small>
        </form>

        {isDropTarget && (
          <div className="assistant-drop-overlay" aria-hidden="true">
            <FaPaperclip aria-hidden="true" />
            <span>Drop to attach</span>
          </div>
        )}

        {expandedImage &&
          createPortal(
            <div
              className="assistant-lightbox"
              role="dialog"
              aria-label={expandedImage.name}
              onClick={() => setExpandedImage(null)}
            >
              <img src={dataUrlFor(expandedImage)} alt={expandedImage.name} />
              <button type="button" onClick={() => setExpandedImage(null)} aria-label="Close image">
                <FaTimes aria-hidden="true" />
              </button>
            </div>,
            document.body
          )}
        {showSketch && (
          <React.Suspense fallback={<div role="status">Opening sketch editor…</div>}>
            <SketchEditor
              onClose={closeSketch}
              onAttach={dataUrl => {
                const content = dataUrl.slice(dataUrl.indexOf(',') + 1);
                const bytes = Uint8Array.from(atob(content), char => char.charCodeAt(0));
                onAttachFiles([new File([bytes], `sketch-${Date.now()}.png`, { type: 'image/png' })]);
                closeSketch();
              }}
            />
          </React.Suspense>
        )}
      </section>
    </div>
  );
};

export default AssistantPanel;
