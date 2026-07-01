import React, { useEffect, useRef, useState } from 'react';
import { FaSyncAlt, FaTimes } from 'react-icons/fa';
import type { Ros } from 'roslib';
import {
  discoverAllROSResources,
  fetchActionGoalDetails,
  fetchServiceRequestSchema,
} from '../services/rosDiscovery';
import { BehaviorTree, ROSDiscoveryResult } from '../types';
import { generateBehaviorTree, transcribeAgentAudio } from '../agent/agentClient';
import {
  getProviderDefaults,
  loadAgentSettings,
  saveAgentSettings,
} from '../agent/agentStorage';
import { parseGeneratedAgentResponse } from '../agent/treeGeneration';
import {
  AgentClarification,
  AgentProvider,
  BehaviorTreeAgentSettings,
  BehaviorTreeAgentTreeContext,
  BehaviorTreeResourceSchemas,
} from '../agent/types';
import BehaviorTreeAgentPreview from './BehaviorTreeAgentPreview';
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
  onOpen?: () => void;
  onInlineClose?: () => void;
  onClose: () => void;
  onPreviewChange: (tree: BehaviorTree | null) => void;
}

const EMPTY_RESOURCES: ROSDiscoveryResult = { actions: [], services: [], topics: [] };
const EMPTY_SCHEMAS: BehaviorTreeResourceSchemas = { actions: {}, services: {} };
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type TreeContextMode = 'open' | 'selection' | 'open-and-selection' | 'none';
type AgentResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
interface AgentPanelFrame { left: number; top: number; width: number; height: number }

const getInitialTreeContextMode = (
  currentTree: BehaviorTree | null,
  selectedTreeContext: BehaviorTree | null
): TreeContextMode => {
  if (currentTree && selectedTreeContext?.nodes.length) return 'open-and-selection';
  if (currentTree) return 'open';
  if (selectedTreeContext?.nodes.length) return 'selection';
  return 'none';
};

const getTreeContext = (
  mode: TreeContextMode,
  currentTree: BehaviorTree | null,
  selectedTreeContext: BehaviorTree | null
): BehaviorTreeAgentTreeContext | null => {
  if (mode === 'open' && currentTree) {
    return {
      mode: 'open',
      openTree: currentTree,
      note: 'Use the whole currently open behavior tree as context.',
    };
  }
  if (mode === 'selection' && selectedTreeContext?.nodes.length) {
    return {
      mode: 'selection',
      selectedTree: selectedTreeContext,
      note: 'Use only the selected behavior-tree nodes and their internal edges as focus context.',
    };
  }
  if (mode === 'open-and-selection' && currentTree && selectedTreeContext?.nodes.length) {
    return {
      mode: 'open-and-selection',
      openTree: currentTree,
      selectedTree: selectedTreeContext,
      note: 'Use the full open tree for global structure and the selected tree fragment as the edit focus.',
    };
  }
  return null;
};

const BehaviorTreeAgentPanel: React.FC<BehaviorTreeAgentPanelProps> = ({
  open,
  ros,
  isConnected,
  currentTree,
  selectedTreeContext,
  previewTree,
  inlinePosition = null,
  onOpen = () => undefined,
  onInlineClose = () => undefined,
  onClose,
  onPreviewChange,
}) => {
  const [settings, setSettings] = useState<BehaviorTreeAgentSettings>(loadAgentSettings);
  const [prompt, setPrompt] = useState('');
  const [inlinePrompt, setInlinePrompt] = useState('');
  const [resources, setResources] = useState<ROSDiscoveryResult>(EMPTY_RESOURCES);
  const [resourceSchemas, setResourceSchemas] = useState<BehaviorTreeResourceSchemas>(EMPTY_SCHEMAS);
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [clarification, setClarification] = useState<AgentClarification | null>(null);
  const [rawOutput, setRawOutput] = useState('');
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [treeContextMode, setTreeContextMode] = useState<TreeContextMode>('open');
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef('');
  const wasOpenRef = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [panelFrame, setPanelFrame] = useState<AgentPanelFrame | null>(null);
  const [resizeCorner, setResizeCorner] = useState<AgentResizeCorner | null>(null);

  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (!wasOpenRef.current) {
      setTreeContextMode(getInitialTreeContextMode(currentTree, selectedTreeContext));
      wasOpenRef.current = true;
      return;
    }
    setTreeContextMode(previous => {
      if (previous === 'none') return previous;
      if (previous === 'open' && !currentTree) return selectedTreeContext?.nodes.length ? 'selection' : 'none';
      if (previous === 'selection' && !selectedTreeContext?.nodes.length) return currentTree ? 'open' : 'none';
      if (previous === 'open-and-selection' && (!currentTree || !selectedTreeContext?.nodes.length)) {
        if (currentTree) return 'open';
        if (selectedTreeContext?.nodes.length) return 'selection';
        return 'none';
      }
      return previous;
    });
  }, [currentTree, open, selectedTreeContext]);

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
    setRawOutput('');
    setProgress([]);
    setError('');
    setPrompt('');
    onPreviewChange(null);
  };

  const handleDiscover = async () => {
    if (!ros || !isConnected) return;
    setIsDiscovering(true);
    setError('');
    try {
      const discovered = await discoverAllROSResources(ros);
      setResources(discovered);
      const schemas: BehaviorTreeResourceSchemas = { actions: {}, services: {} };
      for (const actionType of Array.from(new Set(discovered.actions.map(action => action.type).filter(Boolean)))) {
        const details = await fetchActionGoalDetails(ros, actionType);
        if (details) schemas.actions[actionType] = details;
      }
      for (const serviceType of Array.from(new Set(discovered.services.map(service => service.type).filter(Boolean)))) {
        const details = await fetchServiceRequestSchema(ros, serviceType);
        if (details) schemas.services[serviceType] = details;
      }
      setResourceSchemas(schemas);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ROS resource discovery failed.');
    } finally {
      setIsDiscovering(false);
    }
  };

  const generateFromPrompt = async (rawPrompt: string) => {
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
    const actionableResourceCount = resources.actions.length + resources.services.length;
    if (actionableResourceCount === 0) {
      setError('Scan ROS first. At least one action or service must be available before generation.');
      return;
    }
    const previousConversation = conversation;
    setConversation(previous => [...previous, { role: 'user', content: userMessage }]);
    setPrompt('');
    setClarification(null);
    const controller = new AbortController();
    abortRef.current = controller;
    outputRef.current = '';
    setRawOutput('');
    onPreviewChange(null);
    setError('');
    setProgress(['Preparing BT schema and context…']);
    setIsGenerating(true);

    try {
      const treeContext = getTreeContext(treeContextMode, currentTree, selectedTreeContext);
      const result = await generateBehaviorTree({
        prompt: userMessage,
        conversation: previousConversation,
        settings: { ...settings, includeCurrentTree: Boolean(treeContext) },
        currentTree: treeContext?.openTree ?? treeContext?.selectedTree ?? null,
        treeContext,
        rosResources: resources,
        resourceSchemas,
        signal: controller.signal,
        onProgress: message => setProgress(previous => [...previous, message]),
        onToken: token => {
          outputRef.current += token;
          setRawOutput(outputRef.current);
        },
      });
      setProgress(previous => [...previous, 'Checking the response and required inputs…']);
      const response = parseGeneratedAgentResponse(result, resourceSchemas);
      if (response.kind === 'clarification') {
        setClarification(response);
        setConversation(previous => [...previous, { role: 'assistant', content: response.question }]);
        setProgress(previous => [...previous, 'Waiting for one detail from you.']);
      } else {
        onPreviewChange(response.tree);
        setConversation(previous => [...previous, { role: 'assistant', content: `Built “${response.tree.name}” with complete action inputs.` }]);
        setProgress(previous => [...previous, `Ready: ${response.tree.nodes.length} nodes, ${response.tree.edges.length} connections.`]);
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        setProgress(previous => [...previous, 'Generation stopped.']);
      } else {
        setError(cause instanceof Error ? cause.message : 'Tree generation failed.');
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
    onOpen();
    void generateFromPrompt(instruction);
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
  const resourceCount = resources.actions.length + resources.services.length + resources.topics.length;
  const actionableResourceCount = resources.actions.length + resources.services.length;
  const schemaCount = Object.keys(resourceSchemas.actions).length + Object.keys(resourceSchemas.services).length;
  const canGenerate = Boolean(prompt.trim()) && !isGenerating && actionableResourceCount > 0;

  return (
    <div className="bt-agent-overlay" onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <section
        className={`bt-agent-panel${resizeCorner ? ' is-resizing' : ''}`}
        ref={panelRef}
        style={panelFrame ? { position: 'absolute', ...panelFrame } : undefined}
        data-testid="bt-agent-panel"
        role="dialog"
        aria-labelledby="bt-agent-title"
        onPointerDown={event => event.stopPropagation()}
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
            <button type="button" className="bt-agent-close" onClick={onClose} aria-label="Close AI agent" title="Close">
              <FaTimes aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="bt-agent-body">
          <button type="button" className="bt-agent-settings-toggle" onClick={() => setShowSettings(value => !value)} aria-expanded={showSettings}>
            <span>{settings.provider} · {settings.model}</span><span>{showSettings ? 'Hide settings' : 'Provider settings'}</span>
          </button>

          {showSettings && (
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
            <p className="bt-agent-key-note">Settings stay in this browser. For shared deployments, use a server-side proxy instead of storing production keys here.</p>
            </div>
          )}

          <div className="bt-agent-context-row">
            <button type="button" onClick={handleDiscover} disabled={!isConnected || isDiscovering}>
              <FaSyncAlt className={isDiscovering ? 'spinning' : ''} aria-hidden="true" />
              <span>{isDiscovering ? 'Scanning ROS…' : 'Scan ROS resources'}</span>
            </button>
            <span>{resourceCount > 0 ? `${resourceCount} resources · ${schemaCount} input schemas` : isConnected ? 'No ROS resources scanned' : 'Connect ROS to scan resources'}</span>
          </div>

          <div className="bt-agent-context-textareas">
            <AgentSpeechTextarea
              id="bt-agent-system-context"
              label="Agent instructions"
              rows={2}
              value={settings.systemContext}
              onChange={systemContext => updateSettings({ systemContext })}
              onTranscribeAudio={audio => transcribeAgentAudio(audio, settings)}
              placeholder="Safety constraints, preferred BT conventions…"
            />
            <AgentSpeechTextarea
              id="bt-agent-robot-context"
              label="Robot / mission context"
              rows={3}
              value={settings.robotContext}
              onChange={robotContext => updateSettings({ robotContext })}
              onTranscribeAudio={audio => transcribeAgentAudio(audio, settings)}
              placeholder="Robot capabilities, frames, operational rules…"
            />
          </div>

          <div className="bt-agent-tree-context">
          <div className="bt-agent-context-heading">
            <strong>Tree context</strong>
            <span>Choose what the agent can see</span>
          </div>
          <div className="bt-agent-context-options" role="group" aria-label="Behavior tree context">
            <button type="button" className={treeContextMode === 'open' ? 'active' : ''} onClick={() => setTreeContextMode('open')} disabled={!currentTree} aria-pressed={treeContextMode === 'open'}>
              Full BT <span>{currentTree?.nodes.length ?? 0}</span>
            </button>
            <button type="button" className={treeContextMode === 'selection' ? 'active' : ''} onClick={() => setTreeContextMode('selection')} disabled={!selectedTreeContext?.nodes.length} aria-pressed={treeContextMode === 'selection'}>
              Selection <span>{selectedTreeContext?.nodes.length ?? 0}</span>
            </button>
            <button type="button" className={treeContextMode === 'open-and-selection' ? 'active' : ''} onClick={() => setTreeContextMode('open-and-selection')} disabled={!currentTree || !selectedTreeContext?.nodes.length} aria-pressed={treeContextMode === 'open-and-selection'}>
              Full + selection <span>{selectedTreeContext?.nodes.length ?? 0}</span>
            </button>
            <button type="button" className={treeContextMode === 'none' ? 'active' : ''} onClick={() => setTreeContextMode('none')} aria-pressed={treeContextMode === 'none'}>No BT</button>
          </div>
          {treeContextMode === 'open' && currentTree && <p>Using the full open tree with {currentTree.nodes.length} node{currentTree.nodes.length === 1 ? '' : 's'} as context.</p>}
          {treeContextMode === 'selection' && selectedTreeContext && <p>Using only the {selectedTreeContext.nodes.length} selected node{selectedTreeContext.nodes.length === 1 ? ' and its' : 's and their'} internal connections.</p>}
          {treeContextMode === 'open-and-selection' && currentTree && selectedTreeContext && <p>Using the full {currentTree.nodes.length}-node tree, with {selectedTreeContext.nodes.length} selected node{selectedTreeContext.nodes.length === 1 ? '' : 's'} called out as the edit focus.</p>}
          {treeContextMode === 'none' && <p>No behavior-tree structure will be sent. The agent will use only your text, robot context, and scanned ROS resources.</p>}
          </div>

          {conversation.length > 0 && (
            <div className="bt-agent-chat" aria-live="polite">
            {conversation.map((message, index) => (
              <div key={`${index}-${message.role}`} className={`bt-agent-message ${message.role}`}>
                <span>{message.role === 'assistant' ? 'Agent' : 'You'}</span>
                <p>{message.content}</p>
              </div>
            ))}
            </div>
          )}

          {clarification?.suggestions && clarification.suggestions.length > 0 && (
            <div className="bt-agent-suggestions">
            {clarification.suggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => setPrompt(suggestion)}>{suggestion}</button>)}
            </div>
          )}

          {(progress.length > 0 || error) && (
            <div className="bt-agent-process" aria-live="polite">
              <strong>Process</strong>
              {progress.map((message, index) => <div key={`${index}-${message}`} className={index === progress.length - 1 && isGenerating ? 'active' : ''}><span />{message}</div>)}
              {error && <p role="alert">{error}</p>}
            </div>
          )}

          {isGenerating && rawOutput && <pre className="bt-agent-stream" aria-label="Live model output">{rawOutput.slice(-1800)}</pre>}

          {previewTree && <BehaviorTreeAgentPreview
            tree={previewTree}
            baseline={currentTree}
            onReject={() => onPreviewChange(null)}
            onAccept={() => undefined}
            compact
            showActions={false}
          />}
        </div>

        <form className="bt-agent-form" onSubmit={handleGenerate}>
          <AgentSpeechTextarea
            id="bt-agent-prompt"
            label={clarification ? 'Your answer' : conversation.length > 0 ? 'Continue the conversation' : 'Describe the behavior'}
            value={prompt}
            onChange={setPrompt}
            onTranscribeAudio={audio => transcribeAgentAudio(audio, settings)}
            rows={clarification ? 3 : 5}
            textareaRef={promptRef}
            placeholder={clarification ? 'For example: relative x 0.5 m, y -0.2 m, keep current yaw.' : 'Example: Move 0.5 m forward and 0.2 m left, then capture an image. Retry movement twice.'}
          />
          <div className="bt-agent-form-actions">
            {actionableResourceCount === 0 && <span className="bt-agent-gate">Scan at least one action or service to continue.</span>}
            {isGenerating && <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>Stop</button>}
            <button type="submit" disabled={!canGenerate}>{isGenerating ? 'Thinking…' : clarification ? 'Send answer' : 'Generate tree'}</button>
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
