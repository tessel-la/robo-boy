import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import { v4 as uuidv4 } from 'uuid';
import { useRuntimeConfig } from '../../../runtime/runtimeConfig';
import { HiSparkles } from 'react-icons/hi2';
import { fetchActionGoalDetails, fetchMessageSchema, fetchServiceRequestSchema } from '../../behaviorTree/services/rosDiscovery';
import { listBehaviorTrees, saveBehaviorTree } from '../../behaviorTree/storage/treeStorage';
import type { BehaviorTreeAgentCheckpoint, BehaviorTreeResourceSchemas } from '../../behaviorTree/agent/types';
import type { ROSDiscoveryResult } from '../../behaviorTree/types';
import { loadGamepadLibrary } from '../../customGamepad/gamepadStorage';
import type { CustomGamepadLayout, GamepadComponentConfig } from '../../customGamepad/types';
import { createRosGraphCache } from '../context/rosGraphCache';
import { CONTEXT_CATALOG, type ContextCatalogEntry } from '../capabilities';
import {
  captureRosout,
  fetchRosNodeDetails,
  fetchRosNodeNames,
  fetchRosParameterNames,
  fetchRosParameterValue,
  sampleRosTopic,
} from '../context/rosContext';
import { captureTfSnapshotOnDemand, lookupTransformOnDemand, parseDistanceRequest, parseTransformRequest, type TfLookupResult } from '../context/tfContext';
import { composeAssistantSystemPrompt } from '../prompt';
import { sendAssistantChat, fetchOllamaModels, type AssistantChatTurn, type AssistantProviderId, type AssistantProviderSettings } from '../providers/index';
import { parseAssistantResponse } from '../responseParser';
import { transcribeAssistantAudio } from '../providers/transcription';
import { getProviderDefaults, loadAssistantConversation, loadAssistantSettings, saveAssistantConversation, saveAssistantSettings } from '../storage/assistantStorage';
import { fetchBehaviorTreeSchemas } from '../tools/behaviorTreeTool';
import { validatePadAgainstRos } from '../tools/padValidator';
import { validateRosActionProposal } from '../tools/rosActionValidator';
import type {
  AssistantAttachment,
  AssistantAutoContext,
  AssistantContextChip,
  AssistantContextUsage,
  AssistantMessage,
  AssistantSettings,
  BehaviorTreeAssistantBridge,
  OpenAssistantOptions,
  WorkspaceSnapshot,
} from '../types';
import AssistantPanel, { type ContextPickerOption, type ContextPickerSection } from './AssistantPanel';

export interface GlobalAssistantHandle {
  open: (options?: OpenAssistantOptions) => void;
  toggle: () => void;
  registerBehaviorTreeBridge: (panelId: string, bridge: BehaviorTreeAssistantBridge | null) => void;
}

export interface GlobalAssistantProps {
  ros: Ros | null;
  isConnected: boolean;
  connectionGeneration: number;
  workspace: WorkspaceSnapshot;
  onReviewPadProposal?: (layout: CustomGamepadLayout) => void;
  /** Opens a tagged resource in the view that owns it. Returns false when it has no such view. */
  onOpenResource?: (resourceId: string) => boolean;
  /** Whether that resource has a view to open at all, asked before a tag is drawn as clickable. */
  canOpenResource?: (resourceId: string) => boolean;
}

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_SIZE = 12 * 1024 * 1024;
const MAX_SCHEMA_TYPES = 24;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'yaml', 'yml', 'xml', 'csv', 'log', 'launch', 'urdf', 'xacro',
  'py', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'sh', 'toml', 'ini', 'cfg',
]);
const IMAGE_ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const abortError = () => new DOMException('Assistant context request cancelled.', 'AbortError');
const isAbortError = (cause: unknown) => cause instanceof DOMException && cause.name === 'AbortError';

const readFile = (file: File, mode: 'text' | 'data-url'): Promise<string> => {
  if (mode === 'text' && typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result ?? ''));
    mode === 'text' ? reader.readAsText(file) : reader.readAsDataURL(file);
  });
};

const createAttachment = async (file: File): Promise<AssistantAttachment> => {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isImage = IMAGE_ATTACHMENT_TYPES.has(file.type);
  const isText = file.type.startsWith('text/') || TEXT_ATTACHMENT_EXTENSIONS.has(extension) ||
    ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml'].includes(file.type);
  if (!isImage && !isText) throw new Error(`${file.name} is not a supported text, code, configuration, or image file.`);
  if (file.size > MAX_ATTACHMENT_SIZE) throw new Error(`${file.name} is larger than 5 MB.`);
  const binary = isImage;
  const rawContent = await readFile(file, binary ? 'data-url' : 'text');
  return {
    id: `attachment:${file.name}:${file.size}:${file.lastModified}`,
    name: file.name,
    mimeType: file.type || (isImage ? 'image/png' : 'text/plain'),
    size: file.size,
    kind: isImage ? 'image' : 'text',
    content: binary ? rawContent.slice(rawContent.indexOf(',') + 1) : rawContent,
  };
};

const computeNeeds = (text: string, chips: AssistantContextChip[]) => {
  const lower = text.toLowerCase();
  return {
    behaviorTree: chips.some(chip => chip.source === 'behaviorTree') || /\bbehavior[ -]?tree\b|\bbt\b/.test(lower),
    pad: chips.some(chip => chip.source === 'pad') || /\bpad\b|\bgamepad\b|\bjoystick\b|\bcontroller\b/.test(lower),
    rosAction: /\bpublish\b|\bcall\b|\bservice\b|\baction\b|\btopic\b|\bsend\b/.test(lower),
  };
};

const readPadLibrary = () => {
  try {
    return (loadGamepadLibrary() ?? []).filter(item => item && typeof item.id === 'string' && item.layout && Array.isArray(item.layout.components));
  } catch {
    return [];
  }
};

const readTreeLibrary = () => {
  try {
    return (listBehaviorTrees() ?? []).filter(item => item && item.tree && typeof item.tree.id === 'string' && Array.isArray(item.tree.nodes));
  } catch {
    return [];
  }
};

const padReferencedTypes = (layout: CustomGamepadLayout | null) => {
  const result = { topics: [] as string[], services: [] as string[], actions: [] as string[] };
  if (!layout) return result;
  const addOperation = (operation: any) => {
    if (!operation?.messageType) return;
    if (operation.kind === 'service') result.services.push(operation.messageType);
    else if (operation.kind === 'action') result.actions.push(operation.messageType);
    else result.topics.push(operation.messageType);
  };
  layout.components.forEach((component: GamepadComponentConfig) => {
    if (component.action) {
      if ('topic' in component.action && component.action.messageType) result.topics.push(component.action.messageType);
      else if ('type' in component.action && component.action.type !== 'custom') {
        addOperation({ kind: component.action.type, messageType: component.action.messageType });
      }
    }
    Object.values(component.eventOperations ?? {}).forEach(addOperation);
    Object.values(component.config?.physicalGamepadBindings ?? {}).forEach(binding => {
      addOperation(binding?.press);
      addOperation(binding?.release);
    });
  });
  return {
    topics: [...new Set(result.topics)],
    services: [...new Set(result.services)],
    actions: [...new Set(result.actions)],
  };
};

const formatTfAnswer = (lookup: TfLookupResult): string => {
  if (lookup.transform) {
    const { sourceFrame, targetFrame, translation, rotation, path } = lookup.transform;
    const n = (value: number) => Number(value.toFixed(6));
    return `Transform from \`${sourceFrame}\` to \`${targetFrame}\`:\n\n` +
      `- Translation (m): x=${n(translation.x)}, y=${n(translation.y)}, z=${n(translation.z)}\n` +
      `- Rotation quaternion: x=${n(rotation.x)}, y=${n(rotation.y)}, z=${n(rotation.z)}, w=${n(rotation.w)}\n` +
      `- TF path: ${path.map(frame => `\`${frame}\``).join(' → ')}`;
  }
  const missing = [
    !lookup.resolvedSource ? `source frame \`${lookup.requestedSource}\`` : '',
    !lookup.resolvedTarget ? `target frame \`${lookup.requestedTarget}\`` : '',
  ].filter(Boolean);
  if (missing.length) {
    return `I could not resolve ${missing.join(' and ')} in the live TF data. ` +
      (lookup.frames.length
        ? `Known frames include: ${lookup.frames.slice(0, 30).map(frame => `\`${frame}\``).join(', ')}.`
        : 'No TF frames arrived before the lookup timed out.');
  }
  return `Both frames were found, but there is no connected TF path between \`${lookup.resolvedSource}\` and \`${lookup.resolvedTarget}\`. ` +
    `The live graph has ${lookup.diagnostics.components.length} connected components. Check missing broadcasters or inconsistent frame names.`;
};

const formatTfDistanceAnswer = (lookup: TfLookupResult): string => {
  if (!lookup.transform) return formatTfAnswer(lookup);
  const { sourceFrame, targetFrame, translation, path } = lookup.transform;
  const distance = Math.hypot(translation.x, translation.y, translation.z);
  return `The live TF distance from \`${sourceFrame}\` to \`${targetFrame}\` is **${Number(distance.toFixed(6))} m**.\n\n` +
    `Translation: x=${Number(translation.x.toFixed(6))}, y=${Number(translation.y.toFixed(6))}, z=${Number(translation.z.toFixed(6))} m.\n` +
    `TF path: ${path.map(frame => `\`${frame}\``).join(' → ')}`;
};

const GlobalAssistant = forwardRef<GlobalAssistantHandle, GlobalAssistantProps>(
  ({ ros, isConnected, connectionGeneration, workspace, onReviewPadProposal, onOpenResource, canOpenResource }, ref) => {
    const runtime = useRuntimeConfig();
    const [isOpen, setIsOpen] = useState(false);
    const [settings, setSettings] = useState<AssistantSettings>(loadAssistantSettings);
    const [messages, setMessages] = useState<AssistantMessage[]>(() => loadAssistantConversation().map(stored => ({
      id: uuidv4(), role: stored.role, content: stored.content, attachments: [], contextChipIds: [], checkpoint: null, createdAt: stored.createdAt,
    })));
    const [prompt, setPrompt] = useState('');
    const [progress, setProgress] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [clarificationSuggestions, setClarificationSuggestions] = useState<string[] | undefined>();
    const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
    const [attachmentError, setAttachmentError] = useState('');
    const [pinnedChips, setPinnedChips] = useState<AssistantContextChip[]>([]);
    /** Mirrors `pinnedChips` so a send that just awaited a retrieval reads the chip it waited for,
     * without waiting for React to re-render first. */
    const pinnedChipsRef = useRef<AssistantContextChip[]>([]);
    const updatePinnedChips = (update: (previous: AssistantContextChip[]) => AssistantContextChip[]) => {
      pinnedChipsRef.current = update(pinnedChipsRef.current);
      setPinnedChips(pinnedChipsRef.current);
    };
    const [rosGraph, setRosGraph] = useState<{ resources: ROSDiscoveryResult; fetchedAt: number; generation: number } | null>(null);
    const [catalog, setCatalog] = useState<{ nodes: string[]; parameters: string[]; generation: number }>({ nodes: [], parameters: [], generation: -1 });
    const [isDiscoveringContext, setIsDiscoveringContext] = useState(false);
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [ollamaModelsError, setOllamaModelsError] = useState('');
    const [isLoadingOllamaModels, setIsLoadingOllamaModels] = useState(false);
    const [ollamaModelsRefresh, setOllamaModelsRefresh] = useState(0);
    const [pinnedBehaviorTreePanelId, setPinnedBehaviorTreePanelId] = useState<string | null>(null);

    const bridgesRef = useRef<Map<string, BehaviorTreeAssistantBridge>>(new Map());
    const lastRegisteredBridgeIdRef = useRef<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    /** Every in-flight context retrieval. They are independent -- tagging a second resource must not
     * cancel the first -- and are aborted together when the assistant closes or ROS reconnects. */
    const contextWorkRef = useRef<Set<AbortController>>(new Set());
    const contextResultsRef = useRef<Set<Promise<unknown>>>(new Set());
    const rosGraphCacheRef = useRef(createRosGraphCache());
    const currentGenerationRef = useRef(connectionGeneration);
    currentGenerationRef.current = connectionGeneration;

    const abortContextWork = useCallback(() => {
      contextWorkRef.current.forEach(controller => controller.abort());
      contextWorkRef.current.clear();
    }, []);

    const closeAssistant = useCallback(() => {
      abortRef.current?.abort();
      abortContextWork();
      setIsOpen(false);
      setProgress([]);
    }, [abortContextWork]);

    useEffect(() => {
      document.documentElement.classList.toggle('assistant-is-open', isOpen);
      return () => document.documentElement.classList.remove('assistant-is-open');
    }, [isOpen]);
    useEffect(() => () => {
      abortRef.current?.abort();
      abortContextWork();
    }, [abortContextWork]);
    useEffect(() => {
      abortRef.current?.abort();
      abortContextWork();
      rosGraphCacheRef.current.clear();
      setRosGraph(null);
      setCatalog({ nodes: [], parameters: [], generation: -1 });
      updatePinnedChips(previous => previous.map(chip => chip.generation === undefined ? chip : { ...chip, stale: true }));
      setProgress([]);
    }, [connectionGeneration, ros]);
    useEffect(() => {
      saveAssistantConversation(messages.map(message => ({ role: message.role, content: message.content, createdAt: message.createdAt })));
    }, [messages]);

    const resolvedSettings: AssistantProviderSettings = useMemo(() => ({
      provider: settings.provider,
      apiKey: settings.apiKey,
      model: settings.model,
      baseUrl: settings.provider === 'ollama' && settings.ollamaUseBackendHost ? runtime.ollamaBaseUrl : settings.baseUrl,
    }), [runtime.ollamaBaseUrl, settings]);

    const getActiveBridge = (): BehaviorTreeAssistantBridge | null => {
      if (pinnedBehaviorTreePanelId) {
        const pinned = bridgesRef.current.get(pinnedBehaviorTreePanelId);
        if (pinned) return pinned;
      }
      const last = lastRegisteredBridgeIdRef.current;
      if (last && bridgesRef.current.has(last)) return bridgesRef.current.get(last) ?? null;
      return bridgesRef.current.values().next().value ?? null;
    };

    useImperativeHandle(ref, () => ({
      open: options => {
        setIsOpen(true);
        if (options?.pinBehaviorTreePanelId) setPinnedBehaviorTreePanelId(options.pinBehaviorTreePanelId);
      },
      toggle: () => setIsOpen(value => !value),
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
    }), [pinnedBehaviorTreePanelId]);

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
            if (!models.length || models.includes(previous.model)) return previous;
            const next = { ...previous, model: models[0] };
            saveAssistantSettings(next);
            return next;
          });
        } catch (cause) {
          if (!controller.signal.aborted) setOllamaModelsError(cause instanceof Error ? cause.message : 'Could not load Ollama models.');
        } finally {
          if (!controller.signal.aborted) setIsLoadingOllamaModels(false);
        }
      }, 250);
      return () => { window.clearTimeout(timeout); controller.abort(); };
    }, [ollamaModelsRefresh, resolvedSettings.baseUrl, settings.apiKey, settings.provider]);

    const updateSettings = (patch: Partial<AssistantSettings>) => {
      setError('');
      setSettings(previous => {
        const next = { ...previous, ...patch };
        saveAssistantSettings(next);
        return next;
      });
    };

    const refreshRosContext = async (forceRefresh = false, expectedGeneration = connectionGeneration) => {
      if (!ros || !isConnected) return null;
      const entry = await rosGraphCacheRef.current.get(ros, expectedGeneration, { forceRefresh });
      if (!entry || currentGenerationRef.current !== expectedGeneration) return null;
      setRosGraph({ resources: entry.result, fetchedAt: entry.fetchedAt, generation: entry.generation });
      return entry.result;
    };

    useEffect(() => {
      if (!isOpen || !ros || !isConnected) return;
      setIsDiscoveringContext(true);
      void refreshRosContext().finally(() => setIsDiscoveringContext(false));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, ros, isConnected, connectionGeneration]);

    const addPinnedChip = (chip: AssistantContextChip) =>
      updatePinnedChips(previous => [...previous.filter(existing => existing.id !== chip.id), chip]);

    const selectedPad = (() => {
      if (!workspace.selectedPadLayoutId) return null;
      const match = readPadLibrary().find(item => item.id === workspace.selectedPadLayoutId || item.layout.id === workspace.selectedPadLayoutId);
      return match ? { name: match.name, layout: match.layout } : null;
    })();
    // `rosGraph?.generation === generation` reads as a match when both sides are undefined, which
    // is how a null graph came to be dereferenced. Compare the graph itself.
    const rosGraphAt = (generation: number) => (rosGraph && rosGraph.generation === generation ? rosGraph : null);
    const liveRosGraph = rosGraphAt(connectionGeneration);
    const activeBridge = getActiveBridge();
    const activeBridgeTree = activeBridge?.getCurrentTree() ?? null;
    const automaticContextLabels = [
      `Workspace · ${workspace.openPanels.length} open`,
      selectedPad ? `Selected Pad · ${selectedPad.name}` : '',
      activeBridgeTree ? `Open BT · ${activeBridgeTree.name}` : '',
      liveRosGraph ? `ROS · ${liveRosGraph.resources.topics.length} topics` : isConnected ? 'ROS · loading' : 'ROS · disconnected',
    ].filter(Boolean);

    const buildAutoContext = (
      discovery: ROSDiscoveryResult | null,
      interfaceSchemas?: AssistantAutoContext['interfaceSchemas']
    ): AssistantAutoContext => {
      const bridge = getActiveBridge();
      const currentTree = bridge?.getCurrentTree() ?? null;
      const selection = bridge?.getSelectedTreeContext() ?? null;
      return {
        workspace,
        ...(discovery && rosGraph ? { ros: {
          resources: discovery, fetchedAt: rosGraph.fetchedAt, generation: rosGraph.generation,
          stale: rosGraph.generation !== connectionGeneration,
        } } : {}),
        ...(currentTree ? { openBehaviorTree: { name: currentTree.name, tree: currentTree } } : {}),
        ...(selection ? { selectedBehaviorTreeNodes: selection.nodes } : {}),
        ...(selectedPad ? { selectedPad } : {}),
        padLibrary: readPadLibrary().map(item => ({ id: item.id, name: item.name, componentCount: item.layout.components.length, isDefault: Boolean(item.isDefault) })),
        behaviorTreeLibrary: readTreeLibrary().map(item => ({ id: item.tree.id, name: item.tree.name, nodeCount: item.tree.nodes.length })),
        ...(interfaceSchemas ? { interfaceSchemas } : {}),
      };
    };

    const describeAutoContext = (auto: AssistantAutoContext): AssistantContextUsage[] => {
      const used: AssistantContextUsage[] = [
        { label: `Workspace (${auto.workspace.openPanels.length} panel${auto.workspace.openPanels.length === 1 ? '' : 's'})`, source: 'workspace', ageSeconds: 0 },
      ];
      if (auto.ros) {
        const resources = auto.ros.resources as ROSDiscoveryResult;
        used.push({
          label: `ROS graph (${resources.topics.length} topics, ${resources.services.length} services, ${resources.actions.length} actions)`,
          source: 'ros', ageSeconds: Math.round((Date.now() - auto.ros.fetchedAt) / 1000), stale: auto.ros.stale,
        });
      }
      if (auto.selectedPad) used.push({ label: `Selected Pad: ${auto.selectedPad.name} (full JSON)`, source: 'pad', ageSeconds: 0 });
      if (auto.openBehaviorTree) used.push({ label: `Open Behavior Tree: ${auto.openBehaviorTree.name} (full JSON)`, source: 'behaviorTree', ageSeconds: 0 });
      if (auto.interfaceSchemas) used.push({ label: 'ROS interface schemas', source: 'ros', ageSeconds: 0 });
      return used;
    };

    /** Runs one context retrieval alongside any others, and registers it so a send can wait for it. */
    const runContextRetrieval = (task: (signal: AbortSignal, generation: number) => Promise<AssistantContextChip | null>) => {
      if (!ros || !isConnected) { setError('Connect to ROS before retrieving live robot context.'); return Promise.resolve(); }
      const controller = new AbortController();
      contextWorkRef.current.add(controller);
      const generation = connectionGeneration;
      setIsDiscoveringContext(true);
      setError('');
      const work = (async () => {
        try {
          const chip = await task(controller.signal, generation);
          if (controller.signal.aborted || currentGenerationRef.current !== generation) throw abortError();
          if (chip) addPinnedChip(chip);
        } catch (cause) {
          if (!isAbortError(cause)) setError(cause instanceof Error ? cause.message : 'Could not retrieve that context.');
        } finally {
          contextWorkRef.current.delete(controller);
          setIsDiscoveringContext(contextWorkRef.current.size > 0);
        }
      })();
      contextResultsRef.current.add(work);
      void work.finally(() => contextResultsRef.current.delete(work));
      return work;
    };

    const retrieveTopic = (name: string, messageType: string) => runContextRetrieval(async (signal, generation) => {
      const [schema, sample] = await Promise.allSettled([
        fetchMessageSchema(ros!, messageType, signal),
        sampleRosTopic(ros!, name, messageType, { signal }),
      ]);
      return {
        id: `ros:topic:${name}`, label: `Topic: ${name}`, mention: name, source: 'ros', automatic: false,
        fetchedAt: Date.now(), generation,
        value: {
          kind: 'topic', name, messageType,
          schema: schema.status === 'fulfilled' ? schema.value : { unavailable: 'Schema lookup failed.' },
          sample: sample.status === 'fulfilled' ? sample.value : { unavailable: 'No sample was captured.' },
        },
      };
    });
    const retrieveService = (name: string, serviceType: string) => runContextRetrieval(async (signal, generation) => ({
      id: `ros:service:${name}`, label: `Service: ${name}`, mention: name, source: 'ros', automatic: false,
      fetchedAt: Date.now(), generation,
      value: { kind: 'service', name, serviceType, requestSchema: await fetchServiceRequestSchema(ros!, serviceType, signal) },
    }));
    const retrieveAction = (name: string, actionType: string) => runContextRetrieval(async (signal, generation) => ({
      id: `ros:action:${name}`, label: `Action: ${name}`, mention: name, source: 'ros', automatic: false,
      fetchedAt: Date.now(), generation,
      value: { kind: 'action', name, actionType, goalSchema: await fetchActionGoalDetails(ros!, actionType, signal) },
    }));

    const requestContextCatalog = () => {
      if (!ros || !isConnected) return;
      const generation = connectionGeneration;
      if (catalog.generation === generation && rosGraphAt(generation)) return;
      const controller = new AbortController();
      contextWorkRef.current.add(controller);
      setIsDiscoveringContext(true);
      void (async () => {
        try {
          await refreshRosContext(false, generation);
          const [nodes, parameters] = await Promise.all([
            fetchRosNodeNames(ros, controller.signal),
            fetchRosParameterNames(ros, controller.signal),
          ]);
          if (!controller.signal.aborted && currentGenerationRef.current === generation) setCatalog({ nodes, parameters, generation });
        } catch (cause) {
          if (!isAbortError(cause)) setError('Some ROS context categories could not be listed on this rosapi deployment.');
        } finally {
          contextWorkRef.current.delete(controller);
          setIsDiscoveringContext(contextWorkRef.current.size > 0);
        }
      })();
    };

    /** Heading text comes from the shared catalog, which is also what the system prompt lists, so
     * the browser and the model cannot describe different context. */
    const catalogSection = (id: ContextCatalogEntry['id']) => {
      const entry = CONTEXT_CATALOG.find(candidate => candidate.id === id)!;
      return { id: entry.id, label: entry.label };
    };

    const contextPickerSections: ContextPickerSection[] = useMemo(() => {
      const isPinned = (id: string) => pinnedChips.some(chip => chip.id === id && !chip.stale);
      const option = (value: ContextPickerOption): ContextPickerOption => ({
        ...value,
        selected: isPinned(value.id),
        onRemove: () => updatePinnedChips(previous => previous.filter(chip => chip.id !== value.id)),
      });
      const sections: ContextPickerSection[] = [];
      // One tag for a whole library, for questions that span it. Bounded by what the libraries hold,
      // and named so the size is not a surprise.
      const allPads = readPadLibrary();
      const allTrees = readTreeLibrary();
      // Always listed, even when a library is empty, so the browser says what exists rather than
      // hiding the answer.
      const bulkOptions: ContextPickerOption[] = [
        option({
          id: 'pad:all', label: 'All Pads and panels', source: 'pad', disabled: allPads.length === 0 && workspace.openPanels.length === 0,
          description: `${allPads.length} Pads and ${workspace.openPanels.length} panels · complete JSON for every one`,
          onSelect: () => addPinnedChip({
            id: 'pad:all', label: `All Pads and panels (${allPads.length + workspace.openPanels.length})`, mention: 'All Pads and panels',
            source: 'pad', automatic: false, fetchedAt: Date.now(),
            value: { pads: allPads.map(item => item.layout), panels: workspace.openPanels },
          }),
        }),
        option({
          id: 'bt:all', label: 'All Behavior Trees', source: 'behaviorTree', disabled: allTrees.length === 0,
          description: allTrees.length ? `${allTrees.length} trees · complete JSON for every one` : 'No saved Behavior Trees yet',
          onSelect: () => addPinnedChip({ id: 'bt:all', label: `All Behavior Trees (${allTrees.length})`, mention: 'All Behavior Trees', source: 'behaviorTree', automatic: false, fetchedAt: Date.now(), value: allTrees.map(item => item.tree) }),
        }),
        option({
          id: 'workspace:everything', label: 'Everything saved', source: 'workspace',
          description: `${allPads.length} Pads, ${allTrees.length} trees, ${workspace.openPanels.length} panels, and every saved layout`,
          onSelect: () => addPinnedChip({
            id: 'workspace:everything', label: 'Everything saved', mention: 'Everything saved', source: 'workspace',
            automatic: false, fetchedAt: Date.now(),
            value: {
              pads: allPads.map(item => item.layout),
              behaviorTrees: allTrees.map(item => item.tree),
              panels: workspace.openPanels,
              layouts: [...(workspace.currentLayout ? [workspace.currentLayout] : []), ...workspace.savedLayouts],
            },
          }),
        }),
      ];
      sections.push({ ...catalogSection('bulk'), description: 'Whole libraries in one tag', options: bulkOptions });

      // What the assistant reads on its own, shown ticked and fixed: it is context the user cannot
      // switch off, so the browser should still account for it rather than look empty.
      sections.push({
        ...catalogSection('automatic'),
        description: 'Read every turn',
        options: automaticContextLabels.map((label, index) => ({
          id: `automatic:${index}`, label, source: 'workspace' as const, description: 'Always included',
          selected: true, disabled: true, onSelect: () => {},
        })),
      });

      const workspaceOptions = workspace.openPanels.map(panel => option({
        id: `workspace:panel:${panel.id}`, label: panel.title, source: 'workspace', description: `${panel.type}${panel.selected ? ' · selected' : ''}`,
        onSelect: () => addPinnedChip({ id: `workspace:panel:${panel.id}`, label: `Panel: ${panel.title}`, mention: panel.title, source: 'workspace', automatic: false, fetchedAt: Date.now(), value: panel }),
      }));
      if (workspace.currentLayout) workspaceOptions.push(option({
        id: 'workspace:layout:current', label: workspace.currentLayout.title, source: 'workspace', description: 'Current workspace layout',
        onSelect: () => addPinnedChip({ id: 'workspace:layout:current', label: `Layout: ${workspace.currentLayout!.title}`, mention: workspace.currentLayout!.title, source: 'workspace', automatic: false, fetchedAt: Date.now(), value: workspace.currentLayout }),
      }));
      workspace.savedLayouts.forEach(layout => workspaceOptions.push(option({
        id: `workspace:layout:${layout.id}`, label: layout.title, source: 'workspace', description: `${layout.panels.length} saved panels`,
        onSelect: () => addPinnedChip({ id: `workspace:layout:${layout.id}`, label: `Saved layout: ${layout.title}`, mention: layout.title, source: 'workspace', automatic: false, fetchedAt: Date.now(), value: layout }),
      })));
      sections.push({ ...catalogSection('workspace'), description: workspace.workspaceMode, options: workspaceOptions });

      const openOptions: ContextPickerOption[] = [];
      if (selectedPad) openOptions.push(option({
        id: `pad:${selectedPad.layout.id}`, label: selectedPad.name, source: 'pad', description: 'Selected Pad · complete JSON',
        onSelect: () => addPinnedChip({ id: `pad:${selectedPad.layout.id}`, label: `Pad: ${selectedPad.name}`, mention: selectedPad.name, source: 'pad', automatic: false, fetchedAt: Date.now(), value: selectedPad.layout }),
      }));
      if (activeBridgeTree) openOptions.push(option({
        id: `bt:${activeBridgeTree.id}`, label: activeBridgeTree.name, source: 'behaviorTree', description: 'Open Behavior Tree · complete JSON',
        onSelect: () => addPinnedChip({ id: `bt:${activeBridgeTree.id}`, label: `BT: ${activeBridgeTree.name}`, mention: activeBridgeTree.name, source: 'behaviorTree', automatic: false, fetchedAt: Date.now(), value: activeBridgeTree }),
      }));
      if (openOptions.length) sections.push({ ...catalogSection('open'), options: openOptions });

      const pads = allPads.map(item => option({
        id: `pad:${item.layout.id}`, label: item.name, source: 'pad', description: `${item.layout.components.length} components · complete JSON`,
        onSelect: () => addPinnedChip({ id: `pad:${item.layout.id}`, label: `Pad: ${item.name}`, mention: item.name, source: 'pad', automatic: false, fetchedAt: Date.now(), value: item.layout }),
      }));
      sections.push({ ...catalogSection('pads'), description: `${pads.length} saved`, options: pads });
      const trees = allTrees.map(item => option({
        id: `bt:${item.tree.id}`, label: item.tree.name, source: 'behaviorTree', description: `${item.tree.nodes.length} nodes · complete JSON`,
        onSelect: () => addPinnedChip({ id: `bt:${item.tree.id}`, label: `BT: ${item.tree.name}`, mention: item.tree.name, source: 'behaviorTree', automatic: false, fetchedAt: Date.now(), value: item.tree }),
      }));
      sections.push({ ...catalogSection('trees'), description: `${trees.length} saved`, options: trees });

      const resources = liveRosGraph?.resources ?? null;
      if (resources) {
        sections.push({ ...catalogSection('topics'), description: 'Schema + bounded live sample', options: resources.topics.map(item => option({ id: `ros:topic:${item.name}`, label: item.name, source: 'ros', description: item.type, onSelect: () => retrieveTopic(item.name, item.type) })) });
        sections.push({ ...catalogSection('services'), description: 'Request schema', options: resources.services.map(item => option({ id: `ros:service:${item.name}`, label: item.name, source: 'ros', description: item.type, onSelect: () => retrieveService(item.name, item.type) })) });
        sections.push({ ...catalogSection('actions'), description: 'Goal schema', options: resources.actions.map(item => option({ id: `ros:action:${item.name}`, label: item.name, source: 'ros', description: item.type, onSelect: () => retrieveAction(item.name, item.type) })) });
      }
      sections.push({ ...catalogSection('nodes'), description: catalog.generation === connectionGeneration ? `${catalog.nodes.length} discovered` : 'Loading from rosapi', options: catalog.nodes.map(name => option({
        id: `ros:node:${name}`, label: name, source: 'ros', description: 'Publishers, subscribers, and services',
        onSelect: () => runContextRetrieval(async (signal, generation) => ({ id: `ros:node:${name}`, label: `Node: ${name}`, mention: name, source: 'ros', automatic: false, fetchedAt: Date.now(), generation, value: await fetchRosNodeDetails(ros!, name, signal) })),
      })) });
      sections.push({ ...catalogSection('parameters'), description: catalog.generation === connectionGeneration ? `${catalog.parameters.length} discovered` : 'Availability depends on rosapi', options: catalog.parameters.map(name => option({
        id: `ros:parameter:${name}`, label: name, source: 'ros', description: 'Current bounded value',
        onSelect: () => runContextRetrieval(async (signal, generation) => ({ id: `ros:parameter:${name}`, label: `Parameter: ${name}`, mention: name, source: 'ros', automatic: false, fetchedAt: Date.now(), generation, value: { name, value: await fetchRosParameterValue(ros!, name, signal) } })),
      })) });
      if (ros && isConnected) sections.push({ ...catalogSection('tf-diagnostics'), options: [
        option({ id: 'tf:snapshot', label: 'TF tree snapshot', source: 'tf', description: 'Frames, components, cycles, and parent conflicts', onSelect: () => runContextRetrieval(async (signal, generation) => ({ id: 'tf:snapshot', label: 'TF tree snapshot', source: 'tf', automatic: false, fetchedAt: Date.now(), generation, value: await captureTfSnapshotOnDemand(ros, 1800, signal) })) }),
        option({ id: 'ros:rosout', label: '/rosout capture', source: 'rosout', description: 'Up to 40 messages for 4 seconds', onSelect: () => runContextRetrieval(async (signal, generation) => ({ id: 'ros:rosout', label: '/rosout capture', source: 'rosout', automatic: false, fetchedAt: Date.now(), generation, value: await captureRosout(ros, signal) })) }),
      ] });
      return sections;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspace, selectedPad?.layout.id, activeBridgeTree?.id, rosGraph, catalog, connectionGeneration, pinnedChips, ros, isConnected]);

    const pushMessage = (message: AssistantMessage) => setMessages(previous => [...previous, message]);
    const updateMessage = (id: string, patch: Partial<AssistantMessage>) =>
      setMessages(previous => previous.map(message => message.id === id ? { ...message, ...patch } : message));

    const fetchTurnSchemas = async (
      discovery: ROSDiscoveryResult,
      needs: ReturnType<typeof computeNeeds>,
      signal: AbortSignal
    ): Promise<{ parser: BehaviorTreeResourceSchemas; context: NonNullable<AssistantAutoContext['interfaceSchemas']> }> => {
      const parser = needs.behaviorTree ? await fetchBehaviorTreeSchemas(ros!, discovery, signal) : { actions: {}, services: {} };
      const context: NonNullable<AssistantAutoContext['interfaceSchemas']> = {
        topics: {}, services: { ...parser.services }, actions: { ...parser.actions },
      };
      const referenced = padReferencedTypes(selectedPad?.layout ?? null);
      const topicTypes = [...new Set([...referenced.topics, ...(needs.pad ? discovery.topics.map(item => item.type) : [])])]
        .filter(Boolean).slice(0, MAX_SCHEMA_TYPES);
      for (const type of topicTypes) {
        const details = await fetchMessageSchema(ros!, type, signal);
        if (details) context.topics[type] = details;
      }
      if (needs.pad) {
        for (const type of referenced.services.slice(0, MAX_SCHEMA_TYPES)) {
          const details = await fetchServiceRequestSchema(ros!, type, signal);
          if (details) context.services[type] = details;
        }
        for (const type of referenced.actions.slice(0, MAX_SCHEMA_TYPES)) {
          const details = await fetchActionGoalDetails(ros!, type, signal);
          if (details) context.actions[type] = details;
        }
      }
      return { parser, context };
    };

    const generateFromPrompt = async (
      rawPrompt: string,
      historyOverride?: AssistantMessage[],
      checkpointOverride?: BehaviorTreeAgentCheckpoint | null,
      attachmentsOverride?: AssistantAttachment[]
    ) => {
      const userText = rawPrompt.trim();
      const turnAttachmentsRequested = attachmentsOverride ?? attachments;
      if ((!userText && turnAttachmentsRequested.length === 0) || isGenerating) return;
      if (!resolvedSettings.baseUrl.trim() || !resolvedSettings.model.trim()) { setError('Set both a base URL and model in Assistant settings before sending.'); return; }
      if (settings.provider !== 'openai-compatible' && settings.provider !== 'ollama' && !settings.apiKey.trim()) { setError(`Add an API key for ${settings.provider} in Assistant settings before sending.`); return; }

      // A resource tagged a moment ago may still be retrieving; sending now would silently drop the
      // context the prompt names.
      if (contextResultsRef.current.size) await Promise.all([...contextResultsRef.current]);
      // Context is what the user put there: a row chosen in the browser, or a resource written as an
      // `@mention`. Both add; only the browser takes away.
      const turnPinnedChips = pinnedChipsRef.current;

      const history = historyOverride ?? messages;
      const bridge = getActiveBridge();
      const checkpoint = checkpointOverride !== undefined ? checkpointOverride : bridge?.captureCheckpoint() ?? null;
      const turnAttachments = turnAttachmentsRequested;
      const userMessage: AssistantMessage = {
        id: uuidv4(), role: 'user', content: userText, attachments: turnAttachments,
        contextChipIds: turnPinnedChips.map(chip => chip.id),
        contextTags: turnPinnedChips.map(chip => ({ id: chip.id, label: chip.label, mention: chip.mention, source: chip.source })),
        checkpoint, createdAt: Date.now(),
      };
      const nextHistory = [...history, userMessage];
      setMessages(nextHistory);
      setPrompt('');
      // Context outlives the prompt: it stays until the user removes it in the browser, so a
      // follow-up question keeps looking at the same resources.
      setAttachments([]);
      setAttachmentError('');
      setClarificationSuggestions(undefined);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const generationAtSend = connectionGeneration;
      setError('');
      setProgress(['Gathering context…']);
      setIsGenerating(true);

      try {
        let discovery = rosGraphAt(generationAtSend)?.resources ?? null;
        if (ros && isConnected) discovery = await refreshRosContext(false, generationAtSend);
        if (controller.signal.aborted || currentGenerationRef.current !== generationAtSend) throw abortError();

        const distanceRequest = parseDistanceRequest(userText);
        const tfRequest = distanceRequest ?? parseTransformRequest(userText);
        if (tfRequest) {
          if (!ros || !isConnected) {
            pushMessage({ id: uuidv4(), role: 'assistant', content: 'Connect to ROS so I can read `/tf` and `/tf_static` and calculate that transform.', attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), contextUsed: [{ label: 'ROS connection: disconnected', source: 'ros', ageSeconds: 0 }] });
          } else {
            setProgress([`Reading /tf and /tf_static for ${tfRequest.sourceFrame} → ${tfRequest.targetFrame}…`]);
            const lookup = await lookupTransformOnDemand(ros, tfRequest.sourceFrame, tfRequest.targetFrame, 4000, controller.signal);
            if (controller.signal.aborted || currentGenerationRef.current !== generationAtSend) throw abortError();
            pushMessage({ id: uuidv4(), role: 'assistant', content: distanceRequest ? formatTfDistanceAnswer(lookup) : formatTfAnswer(lookup), attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), contextUsed: [{ label: `Live TF: ${lookup.resolvedSource ?? lookup.requestedSource} → ${lookup.resolvedTarget ?? lookup.requestedTarget}`, source: 'tf', ageSeconds: 0 }] });
          }
          setProgress([]);
          return;
        }

        const needs = computeNeeds(userText, turnPinnedChips);
        let parserSchemas: BehaviorTreeResourceSchemas = { actions: {}, services: {} };
        let interfaceSchemas: AssistantAutoContext['interfaceSchemas'];
        if (ros && isConnected && discovery && (needs.behaviorTree || needs.pad)) {
          setProgress(['Loading exact ROS interface schemas…']);
          const fetched = await fetchTurnSchemas(discovery, needs, controller.signal);
          parserSchemas = fetched.parser;
          interfaceSchemas = fetched.context;
        }

        const turnChips = turnPinnedChips.map(chip =>
          chip.generation !== undefined && chip.generation !== generationAtSend ? { ...chip, stale: true } : chip
        );
        if (ros && isConnected && /(?:\btf\b|transform).*(?:disconnect|cycle|parent|missing)|(?:disconnect|cycle|missing).*\btf\b/i.test(userText)) {
          setProgress(['Capturing a bounded TF graph snapshot…']);
          const tfSnapshot = await captureTfSnapshotOnDemand(ros, 1800, controller.signal);
          turnChips.push({ id: 'tf:turn-snapshot', label: 'Live TF graph snapshot', source: 'tf', automatic: false, fetchedAt: Date.now(), generation: generationAtSend, value: tfSnapshot });
        }
        if (ros && isConnected && /\brosout\b|\/rosout|recent ros (?:errors?|logs?)/i.test(userText)) {
          setProgress(['Capturing bounded /rosout messages…']);
          const rosout = await captureRosout(ros, controller.signal);
          turnChips.push({ id: 'rosout:turn', label: 'Live /rosout capture', source: 'rosout', automatic: false, fetchedAt: Date.now(), generation: generationAtSend, value: rosout });
        }
        if (ros && isConnected && discovery && /\b(sample|latest|current value|current message|read)\b/i.test(userText)) {
          const namedTopic = discovery.topics.find(item => userText.includes(item.name));
          if (namedTopic) {
            setProgress([`Sampling ${namedTopic.name}…`]);
            const [schema, sample] = await Promise.all([
              fetchMessageSchema(ros, namedTopic.type, controller.signal),
              sampleRosTopic(ros, namedTopic.name, namedTopic.type, { signal: controller.signal }),
            ]);
            turnChips.push({ id: `ros:turn-topic:${namedTopic.name}`, label: `Live topic: ${namedTopic.name}`, source: 'ros', automatic: false, fetchedAt: Date.now(), generation: generationAtSend, value: { ...namedTopic, schema, sample } });
          }
        }
        if (controller.signal.aborted || currentGenerationRef.current !== generationAtSend) throw abortError();

        const autoContext = buildAutoContext(discovery, interfaceSchemas);
        const contextUsed: AssistantContextUsage[] = [
          ...describeAutoContext(autoContext),
          ...turnChips.map(chip => ({ label: `Selected: ${chip.label}`, source: chip.source, ageSeconds: Math.round((Date.now() - chip.fetchedAt) / 1000), stale: chip.stale })),
        ];
        const systemPrompt = composeAssistantSystemPrompt({ settings, autoContext, pinnedChips: turnChips, needs });
        const chatMessages: AssistantChatTurn[] = nextHistory.map(message => ({
          role: message.role,
          content: message.content
            || 'The user sent these attachments without a message. Describe or answer what they show.',
        }));
        const lastIndex = chatMessages.length - 1;
        const imageAttachments = turnAttachments.filter(item => item.kind === 'image');
        const textAttachments = turnAttachments.filter(item => item.kind === 'text');
        if (imageAttachments.length) chatMessages[lastIndex] = { ...chatMessages[lastIndex], images: imageAttachments.map(item => ({ mimeType: item.mimeType, data: item.content })) };
        if (textAttachments.length) chatMessages[lastIndex] = { ...chatMessages[lastIndex], content: `${chatMessages[lastIndex].content}\n\nAttached files:\n${textAttachments.map(item => `### ${item.name}\n${item.content}`).join('\n\n')}` };

        setProgress(['Waiting for the model…']);
        const raw = await sendAssistantChat({
          settings: resolvedSettings, systemPrompt, messages: chatMessages, signal: controller.signal, jsonMode: true,
          onProgress: message => { if (abortRef.current === controller && !controller.signal.aborted) setProgress([message]); },
        });
        if (controller.signal.aborted || currentGenerationRef.current !== generationAtSend) throw abortError();
        setProgress(['Parsing response…']);
        const response = parseAssistantResponse(raw, parserSchemas);

        if (response.kind === 'explanation') {
          pushMessage({ id: uuidv4(), role: 'assistant', content: response.message, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), contextUsed });
        } else if (response.kind === 'clarification') {
          setClarificationSuggestions(response.suggestions);
          pushMessage({ id: uuidv4(), role: 'assistant', content: response.question, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), contextUsed });
        } else if (response.kind === 'behaviorTree') {
          if (bridge) {
            bridge.applyPreview(response.tree);
            pushMessage({ id: uuidv4(), role: 'assistant', content: `Built “${response.tree.name}” and opened its preview on the current Behavior Tree canvas. Accept or reject it there.`, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), response, resolution: 'applied', contextUsed });
          } else {
            pushMessage({ id: uuidv4(), role: 'assistant', content: `Built “${response.tree.name}”. Open a Behavior Tree panel to preview changes, or save this proposal to the library.`, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), response, contextUsed });
          }
        } else if (response.kind === 'padProposal') {
          const issues = discovery ? validatePadAgainstRos(response.layout, discovery) : [];
          pushMessage({ id: uuidv4(), role: 'assistant', content: `Built Pad “${response.layout.name}”. Review its complete layout and bindings in the Pad editor before saving.`, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), response: { ...response, issues }, contextUsed });
        } else {
          const issues = discovery ? validateRosActionProposal(response.operation, discovery) : [];
          pushMessage({ id: uuidv4(), role: 'assistant', content: response.rationale || `Proposed ${response.operation.kind} “${response.operation.name}”.`, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), response: { ...response, issues }, contextUsed });
        }
        setProgress([]);
      } catch (cause) {
        setProgress([]);
        if (!isAbortError(cause) && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The assistant request failed.');
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsGenerating(false);
        }
      }
    };

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
    const handleEditMessage = (messageIndex: number, nextText: string) => {
      const message = messages[messageIndex];
      if (!message) return;
      abortRef.current?.abort();
      if (message.checkpoint) getActiveBridge()?.restoreCheckpoint(message.checkpoint);
      const history = messages.slice(0, messageIndex);
      setMessages(history);
      setClarificationSuggestions(undefined);
      setProgress([]);
      setError('');
      void generateFromPrompt(nextText, history, message.checkpoint, message.attachments);
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
      if (!files.length) return;
      setAttachmentError('');
      if (attachments.length + files.length > MAX_ATTACHMENTS) { setAttachmentError(`Attach up to ${MAX_ATTACHMENTS} files per message.`); return; }
      if (attachments.reduce((total, item) => total + item.size, 0) + files.reduce((total, file) => total + file.size, 0) > MAX_ATTACHMENT_TOTAL_SIZE) { setAttachmentError('Attachments can use up to 12 MB per message.'); return; }
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
      if (attachments.length >= MAX_ATTACHMENTS) { setAttachmentError(`Attach up to ${MAX_ATTACHMENTS} files per message.`); return; }
      if (size > MAX_ATTACHMENT_SIZE) { setAttachmentError('The sketch is larger than 5 MB. Clear some detail and try again.'); return; }
      const timestamp = Date.now();
      setAttachments(previous => [...previous, { id: `sketch:${timestamp}`, name: `sketch-${timestamp}.png`, mimeType: 'image/png', size, kind: 'image', content }]);
    };
    const handleReviewPad = (messageId: string) => {
      const message = messages.find(item => item.id === messageId);
      if (!message || message.response?.kind !== 'padProposal' || !onReviewPadProposal) return;
      onReviewPadProposal(message.response.layout);
      updateMessage(messageId, { resolution: 'applied' });
    };
    const handleSaveTree = (messageId: string) => {
      const message = messages.find(item => item.id === messageId);
      if (!message || message.response?.kind !== 'behaviorTree') return;
      saveBehaviorTree(message.response.tree);
      updateMessage(messageId, { resolution: 'saved' });
    };

    return (
      <>
      {!isOpen && (
        <button type="button" className="assistant-launcher" onClick={() => setIsOpen(true)} aria-label="Open Robo-Boy assistant" title="Robo-Boy assistant">
          <HiSparkles aria-hidden="true" />
        </button>
      )}
      <AssistantPanel
        open={isOpen}
        onClose={closeAssistant}
        messages={messages}
        isGenerating={isGenerating}
        progressMessages={progress}
        error={error}
        clarificationSuggestions={clarificationSuggestions}
        onSelectSuggestion={setPrompt}
        prompt={prompt}
        onPromptChange={setPrompt}
        onSubmit={() => void generateFromPrompt(prompt)}
        onStop={() => abortRef.current?.abort()}
        onNewConversation={handleNewConversation}
        onRepeat={handleRepeat}
        onEditMessage={handleEditMessage}
        automaticContextLabels={automaticContextLabels}
        onOpenResource={onOpenResource}
        canOpenResource={canOpenResource}
        contextPickerSections={contextPickerSections}
        onRequestContextCatalog={requestContextCatalog}
        isDiscoveringContext={isDiscoveringContext}
        attachments={attachments}
        attachmentError={attachmentError}
        onAttachFiles={handleAttachFiles}
        onTranscribeAudio={audio => transcribeAssistantAudio(audio, resolvedSettings)}
        onRemoveAttachment={id => setAttachments(previous => previous.filter(item => item.id !== id))}
        onSketchAttach={handleSketchAttach}
        settings={settings}
        resolvedBaseUrl={resolvedSettings.baseUrl}
        onProviderChange={(provider: AssistantProviderId) => updateSettings({ provider, apiKey: '', ...getProviderDefaults(provider), ...(provider === 'ollama' ? { ollamaUseBackendHost: true } : {}) })}
        onUpdateSettings={updateSettings}
        ollamaModels={ollamaModels}
        ollamaModelsError={ollamaModelsError}
        isLoadingOllamaModels={isLoadingOllamaModels}
        onRefreshOllamaModels={() => setOllamaModelsRefresh(value => value + 1)}
        onReviewPadProposal={handleReviewPad}
        onSaveBehaviorTreeProposal={handleSaveTree}
        hasActiveBehaviorTreeBridge={Boolean(activeBridge)}
      />
      </>
    );
  }
);

GlobalAssistant.displayName = 'GlobalAssistant';
export default GlobalAssistant;
