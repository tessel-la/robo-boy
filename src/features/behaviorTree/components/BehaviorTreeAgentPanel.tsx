import React, { useEffect, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import {
  discoverAllROSResources,
  fetchActionGoalDetails,
  fetchServiceRequestSchema,
} from '../services/rosDiscovery';
import { BehaviorTree, ROSDiscoveryResult } from '../types';
import { generateBehaviorTree } from '../agent/agentClient';
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
  BehaviorTreeResourceSchemas,
} from '../agent/types';
import BehaviorTreeAgentPreview from './BehaviorTreeAgentPreview';
import './BehaviorTreeAgentPanel.css';

interface BehaviorTreeAgentPanelProps {
  open: boolean;
  ros: Ros | null;
  isConnected: boolean;
  currentTree: BehaviorTree | null;
  selectedTreeContext: BehaviorTree | null;
  onClose: () => void;
  onApply: (tree: BehaviorTree, mode: 'replace' | 'subtree') => void;
}

const EMPTY_RESOURCES: ROSDiscoveryResult = { actions: [], services: [], topics: [] };
const EMPTY_SCHEMAS: BehaviorTreeResourceSchemas = { actions: {}, services: {} };
type ChatMessage = { role: 'user' | 'assistant'; content: string };

const BehaviorTreeAgentPanel: React.FC<BehaviorTreeAgentPanelProps> = ({
  open,
  ros,
  isConnected,
  currentTree,
  selectedTreeContext,
  onClose,
  onApply,
}) => {
  const [settings, setSettings] = useState<BehaviorTreeAgentSettings>(loadAgentSettings);
  const [prompt, setPrompt] = useState('');
  const [resources, setResources] = useState<ROSDiscoveryResult>(EMPTY_RESOURCES);
  const [resourceSchemas, setResourceSchemas] = useState<BehaviorTreeResourceSchemas>(EMPTY_SCHEMAS);
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [clarification, setClarification] = useState<AgentClarification | null>(null);
  const [generatedTree, setGeneratedTree] = useState<BehaviorTree | null>(null);
  const [rawOutput, setRawOutput] = useState('');
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [treeContextMode, setTreeContextMode] = useState<'open' | 'selection' | 'none'>('open');
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef('');

  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTreeContextMode(selectedTreeContext?.nodes.length ? 'selection' : currentTree ? 'open' : 'none');
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

  const handleNewConversation = () => {
    abortRef.current?.abort();
    setConversation([]);
    setClarification(null);
    setGeneratedTree(null);
    setRawOutput('');
    setProgress([]);
    setError('');
    setPrompt('');
  };

  const handleRejectProposal = () => {
    setGeneratedTree(null);
    setRawOutput('');
    setProgress(previous => [...previous, 'Proposal rejected. Ready for your revision.']);
    setConversation(previous => [
      ...previous,
      { role: 'assistant', content: 'Changes rejected. Tell me what to adjust and I’ll create a new proposal.' },
    ]);
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

  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || isGenerating) return;
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
    const userMessage = prompt.trim();
    const previousConversation = conversation;
    setConversation(previous => [...previous, { role: 'user', content: userMessage }]);
    setPrompt('');
    setClarification(null);
    const controller = new AbortController();
    abortRef.current = controller;
    outputRef.current = '';
    setRawOutput('');
    setGeneratedTree(null);
    setError('');
    setProgress(['Preparing BT schema and context…']);
    setIsGenerating(true);

    try {
      const result = await generateBehaviorTree({
        prompt: userMessage,
        conversation: previousConversation,
        settings: { ...settings, includeCurrentTree: treeContextMode !== 'none' },
        currentTree: treeContextMode === 'selection' ? selectedTreeContext : treeContextMode === 'open' ? currentTree : null,
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
        setGeneratedTree(response.tree);
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

  if (!open) return null;
  const resourceCount = resources.actions.length + resources.services.length + resources.topics.length;
  const actionableResourceCount = resources.actions.length + resources.services.length;
  const schemaCount = Object.keys(resourceSchemas.actions).length + Object.keys(resourceSchemas.services).length;
  const canGenerate = Boolean(prompt.trim()) && !isGenerating && actionableResourceCount > 0;

  return (
    <div className="bt-agent-overlay" onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <section className="bt-agent-panel" data-testid="bt-agent-panel" role="dialog" aria-modal="true" aria-labelledby="bt-agent-title" onPointerDown={event => event.stopPropagation()}>
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
            <button type="button" className="bt-agent-close" onClick={onClose} aria-label="Close AI agent">×</button>
          </div>
        </header>

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
            <label className="bt-agent-wide">Agent instructions<textarea rows={2} value={settings.systemContext} onChange={event => updateSettings({ systemContext: event.target.value })} placeholder="Safety constraints, preferred BT conventions…" /></label>
            <label className="bt-agent-wide">Robot / mission context<textarea rows={3} value={settings.robotContext} onChange={event => updateSettings({ robotContext: event.target.value })} placeholder="Robot capabilities, frames, operational rules…" /></label>
          </div>
        )}

        <div className="bt-agent-context-row">
          <button type="button" onClick={handleDiscover} disabled={!isConnected || isDiscovering}>{isDiscovering ? 'Reading action inputs…' : 'Scan ROS actions'}</button>
          <span>{resourceCount > 0 ? `${resourceCount} resources · ${schemaCount} input schemas` : isConnected ? 'No ROS resources scanned' : 'Connect ROS to scan resources'}</span>
        </div>

        <div className="bt-agent-tree-context">
          <div className="bt-agent-context-heading">
            <strong>Tree context</strong>
            <span>Choose what the agent can see</span>
          </div>
          <div className="bt-agent-context-options" role="group" aria-label="Behavior tree context">
            <button type="button" className={treeContextMode === 'open' ? 'active' : ''} onClick={() => setTreeContextMode('open')} disabled={!currentTree} aria-pressed={treeContextMode === 'open'}>
              Open tree <span>{currentTree?.nodes.length ?? 0}</span>
            </button>
            <button type="button" className={treeContextMode === 'selection' ? 'active' : ''} onClick={() => setTreeContextMode('selection')} disabled={!selectedTreeContext?.nodes.length} aria-pressed={treeContextMode === 'selection'}>
              Selected part <span>{selectedTreeContext?.nodes.length ?? 0}</span>
            </button>
            <button type="button" className={treeContextMode === 'none' ? 'active' : ''} onClick={() => setTreeContextMode('none')} aria-pressed={treeContextMode === 'none'}>None</button>
          </div>
          {treeContextMode === 'selection' && selectedTreeContext && <p>Using only the {selectedTreeContext.nodes.length} selected node{selectedTreeContext.nodes.length === 1 ? ' and its' : 's and their'} internal connections.</p>}
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

        <form className="bt-agent-form" onSubmit={handleGenerate}>
          <label htmlFor="bt-agent-prompt">{clarification ? 'Your answer' : conversation.length > 0 ? 'Continue the conversation' : 'Describe the behavior'}</label>
          <textarea id="bt-agent-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} rows={clarification ? 3 : 5} autoFocus placeholder={clarification ? 'For example: relative x 0.5 m, y -0.2 m, keep current yaw.' : 'Example: Move 0.5 m forward and 0.2 m left, then capture an image. Retry movement twice.'} />
          <div className="bt-agent-form-actions">
            {actionableResourceCount === 0 && <span className="bt-agent-gate">Scan at least one action or service to continue.</span>}
            {isGenerating && <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>Stop</button>}
            <button type="submit" disabled={!canGenerate}>{isGenerating ? 'Thinking…' : clarification ? 'Send answer' : 'Generate tree'}</button>
          </div>
        </form>

        {(progress.length > 0 || error) && (
          <div className="bt-agent-process" aria-live="polite">
            <strong>Process</strong>
            {progress.map((message, index) => <div key={`${index}-${message}`} className={index === progress.length - 1 && isGenerating ? 'active' : ''}><span />{message}</div>)}
            {error && <p role="alert">{error}</p>}
          </div>
        )}

        {isGenerating && rawOutput && <pre className="bt-agent-stream" aria-label="Live model output">{rawOutput.slice(-1800)}</pre>}

        {generatedTree && <BehaviorTreeAgentPreview
          tree={generatedTree}
          baseline={currentTree}
          onReject={handleRejectProposal}
          onAccept={mode => onApply(generatedTree, mode)}
        />}
      </section>
    </div>
  );
};

export default BehaviorTreeAgentPanel;
