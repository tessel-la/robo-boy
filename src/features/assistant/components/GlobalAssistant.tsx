import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import { v4 as uuidv4 } from 'uuid';
import { useRuntimeConfig } from '../../../runtime/runtimeConfig';
import { loadGamepadLibrary, saveCustomGamepad } from '../../customGamepad/gamepadStorage';
import { listBehaviorTrees, saveBehaviorTree } from '../../behaviorTree/storage/treeStorage';
import type { BehaviorTreeAgentCheckpoint } from '../../behaviorTree/agent/types';
import type { ROSDiscoveryResult } from '../../behaviorTree/types';
import { createRosGraphCache } from '../context/rosGraphCache';
import { lookupTransformOnDemand } from '../context/tfContext';
import { useRosoutBuffer } from '../context/rosoutBuffer';
import { fetchBehaviorTreeSchemas } from '../tools/behaviorTreeTool';
import { validatePadAgainstRos } from '../tools/padValidator';
import { validateRosActionProposal } from '../tools/rosActionValidator';
import { executeGuardedRosAction } from '../tools/rosActionGuard';
import { composeAssistantSystemPrompt } from '../prompt';
import { parseAssistantResponse } from '../responseParser';
import { sendAssistantChat, fetchOllamaModels, type AssistantChatTurn, type AssistantProviderId, type AssistantProviderSettings } from '../providers/index';
import { getProviderDefaults, loadAssistantConversation, loadAssistantSettings, saveAssistantConversation, saveAssistantSettings } from '../storage/assistantStorage';
import type {
  AssistantAttachment,
  AssistantContextChip,
  AssistantMessage,
  AssistantSettings,
  BehaviorTreeAssistantBridge,
  OpenAssistantOptions,
  WorkspaceSnapshot,
} from '../types';
import AssistantPanel, { type ContextPickerOption } from './AssistantPanel';

export interface GlobalAssistantHandle {
  open: (options?: OpenAssistantOptions) => void;
  registerBehaviorTreeBridge: (panelId: string, bridge: BehaviorTreeAssistantBridge | null) => void;
}

export interface GlobalAssistantProps {
  ros: Ros | null;
  isConnected: boolean;
  connectionGeneration: number;
  workspace: WorkspaceSnapshot;
}

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

const createAttachment = async (file: File): Promise<AssistantAttachment> => {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isImage = IMAGE_ATTACHMENT_TYPES.has(file.type);
  const isText =
    file.type.startsWith('text/') ||
    TEXT_ATTACHMENT_EXTENSIONS.has(extension) ||
    ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml'].includes(file.type);
  if (!isImage && !isText) throw new Error(`${file.name} is not a supported text, code, configuration, or image file.`);
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

const computeNeeds = (userText: string, chips: AssistantContextChip[]) => {
  const lower = userText.toLowerCase();
  return {
    behaviorTree: chips.some(chip => chip.source === 'behaviorTree') || /\bbehavior[ -]?tree\b|\btree\b/.test(lower),
    pad: chips.some(chip => chip.source === 'pad') || /\bpad\b|\bgamepad\b|\bjoystick\b|\bcontroller\b/.test(lower),
    rosAction: /\bpublish\b|\bcall\b|\bservice\b|\baction\b|\btopic\b|\bsend\b/.test(lower),
  };
};

/**
 * The global, singleton Robo-Boy assistant. Owns conversation/provider/context state; mounted
 * once from MainControlView (plan §3.2). Exposes `open()`/`registerBehaviorTreeBridge()` via an
 * imperative handle so a mounted BehaviorTreePanel can open THIS conversation with its context
 * pinned, and preview/accept BT edits through its own existing canvas machinery, instead of the
 * assistant owning a second, duplicate BT-editing implementation.
 */
const GlobalAssistant = forwardRef<GlobalAssistantHandle, GlobalAssistantProps>(
  ({ ros, isConnected, connectionGeneration, workspace }, ref) => {
    const runtime = useRuntimeConfig();
    const [isOpen, setIsOpen] = useState(false);
    const [settings, setSettings] = useState<AssistantSettings>(loadAssistantSettings);
    const [messages, setMessages] = useState<AssistantMessage[]>(() =>
      loadAssistantConversation().map(stored => ({
        id: uuidv4(),
        role: stored.role,
        content: stored.content,
        attachments: [],
        contextChipIds: [],
        checkpoint: null,
        createdAt: stored.createdAt,
      }))
    );
    const [prompt, setPrompt] = useState('');
    const [progress, setProgress] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [clarificationSuggestions, setClarificationSuggestions] = useState<string[] | undefined>();
    const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
    const [attachmentError, setAttachmentError] = useState('');
    const [manualChips, setManualChips] = useState<AssistantContextChip[]>([]);
    const [removedAutoChipIds, setRemovedAutoChipIds] = useState<Set<string>>(() => new Set());
    const [rosDiscoveryChip, setRosDiscoveryChip] = useState<AssistantContextChip | null>(null);
    const [isDiscoveringContext, setIsDiscoveringContext] = useState(false);
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [ollamaModelsError, setOllamaModelsError] = useState('');
    const [isLoadingOllamaModels, setIsLoadingOllamaModels] = useState(false);
    const [ollamaModelsRefresh, setOllamaModelsRefresh] = useState(0);
    const [pinnedBehaviorTreePanelId, setPinnedBehaviorTreePanelId] = useState<string | null>(null);

    const bridgesRef = useRef<Map<string, BehaviorTreeAssistantBridge>>(new Map());
    const lastRegisteredBridgeIdRef = useRef<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const rosGraphCacheRef = useRef(createRosGraphCache());
    const rosoutEntries = useRosoutBuffer(ros, isOpen);

    useEffect(() => () => abortRef.current?.abort(), []);

    useEffect(() => {
      saveAssistantConversation(messages.map(message => ({ role: message.role, content: message.content, createdAt: message.createdAt })));
    }, [messages]);

    const resolvedSettings: AssistantProviderSettings = useMemo(
      () => ({
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model,
        baseUrl: settings.provider === 'ollama' && settings.ollamaUseBackendHost ? runtime.ollamaBaseUrl : settings.baseUrl,
      }),
      [runtime.ollamaBaseUrl, settings]
    );

    const getActiveBridge = (): BehaviorTreeAssistantBridge | null => {
      if (pinnedBehaviorTreePanelId) {
        const pinned = bridgesRef.current.get(pinnedBehaviorTreePanelId);
        if (pinned) return pinned;
      }
      const lastId = lastRegisteredBridgeIdRef.current;
      if (lastId) {
        const last = bridgesRef.current.get(lastId);
        if (last) return last;
      }
      const [first] = bridgesRef.current.values();
      return first ?? null;
    };

    useImperativeHandle(
      ref,
      () => ({
        open: options => {
          setIsOpen(true);
          if (options?.pinBehaviorTreePanelId) setPinnedBehaviorTreePanelId(options.pinBehaviorTreePanelId);
        },
        registerBehaviorTreeBridge: (panelId, bridge) => {
          if (bridge) {
            bridgesRef.current.set(panelId, bridge);
            lastRegisteredBridgeIdRef.current = panelId;
          } else {
            bridgesRef.current.delete(panelId);
            if (pinnedBehaviorTreePanelId === panelId) setPinnedBehaviorTreePanelId(null);
            if (lastRegisteredBridgeIdRef.current === panelId) lastRegisteredBridgeIdRef.current = null;
          }
        },
      }),
      [pinnedBehaviorTreePanelId]
    );

    // Ollama model discovery — same debounced pattern the old BT-agent settings popover used.
    useEffect(() => {
      if (settings.provider !== 'ollama') {
        setOllamaModels([]);
        setOllamaModelsError('');
        setIsLoadingOllamaModels(false);
        return;
      }
      const controller = new AbortController();
      setIsLoadingOllamaModels(true);
      setOllamaModelsError('');
      const timeout = window.setTimeout(async () => {
        try {
          const models = await fetchOllamaModels(resolvedSettings.baseUrl, settings.apiKey, controller.signal);
          setOllamaModels(models);
          setSettings(previous => {
            if (models.length === 0 || models.includes(previous.model)) return previous;
            const next = { ...previous, model: models[0] };
            saveAssistantSettings(next);
            return next;
          });
        } catch (cause) {
          if (controller.signal.aborted) return;
          setOllamaModels([]);
          setOllamaModelsError(cause instanceof Error ? cause.message : 'Could not load Ollama models.');
        } finally {
          if (!controller.signal.aborted) setIsLoadingOllamaModels(false);
        }
      }, 250);
      return () => {
        window.clearTimeout(timeout);
        controller.abort();
      };
    }, [ollamaModelsRefresh, resolvedSettings.baseUrl, settings.apiKey, settings.provider]);

    const updateSettings = (patch: Partial<AssistantSettings>) => {
      setError('');
      setSettings(previous => {
        const next = { ...previous, ...patch };
        saveAssistantSettings(next);
        return next;
      });
    };

    const handleProviderChange = (provider: AssistantProviderId) => {
      updateSettings({ provider, apiKey: '', ...getProviderDefaults(provider), ...(provider === 'ollama' ? { ollamaUseBackendHost: true } : {}) });
    };

    const refreshRosContext = async (forceRefresh = false) => {
      if (!ros) return null;
      setIsDiscoveringContext(true);
      try {
        const entry = await rosGraphCacheRef.current.get(ros, connectionGeneration, { forceRefresh });
        if (!entry) return null;
        const chip: AssistantContextChip = {
          id: 'ros:all',
          label: `ROS: ${entry.result.actions.length + entry.result.services.length + entry.result.topics.length}`,
          source: 'ros',
          automatic: true,
          fetchedAt: entry.fetchedAt,
          generation: entry.generation,
          value: entry.result,
        };
        setRosDiscoveryChip(chip);
        return entry.result;
      } catch (cause) {
        console.warn('Assistant ROS discovery failed.', cause);
        return null;
      } finally {
        setIsDiscoveringContext(false);
      }
    };

    // Refresh once per open+connect, mirroring the old assistant's default "ROS: N" auto chip.
    useEffect(() => {
      if (isOpen && ros && isConnected && !removedAutoChipIds.has('ros:all')) {
        void refreshRosContext();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, ros, isConnected, connectionGeneration]);

    const activeBridge = getActiveBridge();
    const activeBridgeTree = activeBridge?.getCurrentTree() ?? null;

    const allChips: AssistantContextChip[] = useMemo(() => {
      const chips: AssistantContextChip[] = [];
      chips.push({
        id: 'workspace',
        label: `Workspace (${workspace.openPanels.length} open)`,
        source: 'workspace',
        automatic: true,
        fetchedAt: workspace.fetchedAt,
        value: workspace,
      });
      if (rosDiscoveryChip && !removedAutoChipIds.has('ros:all')) {
        chips.push({ ...rosDiscoveryChip, stale: rosDiscoveryChip.generation !== undefined && rosDiscoveryChip.generation !== connectionGeneration });
      }
      if (activeBridgeTree && !removedAutoChipIds.has('bt:current')) {
        chips.push({
          id: 'bt:current',
          label: `BT: ${activeBridgeTree.name}`,
          source: 'behaviorTree',
          automatic: true,
          fetchedAt: Date.now(),
          value: activeBridgeTree,
        });
      }
      chips.push(...manualChips);
      return chips;
    }, [activeBridgeTree, connectionGeneration, manualChips, removedAutoChipIds, rosDiscoveryChip, workspace]);

    const removeContextChip = (id: string) => {
      if (id === 'workspace' || id === 'ros:all' || id === 'bt:current') {
        setRemovedAutoChipIds(previous => new Set(previous).add(id));
      } else {
        setManualChips(previous => previous.filter(chip => chip.id !== id));
      }
    };

    const addManualChip = (chip: AssistantContextChip) => {
      setManualChips(previous => (previous.some(existing => existing.id === chip.id) ? previous : [...previous, chip]));
    };

    const contextPickerOptions: ContextPickerOption[] = useMemo(() => {
      const options: ContextPickerOption[] = [];
      const pads = loadGamepadLibrary();
      options.push({
        id: 'pads:all',
        label: 'All saved Pads',
        description: `${pads.length} Pad${pads.length === 1 ? '' : 's'}`,
        onSelect: () =>
          addManualChip({ id: 'pads:all', label: 'All Pads', source: 'pad', automatic: false, fetchedAt: Date.now(), value: pads.map(item => item.layout) }),
      });
      const trees = listBehaviorTrees();
      options.push({
        id: 'bts:all',
        label: 'All saved Behavior Trees',
        description: `${trees.length} tree${trees.length === 1 ? '' : 's'}`,
        onSelect: () =>
          addManualChip({ id: 'bts:all', label: 'All Behavior Trees', source: 'behaviorTree', automatic: false, fetchedAt: Date.now(), value: trees.map(item => item.tree) }),
      });
      if (ros && isConnected) {
        options.push({
          id: 'rosout',
          label: '/rosout recent log',
          description: `${rosoutEntries.length} entr${rosoutEntries.length === 1 ? 'y' : 'ies'}`,
          onSelect: () =>
            addManualChip({ id: 'rosout', label: '/rosout log', source: 'rosout', automatic: false, fetchedAt: Date.now(), value: rosoutEntries }),
        });
        options.push({
          id: 'ros:refresh',
          label: 'Refresh ROS graph now',
          description: 'Bypass the cache and re-discover topics/services/actions',
          onSelect: () => void refreshRosContext(true),
        });
      }
      return options;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ros, isConnected, rosoutEntries]);

    const pushMessage = (message: AssistantMessage) => setMessages(previous => [...previous, message]);
    const updateMessage = (id: string, patch: Partial<AssistantMessage>) =>
      setMessages(previous => previous.map(message => (message.id === id ? { ...message, ...patch } : message)));

    const generateFromPrompt = async (
      rawPrompt: string,
      historyOverride?: AssistantMessage[],
      checkpointOverride?: BehaviorTreeAgentCheckpoint | null,
      attachmentsOverride?: AssistantAttachment[]
    ) => {
      const userText = rawPrompt.trim();
      if (!userText || isGenerating) return;
      if (!resolvedSettings.baseUrl.trim() || !resolvedSettings.model.trim()) {
        setError('Set both a base URL and model in Assistant settings before sending.');
        return;
      }
      if (settings.provider !== 'openai-compatible' && settings.provider !== 'ollama' && !settings.apiKey.trim()) {
        setError(`Add an API key for ${settings.provider} in Assistant settings before sending.`);
        return;
      }

      const history = historyOverride ?? messages;
      const bridge = getActiveBridge();
      const checkpoint = checkpointOverride !== undefined ? checkpointOverride : (bridge?.captureCheckpoint() ?? null);
      const turnAttachments = attachmentsOverride ?? attachments;
      const userMessage: AssistantMessage = {
        id: uuidv4(),
        role: 'user',
        content: userText,
        attachments: turnAttachments,
        contextChipIds: allChips.map(chip => chip.id),
        checkpoint,
        createdAt: Date.now(),
      };
      const nextHistory = [...history, userMessage];
      setMessages(nextHistory);
      setPrompt('');
      setAttachments([]);
      setAttachmentError('');
      setClarificationSuggestions(undefined);
      const controller = new AbortController();
      abortRef.current = controller;
      setError('');
      setProgress(['Gathering context…']);
      setIsGenerating(true);
      const generationAtSend = connectionGeneration;

      try {
        const needs = computeNeeds(userText, allChips);
        let schemas = { actions: {}, services: {} };
        let discoveryForValidation: ROSDiscoveryResult | null = (rosDiscoveryChip?.value as ROSDiscoveryResult) ?? null;

        if ((needs.behaviorTree || needs.rosAction) && ros && isConnected) {
          const entry = await rosGraphCacheRef.current.get(ros, connectionGeneration);
          if (entry) discoveryForValidation = entry.result;
        }
        if (needs.behaviorTree && ros && isConnected && discoveryForValidation) {
          setProgress(previous => [...previous, 'Loading action/service schemas…']);
          schemas = await fetchBehaviorTreeSchemas(ros, discoveryForValidation);
        }

        // Lightweight, deterministic TF tool: detect "transform between/from X to/and Y" and
        // compute it directly (on-demand subscribe/unsubscribe, see context/tfContext.ts) rather
        // than asking the model to invent numbers. The result is added as ephemeral, this-turn-only
        // context — not persisted as a chip — so the model explains real, computed data.
        const turnChips = [...allChips];
        const tfMatch = userText.match(/\btransform\b[^.?!]*?\b(?:from|between)\s+([\w./-]+)\s+(?:to|and)\s+([\w./-]+)/i);
        if (tfMatch && ros && isConnected) {
          setProgress(previous => [...previous, `Looking up the transform ${tfMatch[1]} → ${tfMatch[2]}…`]);
          const lookup = await lookupTransformOnDemand(ros, tfMatch[1], tfMatch[2]);
          turnChips.push({
            id: 'tf:lookup',
            label: `TF: ${tfMatch[1]} → ${tfMatch[2]}`,
            source: 'tf',
            automatic: false,
            fetchedAt: Date.now(),
            value: lookup,
          });
        }

        const systemPrompt = composeAssistantSystemPrompt({ settings, contextChips: turnChips, needs });
        const chatMessages: AssistantChatTurn[] = nextHistory.map(message => ({ role: message.role, content: message.content }));
        const lastIndex = chatMessages.length - 1;
        const imageAttachments = turnAttachments.filter(attachment => attachment.kind === 'image');
        const textAttachments = turnAttachments.filter(attachment => attachment.kind === 'text');
        if (imageAttachments.length > 0) {
          chatMessages[lastIndex] = {
            ...chatMessages[lastIndex],
            images: imageAttachments.map(attachment => ({ mimeType: attachment.mimeType, data: attachment.content })),
          };
        }
        if (textAttachments.length > 0) {
          chatMessages[lastIndex] = {
            ...chatMessages[lastIndex],
            content: `${chatMessages[lastIndex].content}\n\nAttached files:\n${textAttachments
              .map(attachment => `### ${attachment.name}\n${attachment.content}`)
              .join('\n\n')}`,
          };
        }

        const raw = await sendAssistantChat({
          settings: resolvedSettings,
          systemPrompt,
          messages: chatMessages,
          signal: controller.signal,
          jsonMode: true,
          onProgress: message => setProgress(previous => [...previous, message]),
        });
        setProgress(previous => [...previous, 'Parsing response…']);
        const response = parseAssistantResponse(raw, schemas);

        if (response.kind === 'explanation') {
          pushMessage({ id: uuidv4(), role: 'assistant', content: response.message, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now() });
        } else if (response.kind === 'clarification') {
          setClarificationSuggestions(response.suggestions);
          pushMessage({ id: uuidv4(), role: 'assistant', content: response.question, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now() });
        } else if (response.kind === 'behaviorTree') {
          if (bridge) {
            bridge.applyPreview(response.tree);
            pushMessage({
              id: uuidv4(),
              role: 'assistant',
              content: `Built "${response.tree.name}" — previewing it on the open Behavior Tree canvas.`,
              attachments: [],
              contextChipIds: [],
              checkpoint: null,
              createdAt: Date.now(),
              response,
              resolution: 'applied',
            });
          } else {
            pushMessage({
              id: uuidv4(),
              role: 'assistant',
              content: `Built "${response.tree.name}". Open a Behavior Tree panel to preview it live, or save it directly to your library.`,
              attachments: [],
              contextChipIds: [],
              checkpoint: null,
              createdAt: Date.now(),
              response,
            });
          }
        } else if (response.kind === 'padProposal') {
          const issues = discoveryForValidation ? validatePadAgainstRos(response.layout, discoveryForValidation) : [];
          pushMessage({
            id: uuidv4(),
            role: 'assistant',
            content: `Built Pad "${response.layout.name}".`,
            attachments: [],
            contextChipIds: [],
            checkpoint: null,
            createdAt: Date.now(),
            response: { ...response, issues },
          });
        } else {
          const issues = discoveryForValidation ? validateRosActionProposal(response.operation, discoveryForValidation) : [];
          pushMessage({
            id: uuidv4(),
            role: 'assistant',
            content: response.rationale || `Proposed ${response.operation.kind} "${response.operation.name}".`,
            attachments: [],
            contextChipIds: [],
            checkpoint: null,
            createdAt: Date.now(),
            response: { ...response, issues },
            proposedAtGeneration: generationAtSend,
          });
        }
      } catch (cause) {
        if (controller.signal.aborted) {
          setProgress(previous => [...previous, 'Generation stopped.']);
        } else {
          setError(cause instanceof Error ? cause.message : 'The assistant request failed.');
        }
      } finally {
        setIsGenerating(false);
        abortRef.current = null;
      }
    };

    const handleSubmit = () => void generateFromPrompt(prompt);
    const handleStop = () => abortRef.current?.abort();

    const handleNewConversation = () => {
      abortRef.current?.abort();
      setMessages([]);
      setClarificationSuggestions(undefined);
      setProgress([]);
      setError('');
      setPrompt('');
      setAttachments([]);
      setAttachmentError('');
      saveAssistantConversation([]);
    };

    const handleRewind = (messageIndex: number) => {
      const message = messages[messageIndex];
      abortRef.current?.abort();
      if (message.checkpoint) getActiveBridge()?.restoreCheckpoint(message.checkpoint);
      setMessages(messages.slice(0, messageIndex));
      setClarificationSuggestions(undefined);
      setProgress([]);
      setError('');
    };

    const handleRepeat = (messageIndex: number) => {
      let commandIndex = messageIndex;
      while (commandIndex >= 0 && messages[commandIndex].role !== 'user') commandIndex -= 1;
      if (commandIndex < 0) return;
      const message = messages[commandIndex];
      const history = messages.slice(0, commandIndex);
      if (message.checkpoint) getActiveBridge()?.restoreCheckpoint(message.checkpoint);
      setMessages(history);
      void generateFromPrompt(message.content, history, message.checkpoint, message.attachments);
    };

    const handleAttachFiles = async (fileList: FileList | null) => {
      const files = Array.from(fileList ?? []);
      if (files.length === 0) return;
      setAttachmentError('');
      if (attachments.length + files.length > MAX_ATTACHMENTS) {
        setAttachmentError(`Attach up to ${MAX_ATTACHMENTS} files per message.`);
        return;
      }
      if (
        attachments.reduce((total, item) => total + item.size, 0) + files.reduce((total, file) => total + file.size, 0) >
        MAX_ATTACHMENT_TOTAL_SIZE
      ) {
        setAttachmentError('Attachments can use up to 12 MB per message.');
        return;
      }
      try {
        const next = await Promise.all(files.map(createAttachment));
        setAttachments(previous => [...previous, ...next.filter(item => !previous.some(existing => existing.id === item.id))]);
      } catch (cause) {
        setAttachmentError(cause instanceof Error ? cause.message : 'Could not attach that file.');
      }
    };

    const handleSketchAttach = (dataUrl: string) => {
      const content = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const size = Math.ceil((content.length * 3) / 4);
      setAttachmentError('');
      if (attachments.length >= MAX_ATTACHMENTS) {
        setAttachmentError(`Attach up to ${MAX_ATTACHMENTS} files per message.`);
        return;
      }
      if (size > MAX_ATTACHMENT_SIZE) {
        setAttachmentError('The sketch is larger than 5 MB. Clear some detail and try again.');
        return;
      }
      const timestamp = Date.now();
      setAttachments(previous => [
        ...previous,
        { id: `sketch:${timestamp}`, name: `sketch-${timestamp}.png`, mimeType: 'image/png', size, kind: 'image', content },
      ]);
    };

    const handleRunRosAction = async (messageId: string) => {
      const message = messages.find(item => item.id === messageId);
      if (!message || message.response?.kind !== 'rosAction' || !ros) return;
      try {
        const result = await executeGuardedRosAction({
          ros,
          operation: message.response.operation,
          proposedAtGeneration: message.proposedAtGeneration ?? connectionGeneration,
          getCurrentGeneration: () => connectionGeneration,
        });
        updateMessage(messageId, { resolution: 'ran' });
        pushMessage({
          id: uuidv4(),
          role: 'assistant',
          content: result === undefined ? 'Done — no response payload.' : `Result: ${JSON.stringify(result)}`,
          attachments: [],
          contextChipIds: [],
          checkpoint: null,
          createdAt: Date.now(),
        });
      } catch (cause) {
        updateMessage(messageId, { resolution: 'failed' });
        setError(cause instanceof Error ? cause.message : 'The action failed.');
      }
    };

    const handleSavePadProposal = (messageId: string) => {
      const message = messages.find(item => item.id === messageId);
      if (!message || message.response?.kind !== 'padProposal') return;
      saveCustomGamepad(message.response.layout);
      updateMessage(messageId, { resolution: 'saved' });
    };

    const handleSaveBehaviorTreeProposal = (messageId: string) => {
      const message = messages.find(item => item.id === messageId);
      if (!message || message.response?.kind !== 'behaviorTree') return;
      saveBehaviorTree(message.response.tree);
      updateMessage(messageId, { resolution: 'saved' });
    };

    return (
      <>
        {!isOpen && (
          <button
            type="button"
            className="assistant-launcher"
            onClick={() => setIsOpen(true)}
            aria-label="Open Robo-Boy assistant"
            title="Robo-Boy assistant"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3l1.3 4.2 4.2 1.3-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3zM18.5 14l.7 2.2 2.3.8-2.3.7-.7 2.3-.8-2.3-2.2-.7 2.2-.8.8-2.2z"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
        <AssistantPanel
          open={isOpen}
          onClose={() => setIsOpen(false)}
          messages={messages}
          isGenerating={isGenerating}
          progressMessages={progress}
          error={error}
          clarificationSuggestions={clarificationSuggestions}
          onSelectSuggestion={setPrompt}
          prompt={prompt}
          onPromptChange={setPrompt}
          onSubmit={handleSubmit}
          onStop={handleStop}
          onNewConversation={handleNewConversation}
          onRepeat={handleRepeat}
          onRewind={handleRewind}
          contextChips={allChips}
          onRemoveContextChip={removeContextChip}
          contextPickerOptions={contextPickerOptions}
          isDiscoveringContext={isDiscoveringContext}
          attachments={attachments}
          attachmentError={attachmentError}
          onAttachFiles={handleAttachFiles}
          onRemoveAttachment={id => setAttachments(previous => previous.filter(item => item.id !== id))}
          onSketchAttach={handleSketchAttach}
          settings={settings}
          resolvedBaseUrl={resolvedSettings.baseUrl}
          onProviderChange={handleProviderChange}
          onUpdateSettings={updateSettings}
          ollamaModels={ollamaModels}
          ollamaModelsError={ollamaModelsError}
          isLoadingOllamaModels={isLoadingOllamaModels}
          onRefreshOllamaModels={() => setOllamaModelsRefresh(value => value + 1)}
          onRunRosAction={id => void handleRunRosAction(id)}
          onSavePadProposal={handleSavePadProposal}
          onSaveBehaviorTreeProposal={handleSaveBehaviorTreeProposal}
          hasActiveBehaviorTreeBridge={Boolean(activeBridge)}
        />
      </>
    );
  }
);

GlobalAssistant.displayName = 'GlobalAssistant';

export default GlobalAssistant;
