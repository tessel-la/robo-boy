import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaCog, FaHistory, FaPaperclip, FaPlus, FaRedo, FaSyncAlt, FaTimes } from 'react-icons/fa';
import type { Ros } from 'roslib';
import {
  discoverAllROSResources,
  fetchActionGoalDetails,
  fetchServiceRequestSchema,
} from '../services/rosDiscovery';
import { BehaviorTree, ROSDiscoveryResult } from '../types';
import { listBehaviorTrees } from '../storage/treeStorage';
import { generateBehaviorTree, transcribeAgentAudio } from '../agent/agentClient';
import {
  getProviderDefaults,
  loadAgentSettings,
  saveAgentSettings,
} from '../agent/agentStorage';
import { parseGeneratedAgentResponse } from '../agent/treeGeneration';
import {
  AgentClarification,
  BehaviorTreeAgentAttachment,
  BehaviorTreeAgentCheckpoint,
  BehaviorTreeAgentContextItem,
  AgentProvider,
  BehaviorTreeAgentSettings,
  BehaviorTreeAgentTreeContext,
  BehaviorTreeResourceSchemas,
} from '../agent/types';
import AgentSpeechTextarea from './AgentSpeechTextarea';
import './BehaviorTreeAgentPanel.css';

interface BehaviorTreeAgentPanelProps {
  open: boolean;
  ros: Ros | null;
  isConnected: boolean;
  currentTree: BehaviorTree | null;
  selectedTreeContext: BehaviorTree | null;
  previewTree: BehaviorTree | null;
  inlinePosition?: { left: number; top: number; width: number } | null;
  onInlineClose?: () => void;
  onClose: () => void;
  onPreviewChange: (tree: BehaviorTree | null) => void;
  captureCheckpoint?: () => BehaviorTreeAgentCheckpoint | null;
  onRestoreCheckpoint?: (checkpoint: BehaviorTreeAgentCheckpoint) => void;
  onNotify?: (notice: { type: 'success' | 'error'; title: string; message: string }) => void;
}

const EMPTY_RESOURCES: ROSDiscoveryResult = { actions: [], services: [], topics: [] };
const EMPTY_SCHEMAS: BehaviorTreeResourceSchemas = { actions: {}, services: {} };
type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  checkpoint: BehaviorTreeAgentCheckpoint | null;
  attachments: BehaviorTreeAgentAttachment[];
};
type AgentResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
interface AgentPanelFrame { left: number; top: number; width: number; height: number }

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_SIZE = 12 * 1024 * 1024;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'yaml', 'yml', 'xml', 'csv', 'log', 'launch', 'urdf', 'xacro',
  'py', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'sh', 'toml', 'ini', 'cfg',
]);
const IMAGE_ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const readFile = (file: File, mode: 'text' | 'data-url'): Promise<string> => {
  if (mode === 'text' && typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result ?? ''));
    if (mode === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
};

const createAgentAttachment = async (file: File): Promise<BehaviorTreeAgentAttachment> => {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isImage = IMAGE_ATTACHMENT_TYPES.has(file.type);
  const isText = file.type.startsWith('text/') || TEXT_ATTACHMENT_EXTENSIONS.has(extension)
    || ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml'].includes(file.type);
  if (!isImage && !isText) {
    throw new Error(`${file.name} is not a supported text, code, configuration, or image file.`);
  }
  if (file.size > MAX_ATTACHMENT_SIZE) throw new Error(`${file.name} is larger than 5 MB.`);
  const rawContent = await readFile(file, isImage ? 'data-url' : 'text');
  return {
    id: `attachment:${file.name}:${file.size}:${file.lastModified}`,
    name: file.name,
    mimeType: file.type || (isImage ? 'image/png' : 'text/plain'),
    size: file.size,
    kind: isImage ? 'image' : 'text',
    content: isImage ? rawContent.slice(rawContent.indexOf(',') + 1) : rawContent,
  };
};

const getAutomaticTreeContext = (
  currentTree: BehaviorTree | null,
  selectedTreeContext: BehaviorTree | null,
  removedContextIds: Set<string>,
  additionalContext: BehaviorTreeAgentContextItem[]
): BehaviorTreeAgentTreeContext | null => {
  const includeOpen = Boolean(currentTree && !removedContextIds.has(`tree:${currentTree.id}`));
  const includeSelection = Boolean(
    selectedTreeContext?.nodes.length && !removedContextIds.has(`selection:${selectedTreeContext.id}`)
  );
  if (!includeOpen && !includeSelection && additionalContext.length === 0) return null;
  return {
    mode: includeOpen && includeSelection
      ? 'open-and-selection'
      : includeSelection
        ? 'selection'
        : includeOpen
          ? 'open'
          : 'additional',
    openTree: includeOpen ? currentTree ?? undefined : undefined,
    selectedTree: includeSelection ? selectedTreeContext ?? undefined : undefined,
    additionalContext,
    note: 'Context was assembled automatically from the open tree, selection, and user-added tags.',
  };
};

const BehaviorTreeAgentPanel: React.FC<BehaviorTreeAgentPanelProps> = ({
  open,
  ros,
  isConnected,
  currentTree,
  selectedTreeContext,
  inlinePosition = null,
  onInlineClose = () => undefined,
  onClose,
  onPreviewChange,
  captureCheckpoint = () => null,
  onRestoreCheckpoint = () => undefined,
  onNotify = () => undefined,
}) => {
  const [settings, setSettings] = useState<BehaviorTreeAgentSettings>(loadAgentSettings);
  const [prompt, setPrompt] = useState('');
  const [inlinePrompt, setInlinePrompt] = useState('');
  const [resources, setResources] = useState<ROSDiscoveryResult>(EMPTY_RESOURCES);
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [clarification, setClarification] = useState<AgentClarification | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [removedContextIds, setRemovedContextIds] = useState<Set<string>>(() => new Set());
  const [additionalContext, setAdditionalContext] = useState<BehaviorTreeAgentContextItem[]>([]);
  const [attachments, setAttachments] = useState<BehaviorTreeAgentAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const [panelFrame, setPanelFrame] = useState<AgentPanelFrame | null>(null);
  const [resizeCorner, setResizeCorner] = useState<AgentResizeCorner | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  const updateSettings = (patch: Partial<BehaviorTreeAgentSettings>) => {
    setError('');
    setSettings(previous => {
      const next = { ...previous, ...patch };
      saveAgentSettings(next);
      return next;
    });
  };

  const handleProviderChange = (provider: AgentProvider) => {
    updateSettings({ provider, apiKey: '', ...getProviderDefaults(provider) });
  };

  const handleResizeStart = (
    corner: AgentResizeCorner,
    event: React.PointerEvent<HTMLDivElement>
  ) => {
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

  const handleNewConversation = () => {
    abortRef.current?.abort();
    setConversation([]);
    setClarification(null);
    setProgress([]);
    setError('');
    setPrompt('');
    setAttachments([]);
    setAttachmentError('');
    onPreviewChange(null);
  };

  const discoverResources = async (): Promise<{
    resources: ROSDiscoveryResult;
    schemas: BehaviorTreeResourceSchemas;
  }> => {
    if (!ros || !isConnected) {
      setResources(EMPTY_RESOURCES);
      return { resources: EMPTY_RESOURCES, schemas: EMPTY_SCHEMAS };
    }
    setIsDiscovering(true);
    try {
      const discovered = await discoverAllROSResources(ros);
      const schemas: BehaviorTreeResourceSchemas = { actions: {}, services: {} };
      for (const actionType of Array.from(new Set(discovered.actions.map(action => action.type).filter(Boolean)))) {
        const details = await fetchActionGoalDetails(ros, actionType);
        if (details) schemas.actions[actionType] = details;
      }
      for (const serviceType of Array.from(new Set(discovered.services.map(service => service.type).filter(Boolean)))) {
        const details = await fetchServiceRequestSchema(ros, serviceType);
        if (details) schemas.services[serviceType] = details;
      }
      setResources(discovered);
      return { resources: discovered, schemas };
    } catch (cause) {
      throw cause instanceof Error ? cause : new Error('ROS resource discovery failed.');
    } finally {
      setIsDiscovering(false);
    }
  };

  const generateFromPrompt = async (
    rawPrompt: string,
    history: ChatMessage[] = conversation,
    checkpoint: BehaviorTreeAgentCheckpoint | null = captureCheckpoint(),
    promptAttachments: BehaviorTreeAgentAttachment[] = attachments
  ) => {
    const userMessage = rawPrompt.trim();
    if (!userMessage || isGenerating) return;
    if (!settings.baseUrl.trim() || !settings.model.trim()) {
      setError('Set both a base URL and model before generating.');
      return;
    }
    if (settings.provider !== 'openai-compatible' && !settings.apiKey.trim()) {
      setError(`Add an API key for ${settings.provider} before generating.`);
      return;
    }
    const previousConversation = history;
    setConversation([...previousConversation, { role: 'user', content: userMessage, checkpoint, attachments: promptAttachments }]);
    setPrompt('');
    setAttachments([]);
    setAttachmentError('');
    setClarification(null);
    const controller = new AbortController();
    abortRef.current = controller;
    onPreviewChange(null);
    setError('');
    setProgress(['Scanning ROS resources…']);
    setIsGenerating(true);

    try {
      const discovered = await discoverResources();
      const discoveredCount = discovered.resources.actions.length + discovered.resources.services.length + discovered.resources.topics.length;
      setProgress(previous => [
        ...previous,
        `Found ${discoveredCount} ROS resource${discoveredCount === 1 ? '' : 's'}.`,
        'Preparing BT schema and context…',
      ]);
      if (!openRef.current) {
        onNotify({
          type: 'success',
          title: 'AI context ready',
          message: `Found ${discoveredCount} ROS resource${discoveredCount === 1 ? '' : 's'}. The agent is working in the background.`,
        });
      }
      const checkpointTree = checkpoint?.activeTree ?? checkpoint?.tree ?? null;
      const treeContext = getAutomaticTreeContext(
        checkpointTree ?? currentTree,
        selectedTreeContext,
        removedContextIds,
        additionalContext
      );
      const includeRosResources = !removedContextIds.has('ros:all');
      const result = await generateBehaviorTree({
        prompt: userMessage,
        conversation: previousConversation.map(({ role, content }) => ({ role, content })),
        settings: { ...settings, includeCurrentTree: Boolean(treeContext) },
        currentTree: treeContext?.openTree ?? treeContext?.selectedTree ?? null,
        treeContext,
        rosResources: includeRosResources ? discovered.resources : EMPTY_RESOURCES,
        resourceSchemas: includeRosResources ? discovered.schemas : EMPTY_SCHEMAS,
        attachments: promptAttachments,
        signal: controller.signal,
        onProgress: message => setProgress(previous => [...previous, message]),
        onToken: () => undefined,
      });
      setProgress(previous => [...previous, 'Checking the response and required inputs…']);
      const response = parseGeneratedAgentResponse(result, discovered.schemas);
      if (response.kind === 'clarification') {
        setClarification(response);
        setConversation(previous => [...previous, { role: 'assistant', content: response.question, checkpoint, attachments: [] }]);
        setProgress(previous => [...previous, 'Waiting for one detail from you.']);
      } else {
        onPreviewChange(response.tree);
        setConversation(previous => [...previous, { role: 'assistant', content: `Built “${response.tree.name}” with complete action inputs.`, checkpoint, attachments: [] }]);
        setProgress(previous => [...previous, `Ready: ${response.tree.nodes.length} nodes, ${response.tree.edges.length} connections.`]);
        if (!openRef.current) {
          onNotify({
            type: 'success',
            title: 'AI tree ready',
            message: `Built ${response.tree.name} using ${discoveredCount} ROS resource${discoveredCount === 1 ? '' : 's'}.`,
          });
        }
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        setProgress(previous => [...previous, 'Generation stopped.']);
      } else {
        const message = cause instanceof Error ? cause.message : 'Tree generation failed.';
        setError(message);
        if (!openRef.current) onNotify({ type: 'error', title: 'AI generation failed', message });
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  };

  const handleGenerate = (event: React.FormEvent) => {
    event.preventDefault();
    void generateFromPrompt(prompt);
  };

  const handleInlineSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const instruction = inlinePrompt.trim();
    if (!instruction) return;
    setPrompt(instruction);
    setInlinePrompt('');
    onInlineClose();
    void generateFromPrompt(instruction, conversation, captureCheckpoint(), []);
  };

  const handleRewind = (messageIndex: number) => {
    const message = conversation[messageIndex];
    abortRef.current?.abort();
    if (message.checkpoint) onRestoreCheckpoint(message.checkpoint);
    setConversation(conversation.slice(0, messageIndex));
    setClarification(null);
    setProgress([]);
    setError('');
    onPreviewChange(null);
  };

  const handleRepeat = (messageIndex: number) => {
    let commandIndex = messageIndex;
    while (commandIndex >= 0 && conversation[commandIndex].role !== 'user') commandIndex -= 1;
    if (commandIndex < 0) return;
    const message = conversation[commandIndex];
    const history = conversation.slice(0, commandIndex);
    if (message.checkpoint) onRestoreCheckpoint(message.checkpoint);
    setConversation(history);
    onPreviewChange(null);
    void generateFromPrompt(message.content, history, message.checkpoint, message.attachments);
  };

  const handleAttachmentFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    if (files.length === 0) return;
    setAttachmentError('');
    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      setAttachmentError(`Attach up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    if (attachments.reduce((total, item) => total + item.size, 0) + files.reduce((total, file) => total + file.size, 0) > MAX_ATTACHMENT_TOTAL_SIZE) {
      setAttachmentError('Attachments can use up to 12 MB per message.');
      return;
    }
    try {
      const next = await Promise.all(files.map(createAgentAttachment));
      setAttachments(previous => [
        ...previous,
        ...next.filter(item => !previous.some(existing => existing.id === item.id)),
      ]);
    } catch (cause) {
      setAttachmentError(cause instanceof Error ? cause.message : 'Could not attach that file.');
    }
  };

  const addContextItem = (item: BehaviorTreeAgentContextItem) => {
    setAdditionalContext(previous => previous.some(candidate => candidate.id === item.id)
      ? previous
      : [...previous, item]);
    setShowContextPicker(false);
  };

  const openContextPicker = () => {
    setShowContextPicker(true);
    if (!isDiscovering) {
      void discoverResources().catch(cause => {
        setError(cause instanceof Error ? cause.message : 'ROS resource discovery failed.');
      });
    }
  };

  const contextTags = useMemo(() => {
    const tags: Array<{ id: string; label: string; automatic: boolean }> = [];
    if (currentTree && !removedContextIds.has(`tree:${currentTree.id}`)) {
      tags.push({ id: `tree:${currentTree.id}`, label: `BT: ${currentTree.name}`, automatic: true });
    }
    if (selectedTreeContext?.nodes.length && !removedContextIds.has(`selection:${selectedTreeContext.id}`)) {
      tags.push({ id: `selection:${selectedTreeContext.id}`, label: `${selectedTreeContext.nodes.length} selected`, automatic: true });
    }
    if (!removedContextIds.has('ros:all')) {
      const count = resources.actions.length + resources.services.length + resources.topics.length;
      tags.push({ id: 'ros:all', label: `ROS${count ? `: ${count}` : ''}`, automatic: true });
    }
    additionalContext.forEach(item => tags.push({ id: item.id, label: item.label, automatic: false }));
    return tags;
  }, [additionalContext, currentTree, removedContextIds, resources, selectedTreeContext]);

  const removeContextTag = (id: string, automatic: boolean) => {
    if (automatic) {
      setRemovedContextIds(previous => new Set(previous).add(id));
    } else {
      setAdditionalContext(previous => previous.filter(item => item.id !== id));
    }
  };

  if (!open) {
    if (!inlinePosition) return null;
    return (
      <form
        className="bt-agent-inline-prompt"
        style={inlinePosition}
        onSubmit={handleInlineSubmit}
        data-testid="bt-agent-inline-prompt"
      >
        <input
          value={inlinePrompt}
          onChange={event => setInlinePrompt(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') onInlineClose();
          }}
          aria-label="Inline AI instruction"
          placeholder="Tell the agent what to change…"
          autoFocus
        />
        <button type="submit" disabled={!inlinePrompt.trim()} aria-label="Send inline AI instruction" title="Send">
          <svg className="bt-agent-inline-ai-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M11.7 3.2l1.25 3.85L16.8 8.3l-3.85 1.25-1.25 3.85-1.25-3.85L6.6 8.3l3.85-1.25L11.7 3.2z" />
            <path d="M18.2 13.2l.75 2.2 2.2.75-2.2.75-.75 2.2-.75-2.2-2.2-.75 2.2-.75.75-2.2z" />
          </svg>
        </button>
      </form>
    );
  }
  const canGenerate = Boolean(prompt.trim()) && !isGenerating;
  const savedContextTrees = showContextPicker ? listBehaviorTrees() : [];
  const promptLabel = clarification ? 'Your answer' : conversation.length > 0 ? 'Continue the conversation' : 'Describe the behavior';

  return (
    <div className="bt-agent-overlay" onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <section
        className={`bt-agent-panel${resizeCorner ? ' is-resizing' : ''}`}
        ref={panelRef}
        style={panelFrame ? { position: 'absolute', ...panelFrame } : undefined}
        data-testid="bt-agent-panel"
        role="dialog"
        aria-labelledby="bt-agent-title"
        onPointerDown={event => {
          event.stopPropagation();
          const target = event.target;
          if (
            showContextPicker &&
            target instanceof Element &&
            !target.closest('.bt-agent-context-picker, .bt-agent-context-add')
          ) {
            setShowContextPicker(false);
          }
          if (
            showSettings &&
            target instanceof Element &&
            !target.closest('.bt-agent-settings-popover, .bt-agent-settings-button')
          ) {
            setShowSettings(false);
          }
        }}
      >
        <div className="bt-agent-sheet-handle" aria-hidden="true" />
        <header className="bt-agent-header">
          <div className="bt-agent-title">
            <span className="bt-agent-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l1.3 4.2 4.2 1.3-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3zM18.5 14l.7 2.2 2.3.8-2.3.7-.7 2.3-.8-2.3-2.2-.7 2.2-.8.8-2.2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
            </span>
            <div>
              <span className="bt-agent-kicker">Robo Boy AI</span>
              <h2 id="bt-agent-title">Build with an agent</h2>
            </div>
          </div>
          <div className="bt-agent-header-actions">
            {conversation.length > 0 && <button type="button" className="bt-agent-new" onClick={handleNewConversation}>New chat</button>}
            <button type="button" className="bt-agent-settings-button" onClick={() => setShowSettings(value => !value)} aria-label="Agent settings" title="Agent settings" aria-expanded={showSettings}>
              <FaCog aria-hidden="true" />
            </button>
            <button type="button" className="bt-agent-close" onClick={onClose} aria-label="Close AI agent" title="Close">
              <FaTimes aria-hidden="true" />
            </button>
          </div>
        </header>

        {showSettings && (
          <div className="bt-agent-settings-popover" role="dialog" aria-label="Agent settings">
            <div className="bt-agent-settings-popover-header">
              <strong>Agent settings</strong>
              <button type="button" onClick={() => setShowSettings(false)} aria-label="Close agent settings"><FaTimes aria-hidden="true" /></button>
            </div>
            <div className="bt-agent-settings">
            <label>Provider
              <select value={settings.provider} onChange={event => handleProviderChange(event.target.value as AgentProvider)}>
                <option value="openai">OpenAI</option>
                <option value="gemini">Google Gemini</option>
                <option value="openai-compatible">OpenAI-compatible / local</option>
              </select>
            </label>
            <label>Model<input value={settings.model} onChange={event => updateSettings({ model: event.target.value })} /></label>
            <label>Base URL<input value={settings.baseUrl} onChange={event => updateSettings({ baseUrl: event.target.value })} /></label>
            <label>API key<input type="password" autoComplete="off" value={settings.apiKey} onChange={event => updateSettings({ apiKey: event.target.value })} placeholder={settings.provider === 'openai-compatible' ? 'Optional for local models' : 'Required'} /></label>
            <AgentSpeechTextarea
              id="bt-agent-system-context"
              className="bt-agent-wide"
              label="Agent instructions"
              rows={2}
              value={settings.systemContext}
              onChange={systemContext => updateSettings({ systemContext })}
              onTranscribeAudio={audio => transcribeAgentAudio(audio, settings)}
              placeholder="Safety constraints, preferred BT conventions…"
            />
            <AgentSpeechTextarea
              id="bt-agent-robot-context"
              className="bt-agent-wide"
              label="Robot / mission context"
              rows={3}
              value={settings.robotContext}
              onChange={robotContext => updateSettings({ robotContext })}
              onTranscribeAudio={audio => transcribeAgentAudio(audio, settings)}
              placeholder="Robot capabilities, frames, operational rules…"
            />
            <p className="bt-agent-key-note">Settings stay in this browser. For shared deployments, use a server-side proxy instead of storing production keys here.</p>
            </div>
          </div>
        )}

        <div className="bt-agent-body">
            <div className="bt-agent-chat" aria-live="polite">
            {conversation.map((message, index) => (
              <div key={`${index}-${message.role}`} className={`bt-agent-message ${message.role}`}>
                <span>{message.role === 'assistant' ? 'Agent' : 'You'}</span>
                <p>{message.content}</p>
                {message.attachments.length > 0 && <div className="bt-agent-message-attachments">{message.attachments.map(attachment => <span key={attachment.id}>{attachment.name}</span>)}</div>}
                <div className="bt-agent-message-actions">
                  <button type="button" onClick={() => handleRepeat(index)} disabled={isGenerating}><FaRedo aria-hidden="true" />Repeat</button>
                  <button type="button" onClick={() => handleRewind(index)} disabled={isGenerating}><FaHistory aria-hidden="true" />Go back here</button>
                </div>
              </div>
            ))}
            {(progress.length > 0 || error) && (
              <div className="bt-agent-message assistant status">
                <span>Agent</span>
                <p role={error ? 'alert' : 'status'}>{error || progress[progress.length - 1]}</p>
              </div>
            )}
            {clarification?.suggestions && clarification.suggestions.length > 0 && (
              <div className="bt-agent-suggestions">
                {clarification.suggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => setPrompt(suggestion)}>{suggestion}</button>)}
              </div>
            )}
            </div>
        </div>

        <form className="bt-agent-form" onSubmit={handleGenerate}>
          <div className="bt-agent-composer">
            {isDiscovering && <div className="bt-agent-composer-heading"><span role="status"><FaSyncAlt className="spinning" aria-hidden="true" />Scanning ROS…</span></div>}
            <div className="bt-agent-composer-context-line">
              <div className="bt-agent-context-tags" aria-label="Agent context">
                {contextTags.map(tag => (
                  <span className="bt-agent-context-tag" key={tag.id} title={tag.label}>
                    <span>{tag.label}</span>
                    <button type="button" onClick={() => removeContextTag(tag.id, tag.automatic)} aria-label={`Remove ${tag.label} from context`}><FaTimes aria-hidden="true" /></button>
                  </span>
                ))}
                {attachments.map(attachment => (
                  <span className="bt-agent-context-tag attachment" key={attachment.id} title={attachment.name}>
                    <span>{attachment.name}</span>
                    <button type="button" onClick={() => setAttachments(previous => previous.filter(item => item.id !== attachment.id))} aria-label={`Remove attachment ${attachment.name}`}><FaTimes aria-hidden="true" /></button>
                  </span>
                ))}
              </div>
              <div className="bt-agent-composer-tools">
                <button type="button" className="bt-agent-composer-icon" onClick={openContextPicker} aria-label="Add agent context" title="Add context"><FaPlus aria-hidden="true" /></button>
                <button type="button" className="bt-agent-composer-icon" onClick={() => attachmentInputRef.current?.click()} aria-label="Attach files" title="Attach files"><FaPaperclip aria-hidden="true" /></button>
                <input
                  ref={attachmentInputRef}
                  className="bt-agent-attachment-input"
                  type="file"
                  multiple
                  accept="text/*,.md,.json,.yaml,.yml,.xml,.csv,.log,.launch,.urdf,.xacro,.py,.js,.jsx,.ts,.tsx,.css,.html,.sh,.toml,.ini,.cfg,image/png,image/jpeg,image/webp,image/gif"
                  onChange={event => void handleAttachmentFiles(event.target.files)}
                  aria-label="AI agent attachments"
                />
              </div>
            </div>
            {showContextPicker && (
              <div className="bt-agent-context-picker" role="dialog" aria-label="Add context" aria-busy={isDiscovering}>
                <div className="bt-agent-context-picker-header">
                  <strong>Add context</strong>
                  <span>{isDiscovering && <FaSyncAlt className="spinning" aria-label="Scanning ROS resources" />}</span>
                  <button type="button" onClick={() => setShowContextPicker(false)} aria-label="Close context picker"><FaTimes aria-hidden="true" /></button>
                </div>
                {currentTree?.nodes.map(node => (
                  <button type="button" key={`node:${currentTree.id}:${node.id}`} onClick={() => addContextItem({ id: `node:${currentTree.id}:${node.id}`, kind: 'node', label: `Node: ${node.data.label}`, value: node })}>{node.data.label}<span>Current BT node</span></button>
                ))}
                {savedContextTrees.map(saved => (
                  <button type="button" key={`saved:${saved.tree.id}`} onClick={() => addContextItem({ id: `saved:${saved.tree.id}`, kind: 'tree', label: `BT: ${saved.tree.name}`, value: saved.tree })}>{saved.tree.name}<span>Saved behavior tree</span></button>
                ))}
                {[...resources.actions, ...resources.services, ...resources.topics].map(resource => (
                  <button type="button" key={`ros:${resource.name}:${resource.type}`} onClick={() => addContextItem({ id: `ros:${resource.name}:${resource.type}`, kind: 'ros', label: `ROS: ${resource.name}`, value: resource })}>{resource.name}<span>{resource.type}</span></button>
                ))}
              </div>
            )}
            <AgentSpeechTextarea
              id="bt-agent-prompt"
              className="bt-agent-composer-speech"
              label={promptLabel}
              value={prompt}
              onChange={setPrompt}
              onTranscribeAudio={audio => transcribeAgentAudio(audio, settings)}
              rows={clarification ? 3 : 4}
              textareaRef={promptRef}
              placeholder={clarification ? 'For example: relative x 0.5 m, y -0.2 m, keep current yaw.' : 'Example: Move 0.5 m forward and 0.2 m left, then capture an image. Retry movement twice.'}
            />
            {attachmentError && <span className="bt-agent-attachment-error" role="alert">{attachmentError}</span>}
            <div className="bt-agent-form-actions">
              {isGenerating && <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>Stop</button>}
              <button type="submit" disabled={!canGenerate}>{isGenerating ? 'Thinking…' : clarification ? 'Send answer' : 'Generate tree'}</button>
            </div>
          </div>
        </form>
        {(['nw', 'ne', 'sw', 'se'] as AgentResizeCorner[]).map(corner => (
          <div
            key={corner}
            className={`bt-agent-resize-handle ${corner}`}
            onPointerDown={event => handleResizeStart(corner, event)}
            role="separator"
            aria-label={`Resize AI agent from ${corner} corner`}
          />
        ))}
      </section>
    </div>
  );
};

export default BehaviorTreeAgentPanel;
