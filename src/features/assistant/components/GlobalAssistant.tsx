import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import { v4 as uuidv4 } from 'uuid';
import { useRuntimeConfig } from '../../../runtime/runtimeConfig';
import { HiSparkles } from 'react-icons/hi2';
import { fetchActionGoalDetails, fetchMessageSchema, fetchServiceRequestSchema, type ActionGoalDetails } from '../../behaviorTree/services/rosDiscovery';
import { listBehaviorTrees, saveBehaviorTree, deleteBehaviorTree } from '../../behaviorTree/storage/treeStorage';
import type { BehaviorTreeAgentCheckpoint, BehaviorTreeResourceSchemas } from '../../behaviorTree/agent/types';
import type { ROSDiscoveryResult } from '../../behaviorTree/types';
import { loadGamepadLibrary, saveCustomGamepad, deleteCustomGamepad } from '../../customGamepad/gamepadStorage';
import type { CustomGamepadLayout } from '../../customGamepad/types';
import { createRosGraphCache } from '../context/rosGraphCache';
import { timeSeriesContextTopics } from '../context/timeSeriesContext';
import { cameraFrameTopics, captureCameraFrame, wantsCameraFrame, type CameraFrame } from '../context/cameraContext';
import { padDisplayBindings, readPadValues, wantsPadValues } from '../context/padContext';
import { CONTEXT_CATALOG, type ContextCatalogEntry } from '../capabilities';
import {
  captureRosout,
  fetchRosNodeDetails,
  fetchRosNodeNames,
  fetchRosParameterNames,
  fetchRosParameterValue,
  sampleRosTopic,
} from '../context/rosContext';
import { captureTfSnapshotOnDemand, lookupTransformOnDemand } from '../context/tfContext';
import { computeNeeds } from '../turnNeeds';
import { sendAssistantChat, fetchOllamaModels, type AssistantChatTurn, type AssistantProviderId, type AssistantProviderSettings } from '../providers/index';
import { parseAssistantResponse } from '../responseParser';
import { createHostTools } from '../tools/hostTools';
import { documentRevision, HOST_TOOL_DEFINITIONS } from '../tools/nativeTools';
import { composeNativeSystemPrompt } from '../prompt';
import { readAssistantContext } from '../tools/contextReader';
import { AgentRun, AgentYield, InputQueue, type AgentEvent, type InputDelivery, type PendingInput } from '../runtime/session';
import { DocumentChanges, documentDiff, type DocumentKind } from '../tools/documents';
import { validateTreeBindings } from '../tools/treeValidation';
import { normalizePadLayout } from '../tools/padGeneration';
import type { BehaviorTree } from '../../behaviorTree/types';
import type { PadDraftReader } from '../types';
import { loadSkills } from '../runtime/skills';
import { loadAgentSessions, newAgentSession, snapshotAgentSession, storeAgentSessions } from '../storage/sessionStorage';
import { TopicMonitor, type MonitorStatus } from '../runtime/monitors';
import { getDesktopBridge } from '../../../runtime/desktopBridge';
import { loadAgentProfiles } from '../runtime/profiles';
import { transcribeAssistantAudio } from '../providers/transcription';
import { getProviderDefaults, loadAssistantConversation, saveAssistantConversation } from '../storage/assistantStorage';
import { useAssistantSettings } from '../storage/useAssistantSettings';
import { validatePadAgainstRos } from '../tools/padValidator';
import { validateRosActionProposal } from '../tools/rosActionValidator';
import { resolvePanelType, type WorkspaceEditOperation, type WorkspaceEditResult } from '../tools/workspaceTool';
import type {
  AssistantAttachment,
  AssistantAutoContext,
  AssistantContextChip,
  AssistantContextUsage,
  AssistantMessage,
  AssistantResponse,
  AssistantSettings,
  BehaviorTreeAssistantBridge,
  OpenAssistantOptions,
  WorkspaceSnapshot,
 PanelSettingsBridge,
} from '../types';
import AssistantPanel, { type ContextPickerOption, type ContextPickerSection } from './AssistantPanel';

export interface GlobalAssistantHandle {
  open: (options?: OpenAssistantOptions) => void;
  toggle: () => void;
  registerBehaviorTreeBridge: (panelId: string, bridge: BehaviorTreeAssistantBridge | null) => void;
  /** A panel that can report and change its own settings (see `PanelSettingsBridge`). */
  registerPanelSettingsBridge: (panelId: string, bridge: PanelSettingsBridge | null) => void;
  registerPadDraftReader: (reader: (() => CustomGamepadLayout) | null) => void;
}

export interface GlobalAssistantProps {
  ros: Ros | null;
  /** What camera, 3D and plot panels show: the open recording during replay, else the live robot. */
  visualizationRos?: Ros | null;
  isConnected: boolean;
  connectionGeneration: number;
  workspace: WorkspaceSnapshot;
  onReviewPadProposal?: (layout: CustomGamepadLayout) => void;
  /** Opens a tagged resource in the view that owns it. Returns false when it has no such view. */
  onOpenResource?: (resourceId: string) => boolean;
  /** Whether that resource has a view to open at all, asked before a tag is drawn as clickable. */
  canOpenResource?: (resourceId: string) => boolean;
  /** Applies the workspace tool's operations in order and reports each outcome. Absent when the
   * host cannot edit the workspace (nothing is mounted to do it), in which case the assistant
   * says so instead of pretending. */
  onApplyWorkspaceEdit?: (operations: WorkspaceEditOperation[]) => WorkspaceEditResult[];
}

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

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_SIZE = 12 * 1024 * 1024;
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


/** Topics of a ROS source that has no discovery cache, such as an open recording. */
const listRosTopics = (source: Ros) =>
  new Promise<Array<{ name: string; type: string }>>(resolve => {
    const timer = setTimeout(() => resolve([]), 3000);
    source.getTopics(result => {
      clearTimeout(timer);
      resolve(result.topics.map((name, index) => ({ name, type: result.types[index] ?? '' })));
    }, () => { clearTimeout(timer); resolve([]); });
  });

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


const GlobalAssistant = forwardRef<GlobalAssistantHandle, GlobalAssistantProps>(
  ({ ros, visualizationRos, isConnected, connectionGeneration, workspace, onReviewPadProposal, onOpenResource, canOpenResource, onApplyWorkspaceEdit }, ref) => {
    const runtime = useRuntimeConfig();
    const [isOpen, setIsOpen] = useState(false);
    const compact = useCompactAssistant();
    const { settings, updateSettings: persistSettings, storageError, loadingCredentials, apiKeyStorage, updateApiKeyStorage } = useAssistantSettings();
    const conversationScope = workspace.connections?.current ?? 'default';
    const [loadedConversationScope, setLoadedConversationScope] = useState(conversationScope);
    const [sessions, setSessions] = useState(() => loadAgentSessions(conversationScope, loadAssistantConversation(conversationScope)));
    const [messages, setMessages] = useState<AssistantMessage[]>(() => (sessions.sessions.find(item => item.id === sessions.activeId)?.messages ?? []).map(stored => ({
      ...stored, id: uuidv4(), attachments: [], contextChipIds: [], checkpoint: null, ...(stored.response ? { proposedAtGeneration: -1 } : {}),
    })));
    const [prompt, setPrompt] = useState('');
    const [progress, setProgress] = useState<string[]>([]);
    const [thinking, setThinking] = useState('');
    const [streamedAnswer, setStreamedAnswer] = useState('');
    const [error, setError] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [clarificationSuggestions, setClarificationSuggestions] = useState<string[] | undefined>();
    const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
    const [attachmentError, setAttachmentError] = useState('');
    const [pinnedChips, setPinnedChips] = useState<AssistantContextChip[]>([]);
    /** Mirrors `pinnedChips` so a send that just awaited a retrieval reads the chip it waited for,
     * without waiting for React to re-render first. */
    const pinnedChipsRef = useRef<AssistantContextChip[]>([]);
    const observationsRef = useRef<AssistantContextChip[]>([]);
    const padDraftReaderRef = useRef<PadDraftReader | null>(null);
    const changesRef = useRef(new Map<string, DocumentChanges>());
    const [documentChanges, setDocumentChanges] = useState<Array<{ id: string; label: string; diff: string }>>([]);
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
    const panelBridgesRef = useRef<Map<string, PanelSettingsBridge>>(new Map());
    const panelBridgeWaitersRef = useRef(new Set<() => void>());
    const workspaceRef = useRef(workspace);
    workspaceRef.current = workspace;
    const applyWorkspaceEditRef = useRef(onApplyWorkspaceEdit);
    applyWorkspaceEditRef.current = onApplyWorkspaceEdit;
    const lastRegisteredBridgeIdRef = useRef<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const runRef = useRef<AgentRun | null>(null);
    const nativeHistoryRef = useRef<{ provider: string; messages: import('ai').ModelMessage[] }>();
    const historyBranchRef = useRef(uuidv4());
    const inputQueueRef = useRef(new InputQueue());
    const [pendingInputs, setPendingInputs] = useState<PendingInput[]>([]);
    const [events, setEvents] = useState<AgentEvent[]>([]);
    const monitorsRef = useRef(new Map<string, TopicMonitor>());
    const [monitors, setMonitors] = useState<MonitorStatus[]>([]);
    const activeSessionRef = useRef(sessions.activeId); activeSessionRef.current = sessions.activeId;
    const historyRef = useRef(messages);
    historyRef.current = messages;
    /** Every in-flight context retrieval. They are independent -- tagging a second resource must not
     * cancel the first -- and are aborted together when the assistant closes or ROS reconnects. */
    const contextWorkRef = useRef<Set<AbortController>>(new Set());
    const contextResultsRef = useRef<Set<Promise<unknown>>>(new Set());
    const rosGraphCacheRef = useRef(createRosGraphCache());
    const currentGenerationRef = useRef(connectionGeneration);
    currentGenerationRef.current = connectionGeneration;
    const currentRosRef = useRef(ros);
    currentRosRef.current = ros;

    const abortContextWork = useCallback(() => {
      contextWorkRef.current.forEach(controller => controller.abort());
      contextWorkRef.current.clear();
    }, []);

    const abandonTurn = useCallback(() => {
      const run = runRef.current;
      runRef.current = null; abortRef.current = null;
      run?.cancel();
      inputQueueRef.current.items = []; setPendingInputs([]);
      setIsGenerating(false); setStreamedAnswer(''); setThinking(''); setEvents([]);
    }, []);
    const closeAssistant = useCallback(() => {
      // The panel is a view of the connection-owned task, not the task's lifetime.
      // Hiding it must not be equivalent to Stop, chat switching or reconnecting.
      setIsOpen(false);
    }, []);

    useLayoutEffect(() => {
      document.documentElement.classList.toggle('assistant-is-open', isOpen);
      return () => document.documentElement.classList.remove('assistant-is-open');
    }, [isOpen]);
    useEffect(() => () => {
      inputQueueRef.current.items = [];
      runRef.current?.cancel();
      abortContextWork();
      for (const monitor of monitorsRef.current.values()) monitor.stop();
      void getDesktopBridge()?.assistant?.setBackgroundActive?.(false);
    }, [abortContextWork]);
    useEffect(() => {
      abandonTurn();
      abortContextWork();
      rosGraphCacheRef.current.clear();
      for (const monitor of monitorsRef.current.values()) monitor.stop();
      monitorsRef.current.clear(); setMonitors([]);
      nativeHistoryRef.current = undefined;
      historyBranchRef.current = uuidv4();
      setRosGraph(null);
      setCatalog({ nodes: [], parameters: [], generation: -1 });
      updatePinnedChips(previous => previous.map(chip => chip.generation === undefined ? chip : { ...chip, stale: true }));
      setProgress([]);
    }, [connectionGeneration, ros, abandonTurn]);
    useEffect(() => {
      if (!settings.monitorEnabled) for (const monitor of monitorsRef.current.values()) monitor.stop();
      void getDesktopBridge()?.assistant?.setBackgroundActive?.(Boolean(settings.monitorBackground && monitors.some(monitor => monitor.status !== 'stopped'))).catch(cause => setError(`Background monitoring unavailable: ${String(cause)}`));
    }, [settings.monitorEnabled, settings.monitorBackground, monitors]);
    useEffect(() => getDesktopBridge()?.assistant?.onStopMonitors?.(() => { for (const monitor of monitorsRef.current.values()) monitor.stop(); }), []);
    useEffect(() => {
      if (loadedConversationScope === conversationScope) return;
      abandonTurn(); abortContextWork();
      observationsRef.current = [];
      nativeHistoryRef.current = undefined;
      historyBranchRef.current = uuidv4();
      updatePinnedChips(() => []);
      const next = loadAgentSessions(conversationScope, loadAssistantConversation(conversationScope)); setSessions(next);
      setMessages((next.sessions.find(item => item.id === next.activeId)?.messages ?? []).map(stored => ({ id: uuidv4(), ...stored, attachments: [], contextChipIds: [], checkpoint: null, ...(stored.response ? { proposedAtGeneration: -1 } : {}) })));
      setLoadedConversationScope(conversationScope);
    }, [conversationScope, loadedConversationScope, abortContextWork, abandonTurn]);
    useEffect(() => {
      if (loadedConversationScope !== conversationScope) return;
      saveAssistantConversation(messages.map(message => ({ role: message.role, content: message.content, createdAt: message.createdAt })), conversationScope);
      try {
        storeAgentSessions(conversationScope, { ...sessions, sessions: sessions.sessions.map(session => session.id === sessions.activeId ? snapshotAgentSession(session, messages) : session) });
      } catch (cause) { setError(String(cause)); }
    }, [messages, conversationScope, loadedConversationScope, sessions]);

    const resolvedSettings: AssistantProviderSettings = useMemo(() => ({
      provider: settings.provider,
      authMode: settings.authMode,
      apiKey: settings.apiKey,
      model: settings.model,
      thinkingEffort: settings.thinkingEffort,
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
      registerPanelSettingsBridge: (panelId, bridge) => {
        if (bridge) panelBridgesRef.current.set(panelId, bridge);
        else panelBridgesRef.current.delete(panelId);
        panelBridgeWaitersRef.current.forEach(check => check());
      },
      registerPadDraftReader: reader => { padDraftReaderRef.current = reader; },
    }), [pinnedBehaviorTreePanelId]);

    /** The workspace snapshot with each bridged panel's live settings folded in, read at send
     * time so the model sees what the panel shows now, not what it showed at the last render. */
    const workspaceWithPanelSettings = (): WorkspaceSnapshot => ({
      ...workspaceRef.current,
      openPanels: workspaceRef.current.openPanels.map(panel => {
        const bridge = panelBridgesRef.current.get(panel.id.replace(/^mobile:/, ''));
        return bridge ? { ...panel, settings: bridge.describe(), settingsHelp: bridge.settingsHelp } : panel;
      }),
    });

    /** `configurePanel` is answered by the panel itself; everything else by the host. */
    const waitForPanelBridge = (panelId: string, panelType: string, signal: AbortSignal): Promise<PanelSettingsBridge | undefined> =>
      new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', cancel);
          panelBridgeWaitersRef.current.delete(check);
        };
        const cancel = () => { cleanup(); reject(abortError()); };
        const check = () => {
          const bridge = panelBridgesRef.current.get(panelId);
          if (bridge?.panelType === panelType) { cleanup(); resolve(bridge); }
        };
        const timer = setTimeout(() => { cleanup(); resolve(undefined); }, 5000);
        panelBridgeWaitersRef.current.add(check);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        else check();
      });

    const applyWorkspaceOperations = async (operations: WorkspaceEditOperation[], signal: AbortSignal): Promise<WorkspaceEditResult[]> => {
      const results: WorkspaceEditResult[] = [];
      const added = new Map<string, string>();
      for (let index = 0; index < operations.length;) {
        signal.throwIfAborted();
        const operation = operations[index];
        // Layout saves read committed React state. Preserve the host's safeguard across batches
        // separated by a panel-settings operation rather than saving a stale configuration.
        if (operation.op === 'saveLayout' && results.some(result => result.ok && result.operation.op !== 'saveLayout')) {
          results.push({ operation, ok: false, message: 'Ask again to save once the changes above are on screen.' });
          index++;
          continue;
        }
        if (operation.op !== 'configurePanel') {
          // Keep adjacent host operations batched for atomic mobile remove + add handling.
          const start = index;
          while (index < operations.length && operations[index].op !== 'configurePanel' && (index === start || operations[index].op !== 'saveLayout')) index++;
          const batch = operations.slice(start, index);
          const hostResults: WorkspaceEditResult[] = applyWorkspaceEditRef.current?.(batch) ?? batch.map(operation => ({ operation, ok: false, message: 'The workspace cannot be edited from here.' }));
          for (const result of hostResults) {
            if (result.ok && result.panelId && result.operation.op === 'addPanel') {
              const type = resolvePanelType(result.operation.panelType, workspaceRef.current.panelCatalog);
              if (type) added.set(type, result.panelId);
            }
          }
          results.push(...hostResults);
          continue;
        }
        index++;
        const panelType = operation.panelType && (resolvePanelType(operation.panelType, workspaceRef.current.panelCatalog) ?? operation.panelType);
        const newPanelId = panelType && added.get(panelType);
        const wantedId = operation.panelId?.replace(/^mobile:/, '') ?? newPanelId;
        const bridge = wantedId && newPanelId === wantedId
          ? await waitForPanelBridge(wantedId, panelType!, signal)
          : wantedId ? panelBridgesRef.current.get(wantedId)
            : [...panelBridgesRef.current.values()].find(candidate => candidate.panelType === panelType);
        signal.throwIfAborted();
        if (!bridge) {
          const target = wantedId ? `panel "${wantedId}"` : `a ${operation.panelType} panel`;
          results.push({ operation, ok: false, message: `No open ${target} can be configured from here.` });
          continue;
        }
        let outcomes: Awaited<ReturnType<PanelSettingsBridge['apply']>>;
        try {
          outcomes = await bridge.apply(operation.settings);
        } catch (cause) {
          outcomes = [{ ok: false, message: cause instanceof Error ? cause.message : 'The panel could not apply those settings.' }];
        }
        signal.throwIfAborted();
        results.push({
          operation,
          ok: outcomes.length > 0 && outcomes.every(outcome => outcome.ok),
          message: outcomes.length ? outcomes.map(outcome => `${outcome.ok ? '' : '✗ '}${outcome.message}`).join(' ') : 'Nothing in those settings applied.',
        });
      }
      return results;
    };

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
          if (!controller.signal.aborted && models.length && !models.includes(settings.model)) persistSettings({ model: models[0] });
        } catch (cause) {
          if (!controller.signal.aborted) setOllamaModelsError(cause instanceof Error ? cause.message : 'Could not load Ollama models.');
        } finally {
          if (!controller.signal.aborted) setIsLoadingOllamaModels(false);
        }
      }, 250);
      return () => { window.clearTimeout(timeout); controller.abort(); };
    }, [ollamaModelsRefresh, resolvedSettings.baseUrl, settings.apiKey, settings.provider]);

    const updateSettings = (patch: Partial<AssistantSettings>) => {
      abandonTurn();
      nativeHistoryRef.current = undefined;
      historyBranchRef.current = uuidv4();
      if (patch.provider !== undefined || patch.authMode !== undefined || patch.model !== undefined || patch.apiKey !== undefined) for (const monitor of monitorsRef.current.values()) monitor.stop();
      setError('');
      persistSettings(patch);
    };

    const refreshRosContext = async (forceRefresh = false, expectedGeneration = connectionGeneration, signal?: AbortSignal) => {
      if (!ros || !isConnected) return null;
      const entry = await rosGraphCacheRef.current.get(ros, expectedGeneration, { forceRefresh, signal });
      if (!entry || currentGenerationRef.current !== expectedGeneration) return null;
      setRosGraph({ resources: entry.result, fetchedAt: entry.fetchedAt, generation: entry.generation });
      return entry.result;
    };

    useEffect(() => {
      if (!isOpen || !ros || !isConnected) return;
      setIsDiscoveringContext(true);
      void refreshRosContext().finally(() => setIsDiscoveringContext(false));
      // Nodes and parameters used to be fetched when the Context browser opened. Nothing opens now,
      // so they are fetched with everything else.
      requestContextCatalog();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, ros, isConnected, connectionGeneration]);

    const addPinnedChip = (chip: AssistantContextChip) =>
      updatePinnedChips(previous => [...previous.filter(existing => existing.id !== chip.id), chip]);

    const selectedPad = (() => {
      const draft = padDraftReaderRef.current?.();
      if (draft) return { name: draft.name, layout: draft };
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

    const buildAutoContext = (
      discovery: ROSDiscoveryResult | null,
      interfaceSchemas?: AssistantAutoContext['interfaceSchemas']
    ): AssistantAutoContext => {
      const bridge = getActiveBridge();
      const currentTree = bridge?.getCurrentTree() ?? null;
      const selection = bridge?.getSelectedTreeContext() ?? null;
      return {
        workspace: workspaceWithPanelSettings(),
        assistantSettings: {
          provider: settings.provider,
          model: resolvedSettings.model,
          ...(settings.authMode ? { authMode: settings.authMode } : {}),
          ...(settings.thinkingEffort ? { thinkingEffort: settings.thinkingEffort } : {}),
        },
        ...(discovery ? { ros: {
          resources: discovery, fetchedAt: rosGraphAt(connectionGeneration)?.fetchedAt ?? Date.now(), generation: connectionGeneration,
          stale: false,
        } } : {}),
        ...(currentTree ? { openBehaviorTree: { name: currentTree.name, tree: currentTree } } : {}),
        ...(selection ? { selectedBehaviorTreeNodes: selection.nodes } : {}),
        ...(selectedPad ? { selectedPad } : {}),
        ...(catalog.generation === connectionGeneration ? { rosCatalog: { nodes: catalog.nodes, parameters: catalog.parameters } } : {}),
        padLibrary: readPadLibrary().map(item => ({ id: item.id, name: item.name, isDefault: Boolean(item.isDefault), layout: item.layout })),
        behaviorTreeLibrary: readTreeLibrary().map(item => ({ id: item.tree.id, name: item.tree.name, tree: item.tree })),
        pendingDocuments: historyRef.current.flatMap(message => {
          const response = message.response;
          if (message.resolution || !response || !['padProposal', 'behaviorTree'].includes(response.kind)) return [];
          const document = response.kind === 'padProposal' ? response.layout : response.kind === 'behaviorTree' ? response.tree : null;
          return document ? [{ id: `proposal:${document.id}`, documentId: document.id, name: document.name, kind: response.kind === 'padProposal' ? 'pad' as const : 'behaviorTree' as const, needsRevalidation: true }] : [];
        }),
        ...(interfaceSchemas && Object.values(interfaceSchemas).some(bucket => Object.keys(bucket).length) ? { interfaceSchemas } : {}),
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
      if (auto.selectedPad) used.push({ label: `Selected Pad reference: ${auto.selectedPad.name}`, source: 'pad', ageSeconds: 0 });
      if (auto.openBehaviorTree) used.push({ label: `Open Behavior Tree reference: ${auto.openBehaviorTree.name}`, source: 'behaviorTree', ageSeconds: 0 });
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
      const option = (value: ContextPickerOption): ContextPickerOption => ({ ...value, selected: isPinned(value.id) });
      const sections: ContextPickerSection[] = [];
      // One tag for a whole library, for questions that span it. Bounded by what the libraries hold,
      // and named so the size is not a surprise.
      const allPads = readPadLibrary();
      const allTrees = readTreeLibrary();
      const workspaceOptions = workspace.openPanels.map(panel => option({
        id: `workspace:panel:${panel.id}`, label: panel.title, source: 'workspace',
        description: `${panel.type}${panel.selected ? ' · selected' : ''}`,
        onSelect: () => addPinnedChip({ id: `workspace:panel:${panel.id}`, label: `Panel: ${panel.title}`, mention: panel.title, source: 'workspace', automatic: false, fetchedAt: Date.now(), value: panel }),
      }));
      if (workspace.currentLayout) workspaceOptions.push(option({
        id: 'workspace:layout:current', label: workspace.currentLayout.title, source: 'workspace',
        description: 'Current workspace layout',
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

    const pushMessage = (message: AssistantMessage) => { historyRef.current = [...historyRef.current, message]; setMessages(historyRef.current); };
    const readSavedDocument = (kind: DocumentKind, id: string): unknown => kind === 'pad'
      ? readPadLibrary().find(item => item.layout.id === id)?.layout
      : readTreeLibrary().find(item => item.tree.id === id)?.tree;
    const readDocument = (kind: DocumentKind, id: string): unknown => {
      if (id.startsWith('proposal:')) {
        const documentId = id.slice('proposal:'.length);
        for (const message of [...historyRef.current].reverse()) {
          if (message.resolution === 'rejected') continue;
          if (kind === 'pad' && message.response?.kind === 'padProposal' && message.response.layout.id === documentId) return message.response.layout;
          if (kind === 'behaviorTree' && message.response?.kind === 'behaviorTree' && message.response.tree.id === documentId) return message.response.tree;
        }
        return undefined;
      }
      if (kind === 'pad') { const draft = padDraftReaderRef.current?.(); return draft?.id === id ? draft : readSavedDocument(kind, id); }
      return [...bridgesRef.current.values()].map(bridge => bridge.getCurrentTree()).find(tree => tree?.id === id) ?? readSavedDocument(kind, id);
    };
    const documentJournal = () => {
      let journal = changesRef.current.get(conversationScope);
      if (!journal) {
        journal = new DocumentChanges({ read: readSavedDocument,
          save: (kind, document) => kind === 'pad' ? saveCustomGamepad(document as CustomGamepadLayout) : saveBehaviorTree(document as BehaviorTree),
          remove: (kind, id) => kind === 'pad' ? deleteCustomGamepad(id) : deleteBehaviorTree(id),
        }, `robo-boy-assistant-document-changes:${encodeURIComponent(conversationScope)}`);
        changesRef.current.set(conversationScope, journal);
      }
      return journal;
    };
    const restoreDocument = async (id: string, checkCurrent?: () => void) => {
      const journal = documentJournal();
      const change = journal.checkpoints.find(item => item.id === id);
      if (!change) throw new Error('No checkpoint with this id.');
      const beforeSaved = readSavedDocument(change.kind, change.documentId);
      const draft = readDocument(change.kind, change.documentId);
      const draftMatches = !documentDiff(draft, beforeSaved);
      const checkpoint = await journal.restore(id, checkCurrent);
      const restored = readSavedDocument(checkpoint.kind, checkpoint.documentId);
      if (restored && draftMatches && !documentDiff(draft, readDocument(checkpoint.kind, checkpoint.documentId))) {
        if (checkpoint.kind === 'pad') padDraftReaderRef.current?.replaceDraft?.(restored as CustomGamepadLayout);
        else [...bridgesRef.current.values()].find(bridge => bridge.getCurrentTree()?.id === checkpoint.documentId)?.applyDocument?.(restored as BehaviorTree);
      }
      setDocumentChanges(previous => previous.filter(item => item.id !== id));
      return { restored: true, documentId: checkpoint.documentId, robotExecuted: false };
    };
    useEffect(() => {
      let cancelled = false;
      const journal = documentJournal();
      void journal.reconcile().then(() => {
        if (!cancelled) setDocumentChanges(journal.checkpoints.filter(item => item.state === 'committed').map(item => ({ id: item.id, label: `${item.kind === 'pad' ? 'Pad' : 'Behavior Tree'}: ${item.documentId}`, diff: documentDiff(item.before, item.intended) })));
      }).catch(cause => { if (!cancelled) setError(String(cause)); });
      return () => { cancelled = true; };
      // The journal owns saved-store access; a scope switch must not retain old undo controls.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversationScope]);
    const updateMessage = (id: string, patch: Partial<AssistantMessage>) =>
      setMessages(previous => previous.map(message => message.id === id ? { ...message, ...patch } : message));

    const generateFromPrompt = async (
      rawPrompt: string,
      historyOverride?: AssistantMessage[],
      checkpointOverride?: BehaviorTreeAgentCheckpoint | null,
      attachmentsOverride?: AssistantAttachment[]
    ) => {
      const userText = rawPrompt.trim();
      const turnAttachmentsRequested = attachmentsOverride ?? attachments;
      if ((!userText && turnAttachmentsRequested.length === 0) || abortRef.current) return;
      if (settings.authMode !== 'subscription' && loadingCredentials) { setError('Wait for the saved API key to load before sending.'); return; }
      if (!resolvedSettings.model.trim()) { setError('Choose a model in Assistant settings before sending.'); return; }
      if (settings.authMode !== 'subscription' && !resolvedSettings.baseUrl.trim()) { setError('Set a base URL in Assistant settings before sending.'); return; }
      if (settings.authMode !== 'subscription' && settings.provider !== 'openai-compatible' && settings.provider !== 'ollama' && !settings.apiKey.trim()) { setError(`Add an API key for ${settings.provider} in Assistant settings before sending.`); return; }

      const run = new AgentRun(() => { if (runRef.current === run) setEvents([...run.events]); });
      runRef.current = run;
      const controller = run.controller;
      let streamUpdateTimer: ReturnType<typeof setTimeout> | undefined;
      // Coalesce display updates, not evidence. Raw deltas remain in the turn immediately,
      // including when hidden; final/error messages use those complete snapshots.
      const scheduleStreamUpdate = () => {
        if (streamUpdateTimer !== undefined) return;
        streamUpdateTimer = setTimeout(() => {
          streamUpdateTimer = undefined;
          if (abortRef.current === controller && !controller.signal.aborted) {
            setStreamedAnswer(turnAnswer);
            setThinking(turnThinking);
          }
        }, 50);
      };
      abortRef.current = controller;
      setEvents([]);
      setIsGenerating(true);
      // A resource tagged a moment ago may still be retrieving; sending now would silently drop the
      // context the prompt names.
      // Manual pins are optional. Do not trap a cancelled run behind unrelated pending reads.
      if (controller.signal.aborted) { if (abortRef.current === controller) { abortRef.current = null; setIsGenerating(false); } return; }
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
      historyRef.current = nextHistory;
      setMessages(nextHistory);
      setPrompt('');
      // Context outlives the prompt: it stays until the user removes it in the browser, so a
      // follow-up question keeps looking at the same resources.
      setAttachments([]);
      setAttachmentError('');
      setClarificationSuggestions(undefined);
      const generationAtSend = connectionGeneration;
      setError('');
      setProgress(['Gathering context…']);
      setThinking('');
      setStreamedAnswer('');
      let turnThinking = '';
      let turnAnswer = '';
      let continueQueue = false;
      const turnActivity: string[] = [];
      let workspaceReceipt: AssistantMessage | undefined;
      const reportActivity = (message: string) => {
        if (turnActivity[turnActivity.length - 1] !== message) turnActivity.push(message);
        if (turnActivity.length > 40) turnActivity.shift();
        setProgress([...turnActivity]);
      };
      setIsGenerating(true);

      try {
        let discovery = rosGraphAt(generationAtSend)?.resources ?? null;
        if (ros && isConnected) discovery = await refreshRosContext(false, generationAtSend, controller.signal);
        if (controller.signal.aborted || currentGenerationRef.current !== generationAtSend) throw abortError();


        const needs = computeNeeds(userText, turnPinnedChips);
        const parserSchemas: BehaviorTreeResourceSchemas = { actions: {}, services: {} };
        const interfaceSchemas: NonNullable<AssistantAutoContext['interfaceSchemas']> = { topics: {}, services: {}, actions: {} };

        const turnChips = [...observationsRef.current.filter(chip => !turnPinnedChips.some(pin => pin.id === chip.id)), ...turnPinnedChips].map(chip =>
          chip.generation !== undefined && chip.generation !== generationAtSend ? { ...chip, stale: true } : chip
        );
        const rememberSchema = (raw: unknown) => {
          if (!raw || typeof raw !== 'object') return;
          const value = raw as { resource?: string; messageType?: string; actionType?: string; serviceType?: string; schema?: ActionGoalDetails; goalSchema?: ActionGoalDetails; requestSchema?: ActionGoalDetails };
          const schema = value.goalSchema ?? value.requestSchema ?? value.schema;
          const type = value.actionType ?? value.serviceType ?? value.messageType;
          if (!type || !Array.isArray(schema?.fields)) return;
          if (value.goalSchema || value.resource === 'action') { interfaceSchemas.actions[type] = schema; parserSchemas.actions[type] = schema; }
          else if (value.requestSchema || value.resource === 'service') { interfaceSchemas.services[type] = schema; parserSchemas.services[type] = schema; }
          else interfaceSchemas.topics[type] = schema;
        };
        for (const chip of turnChips) if (!chip.stale) rememberSchema(chip.value);
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
        if (ros && isConnected && discovery) {
          const plotTopics = timeSeriesContextTopics(userText, discovery.topics);
          const namedTopic = /\b(sample|latest|current value|current message|read)\b/i.test(userText)
            ? discovery.topics.find(item => userText.includes(item.name)) : undefined;
          const topics = plotTopics.length ? plotTopics : namedTopic ? [namedTopic] : [];
          for (const topic of topics) {
            if (turnChips.some(chip => (chip.value as { name?: string })?.name === topic.name && !chip.stale)) continue;
            setProgress([`Sampling ${topic.name}…`]);
            const [schema, sample] = await Promise.all([
              fetchMessageSchema(ros, topic.type, controller.signal).catch(error => {
                if (controller.signal.aborted) throw error;
                return { unavailable: 'The message schema could not be retrieved; use the sample or automatic field discovery.' };
              }),
              sampleRosTopic(ros, topic.name, topic.type, { ...(plotTopics.length ? { maxMessages: 1 } : {}), signal: controller.signal }),
            ]);
            turnChips.push({ id: `ros:turn-topic:${topic.name}`, label: `Live topic: ${topic.name}`, source: 'ros', automatic: true, fetchedAt: Date.now(), generation: generationAtSend, value: { ...topic, schema, sample } });
          }
        }
        // What a camera shows: its latest frame goes to the model as an image.
        const cameraFrames: CameraFrame[] = [];
        const imageRos = visualizationRos && visualizationRos !== ros ? visualizationRos : isConnected ? ros : null;
        if (imageRos && wantsCameraFrame(userText)) {
          const panelTopics = workspaceRef.current.openPanels
            .filter(panel => panel.type === 'camera' && typeof panel.configuration?.cameraTopic === 'string')
            .map(panel => panel.configuration!.cameraTopic as string);
          const topics = imageRos === ros ? discovery?.topics ?? [] : await listRosTopics(imageRos);
          for (const topic of cameraFrameTopics(userText, panelTopics, topics)) {
            setProgress([`Capturing a frame from ${topic.name}…`]);
            try {
              cameraFrames.push(await captureCameraFrame(imageRos, topic, { signal: controller.signal }));
            } catch (cause) {
              if (controller.signal.aborted) throw cause;
              turnChips.push({ id: `camera:${topic.name}`, label: `Camera ${topic.name}`, source: 'ros', automatic: true, fetchedAt: Date.now(), generation: generationAtSend, value: { topic: topic.name, unavailable: cause instanceof Error ? cause.message : String(cause) } });
            }
          }
        }
        // What an open Pad's gauges, readouts and states show right now.
        if (ros && isConnected && wantsPadValues(userText)) {
          const padIds = [...new Set([
            ...workspaceRef.current.openPanels.filter(panel => panel.type === 'pad').map(panel => panel.configuration?.layoutId),
            workspaceRef.current.selectedPadLayoutId,
          ].filter((id): id is string => typeof id === 'string'))].slice(0, 2);
          for (const padId of padIds) {
            const pad = readPadLibrary().find(item => item.id === padId || item.layout.id === padId);
            if (!pad || !padDisplayBindings(pad.layout).length) continue;
            setProgress([`Reading what ${pad.name} shows…`]);
            const values = await readPadValues(ros, pad.layout, controller.signal);
            turnChips.push({ id: `pad-values:${pad.id}`, label: `Live values on Pad ${pad.name}`, source: 'pad', automatic: true, fetchedAt: Date.now(), generation: generationAtSend, value: values });
          }
        }
        if (controller.signal.aborted || currentGenerationRef.current !== generationAtSend) throw abortError();

        const autoContext = buildAutoContext(discovery, interfaceSchemas);
        const contextUsed: AssistantContextUsage[] = [
          ...describeAutoContext(autoContext),
          ...turnChips.map(chip => ({ label: `Selected: ${chip.label}`, source: chip.source, ageSeconds: Math.round((Date.now() - chip.fetchedAt) / 1000), stale: chip.stale })),
          ...cameraFrames.map(frame => ({ label: `Camera frame: ${frame.topic} (${frame.width}×${frame.height})`, source: 'ros' as const, ageSeconds: 0 })),
        ];
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
        if (cameraFrames.length) chatMessages[lastIndex] = {
          ...chatMessages[lastIndex],
          content: `${chatMessages[lastIndex].content}\n\n[The app attached the latest camera frame${cameraFrames.length > 1 ? 's' : ''}: ${cameraFrames.map(frame => `${frame.topic} (${frame.width}×${frame.height})`).join(', ')}.]`,
          images: [...(chatMessages[lastIndex].images ?? []), ...cameraFrames.map(frame => ({ mimeType: frame.mimeType, data: frame.data }))],
        };

        setProgress(['Waiting for the model…']);
        const checkCurrent = () => {
          if (controller.signal.aborted || currentGenerationRef.current !== generationAtSend || currentRosRef.current !== ros) throw abortError();
        };
        const presentResponse = (response: AssistantResponse) => {
          if (response.kind === 'explanation') {
            pushMessage({ id: uuidv4(), role: 'assistant', content: response.message, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), contextUsed, thinking: turnThinking });
          } else if (response.kind === 'clarification') {
            setClarificationSuggestions(response.suggestions);
            pushMessage({ id: uuidv4(), role: 'assistant', content: response.question, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), contextUsed });
          } else if (response.kind === 'behaviorTree') {
            const targetBridge = getActiveBridge();
            if (targetBridge) targetBridge.applyPreview(response.tree);
            pushMessage({ id: uuidv4(), role: 'assistant', content: targetBridge ? `Built “${response.tree.name}” and opened its preview on the current Behavior Tree canvas. Accept or reject it there; it has not been saved or executed.` : `Built “${response.tree.name}”. Review this proposal before accepting it into the library.`, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), response, contextUsed });
          } else if (response.kind === 'padProposal') {
            const issues = discovery ? validatePadAgainstRos(response.layout, discovery) : [];
            pushMessage({ id: uuidv4(), role: 'assistant', content: `Built Pad “${response.layout.name}”. Review its complete layout and bindings in the Pad editor before saving.`, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), response: { ...response, issues }, contextUsed, proposedAtGeneration: generationAtSend });
          } else if (response.kind === 'rosAction') {
            const issues = discovery ? validateRosActionProposal(response.operation, discovery) : [];
            pushMessage({ id: uuidv4(), role: 'assistant', content: response.rationale || `Proposed ${response.operation.kind} “${response.operation.name}”.`, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), response: { ...response, issues }, contextUsed });
          }
        };
        const skills = loadSkills().filter(skill => skill.enabled);
        const profiles = loadAgentProfiles();
        const profile = profiles.find(item => item.id === settings.agentProfileId) ?? profiles[settings.agentProfileId ? 1 : 0];
        const loadedSkills = new Map<string, string>();
        const skillContext = () => `\n## Enabled workflow catalog\n${JSON.stringify(skills.map(({ id, name, description }) => ({ id, name, description })))}\n## Agent profile catalog\n${JSON.stringify(profiles.map(({ id, name, description }) => ({ id, name, description })))}\n${profile.instructions}\n${[...loadedSkills.entries()].map(([id, instructions]) => `## Trusted loaded workflow ${id}\n${instructions}`).join('\n')}\nMode: ${settings.mode ?? 'edit'}. ${settings.mode === 'plan' ? 'Investigate and produce a plan; do not change app state.' : settings.mode === 'ask' || profile.readOnly ? 'Answer with evidence; do not change app state.' : 'Stage validated Pad and Behavior Tree changes for operator review. Awaiting review is not saved. Local workspace edits remain available; robot operations are forbidden.'}`;
        const readSkill = (id: string) => { const skill = skills.find(item => item.id === id); if (!skill) throw new Error('No enabled skill with this id.'); loadedSkills.set(id, skill.instructions); return { name: skill.name, instructions: skill.instructions, scriptsExecuted: false }; };
        const integrationTool = async (name: string, input: Record<string, unknown>, signal: AbortSignal, readOnly: boolean) => {
          const integration = await import('../runtime/integrations');
          if (name === 'read_integrations') return integration.integrationCatalog(signal);
          const result = await integration.callIntegration(String(input.id), String(input.tool), input.arguments as Record<string, unknown>, signal, readOnly || name === 'read_integration');
          if (!result.ok) throw new Error('The integration returned an error. Inspect its health and retry only if appropriate.');
          return result.value;
        };
        const initialChipIds = new Set(turnChips.map(chip => chip.id));
        const taskContext = () => skillContext() + `\n## Current task checklist (update after observed outcomes)\n${JSON.stringify(run.tasks)}\nBefore finishing, reconcile every pending/running task with actual tool receipts. Keep operator approval waiting until accepted. Do not claim completion while a requested non-approval task is pending or blocked.`;
        const request = () => {
            let thinkingInRound = false;
            const systemPrompt = composeNativeSystemPrompt({ settings, autoContext: buildAutoContext(discovery, interfaceSchemas), pinnedChips: turnChips, needs });
            return sendAssistantChat({
              settings: resolvedSettings, systemPrompt: systemPrompt + taskContext(), messages: chatMessages, signal: controller.signal, tools: hostTools,
              sessionId: `${sessions.activeId}:${generationAtSend}:${historyBranchRef.current}`,
              shouldYield: () => run.isSteering,
              beforeStep: run.beforeStep,
              onUsage: usage => run.emit('usage', 'Model usage', 'done', `${usage.inputTokens} input · ${usage.outputTokens} output tokens`),
              nativeHistory: nativeHistoryRef.current?.provider === `${resolvedSettings.provider}:${resolvedSettings.model}:${resolvedSettings.authMode}` ? nativeHistoryRef.current.messages : undefined,
              onNativeMessages: messages => { if (!controller.signal.aborted) nativeHistoryRef.current = JSON.stringify(messages).length <= 320_000 ? { provider: `${resolvedSettings.provider}:${resolvedSettings.model}:${resolvedSettings.authMode}`, messages } : undefined; },
              // Native history already carries paired tool observations. Repeating every sample
              // and schema in the checkpoint grows both inference context and the IPC envelope.
              refreshSystemPrompt: () => composeNativeSystemPrompt({ settings, autoContext: buildAutoContext(discovery), pinnedChips: turnChips.filter(chip => !chip.id.startsWith('tool:') || initialChipIds.has(chip.id)), needs }) + taskContext(),
              onToken: text => { if (abortRef.current === controller && !controller.signal.aborted) { turnAnswer = (turnAnswer + text).slice(-256 * 1024); scheduleStreamUpdate(); } },
              onThinking: text => {
                if (abortRef.current !== controller || controller.signal.aborted) return;
                turnThinking = (turnThinking + (turnThinking && !thinkingInRound ? '\n\n' : '') + text).slice(-64 * 1024);
                thinkingInRound = true;
                scheduleStreamUpdate();
              },
              onProgress: message => { if (abortRef.current === controller && !controller.signal.aborted) setProgress([...turnActivity, message]); },
            });
          };
        const validate = (candidate: AssistantResponse): string[] => candidate.kind === 'padProposal' && discovery
            ? validatePadAgainstRos(candidate.layout, discovery, interfaceSchemas ?? { topics: {}, services: {}, actions: {} }).filter(issue => issue.severity === 'error').map(issue => `${issue.componentLabel}: ${issue.message}`) : [],
          execute = async (candidate: AssistantResponse, readSignal = controller.signal): Promise<unknown> => {
            if (candidate.kind === 'contextRequest') {
              reportActivity(candidate.summary || 'Reading live context…');
              const results = [];
              for (const read of candidate.reads) {
                readSignal.throwIfAborted();
                checkCurrent();
                const label = `${read.kind}${'name' in read ? `: ${read.name}` : ''}`;
                reportActivity(`Reading ${label}…`);
                try {
                  const { value, image } = await readAssistantContext(read, {
                    ros: isConnected ? ros : null, displayRos: visualizationRos, signal: readSignal,
                    graph: discovery, pads: readPadLibrary().map(item => item.layout), imageCount: chatMessages[lastIndex].images?.length ?? 0,
                    workspace: () => buildAutoContext(discovery, interfaceSchemas),
                    refreshGraph: async () => { discovery = await refreshRosContext(true, generationAtSend, readSignal); return discovery; },
                  });
                  checkCurrent();
                  rememberSchema(value);
                  if (image) chatMessages[lastIndex].images = [...(chatMessages[lastIndex].images ?? []), { mimeType: image.mimeType, data: image.data }];
                  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 64 * 1024) throw new Error('This read exceeds 64 KiB. Request a specific resource or smaller capture instead of the whole graph/workspace.');
                  const chip: AssistantContextChip = { id: `tool:${JSON.stringify(read)}`, label, source: read.kind === 'workspace' ? 'workspace' : read.kind === 'tf' || read.kind === 'transform' ? 'tf' : 'ros', automatic: true, fetchedAt: Date.now(), generation: generationAtSend, value };
                  observationsRef.current = [...observationsRef.current.filter(item => item.id !== chip.id), chip].slice(-48);
                  const existing = turnChips.findIndex(item => item.id === chip.id);
                  if (existing >= 0) turnChips[existing] = chip; else turnChips.push(chip);
                  contextUsed.push({ label: `Read ${label}`, source: chip.source, ageSeconds: 0 });
                  results.push({ read, ok: true, fetchedAt: chip.fetchedAt, generation: generationAtSend, value, ...(image ? { image: { mimeType: image.mimeType, data: image.data } } : {}) });
                  reportActivity(`Finished reading ${label}.`);
                } catch (cause) {
                  checkCurrent();
                  results.push({ read, ok: false, error: cause instanceof Error ? cause.message : String(cause) });
                  reportActivity(`Could not read ${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
                }
              }
              return results;
            }
            if (candidate.kind === 'workspaceEdit') {
              candidate.results = await applyWorkspaceOperations(candidate.operations, controller.signal);
              checkCurrent();
              const applied = candidate.results.filter(result => result.ok).length;
              const previous = workspaceReceipt?.response?.kind === 'workspaceEdit' ? workspaceReceipt.response : undefined;
              const response = { ...candidate, operations: [...previous?.operations ?? [], ...candidate.operations], results: [...previous?.results ?? [], ...candidate.results], rejected: [...previous?.rejected ?? [], ...candidate.rejected] };
              const total = response.results.filter(result => result.ok).length;
              const receipt: AssistantMessage = { id: workspaceReceipt?.id ?? uuidv4(), role: 'assistant', content: total === response.results.length ? `Applied ${total} workspace changes.` : `Applied ${total} of ${response.results.length} workspace changes.`, attachments: [], contextChipIds: [], checkpoint: null, createdAt: workspaceReceipt?.createdAt ?? Date.now(), response, resolution: total ? 'applied' : 'failed', contextUsed: [...contextUsed] };
              if (workspaceReceipt) updateMessage(receipt.id, receipt); else pushMessage(receipt);
              workspaceReceipt = receipt;
              return { results: candidate.results, ok: applied === candidate.results.length };
            }
            return undefined;
          };
        const hostTools = createHostTools({
          signal: controller.signal, checkCurrent, schemas: () => parserSchemas,
          readOnly: settings.mode === 'ask' || settings.mode === 'plan' || profile.readOnly,
          allowedTools: HOST_TOOL_DEFINITIONS.filter(tool => (!profile.tools || profile.tools.includes(tool.name)) && (settings.monitorEnabled || tool.name !== 'start_monitor')).map(tool => tool.name),
          beforeTool: run.beforeTool,
          event: run.emit.bind(run),
          validate: candidate => {
            const issues = validate(candidate);
            if (candidate.kind === 'padProposal') {
              for (const component of candidate.layout.components) {
                for (const operation of Object.values(component.eventOperations ?? {})) {
                  if (operation?.kind === 'action' && !interfaceSchemas.actions[operation.messageType]) issues.push(`Retrieve the action schema for ${operation.name} before proposing its goal.`);
                  if (operation?.kind === 'service' && !interfaceSchemas.services[operation.messageType]) issues.push(`Retrieve the service schema for ${operation.name} before proposing its request.`);
                }
              }
            }
            return issues;
          },
          execute, present: presentResponse,
          document: readDocument,
          saveDocument: async (kind, raw, baseRevision) => {
            const id = (raw as { id?: string })?.id;
            if (!id) throw new Error('Supply a complete authoring document with its id.');
            const current = readDocument(kind, id);
            if (current ? !baseRevision || await documentRevision(current) !== baseRevision : baseRevision !== undefined) throw new Error('Document revision conflict. Read the document again.');
            if (kind === 'pad' && readPadLibrary().some(item => item.layout.id === id && item.isDefault)) throw new Error('Built-in Pad templates are read-only. Save a custom copy with a new id.');
            let document: CustomGamepadLayout | BehaviorTree;
            if (kind === 'pad') {
              document = normalizePadLayout(raw);
              const issues = validate({ kind: 'padProposal', layout: document, issues: [] });
              if (issues.length) throw new Error(issues.join(' '));
            } else {
              const tree = raw as BehaviorTree;
              document = tree.nodes?.every(node => node.data) ? tree : (parseAssistantResponse(JSON.stringify({ ...tree, kind: 'tree' }), parserSchemas) as { tree: BehaviorTree }).tree;
              const issues = validateTreeBindings(document, discovery, parserSchemas);
              if (issues.length) throw new Error(issues.join(' '));
            }
            checkCurrent();
            if (kind === 'pad') presentResponse({ kind: 'padProposal', layout: document as CustomGamepadLayout, issues: [], ...(baseRevision ? { baseRevision } : {}) });
            else presentResponse({ kind: 'behaviorTree', tree: document as BehaviorTree });
            return { status: 'awaiting-review', saved: false, reviewDocumentId: `proposal:${id}`, document, robotExecuted: false, controlsActivated: false };
          },
          undoDocument: id => restoreDocument(id, checkCurrent),
          progress: reportActivity,
          delegate: async task => {
            const id = await run.spawn(task, runChild);
            return (await run.children.get(id)!.result);
          },
          agentTool: async (name, input) => {
            if (name === 'read_skill') return readSkill(String(input.id));
            if (['read_integrations', 'read_integration', 'call_integration'].includes(name)) return integrationTool(name, input, controller.signal, settings.mode === 'ask' || settings.mode === 'plan');
            if (name === 'read_monitors') return [...monitorsRef.current.values()].map(monitor => monitor.state);
            if (name === 'stop_monitor') { const monitor = monitorsRef.current.get(String(input.id)); if (!monitor) throw new Error('No monitor with this id.'); monitor.stop(); return { stopped: true }; }
            if (name === 'start_monitor') {
              if (!settings.monitorEnabled || !/monitor|watch|notify|keep.*eye|check.*later/i.test(userText)) throw new Error('Monitoring must be explicitly requested and enabled in Agent settings with expiry and inference allowance.');
              if (!ros || !isConnected) throw new Error('Connect before starting a topic watch.');
              if ([...monitorsRef.current.values()].filter(monitor => monitor.state.status !== 'stopped').length >= 3) throw new Error('At most three topic watches may run.');
              const resource = discovery?.topics.find(topic => topic.name === input.topic); if (!resource) throw new Error('Discover this exact topic first.');
              const subscriptionProvider = resolvedSettings.provider === 'openai' || resolvedSettings.provider === 'anthropic' ? resolvedSettings.provider : undefined;
              const accountId = resolvedSettings.authMode === 'subscription' && subscriptionProvider ? (await getDesktopBridge()?.assistant?.getState(subscriptionProvider))?.activeAccountId : undefined;
              checkCurrent();
              const sessionId = sessions.activeId;
              const monitor = new TopicMonitor(ros, { topic: resource.name, messageType: resource.type, fieldPath: String(input.fieldPath), comparison: input.comparison as 'above' | 'below' | 'equals' | 'changes', value: input.value as number | string | boolean | undefined, durationMinutes: settings.monitorDurationMinutes ?? 60, maxInferences: settings.monitorInferenceLimit ?? 1 }, state => { if (state.status === 'stopped') monitorsRef.current.delete(state.id); setMonitors(previous => [...previous.filter(item => item.id !== state.id), state].slice(-10)); }, async (value, signal) => {
                const checkMonitor = () => { signal.throwIfAborted(); if (currentRosRef.current !== ros || currentGenerationRef.current !== generationAtSend) throw abortError(); };
                let monitorGraph = discovery;
                const tools = createHostTools({ signal, checkCurrent: checkMonitor, readOnly: true, schemas: () => parserSchemas, validate: () => [], present: () => { throw new Error('Monitoring cannot edit.'); }, document: readSavedDocument, progress: () => {}, agentTool: async (tool, args) => { if (tool === 'read_skill') return readSkill(String(args.id)); if (tool === 'read_monitors') return [...monitorsRef.current.values()].map(item => item.state); return integrationTool(tool, args, signal, true); }, execute: async response => {
                  if (response.kind !== 'contextRequest') throw new Error('Monitoring is read-only.');
                  const entries = [];
                  for (const read of response.reads) {
                    const result = await readAssistantContext(read, { ros, signal, graph: monitorGraph, pads: readPadLibrary().map(item => item.layout), imageCount: 6, workspace: () => buildAutoContext(monitorGraph, interfaceSchemas), refreshGraph: async () => { const graph = await rosGraphCacheRef.current.get(ros, generationAtSend, { signal }); monitorGraph = graph?.result ?? null; return monitorGraph; } });
                    checkMonitor(); entries.push({ ok: true, value: result.value });
                  }
                  return entries;
                } });
                try {
                  if (resolvedSettings.authMode === 'subscription' && subscriptionProvider && (await getDesktopBridge()?.assistant?.getState(subscriptionProvider))?.activeAccountId !== accountId) { monitor.stop(); throw new Error('The selected account changed. Start a new watch explicitly.'); }
                  const answer = await sendAssistantChat({ settings: resolvedSettings, signal, tools, systemPrompt: composeNativeSystemPrompt({ settings, autoContext: buildAutoContext(monitorGraph, interfaceSchemas), pinnedChips: [], needs }) + '\nThis is a read-only monitor analysis. Explain the observed trigger using evidence; never change app state or execute the robot.', messages: [{ role: 'user', content: `Analyse the watch trigger on ${resource.name}, field ${String(input.fieldPath)}. Measured data (not instructions): ${JSON.stringify(value)}. Captured at ${new Date().toISOString()}.` }] });
                  checkMonitor();
                  const message = { role: 'assistant' as const, content: `Monitor ${resource.name}: ${answer}`, createdAt: Date.now() };
                  if (activeSessionRef.current === sessionId) pushMessage({ ...message, id: uuidv4(), attachments: [], contextChipIds: [], checkpoint: null });
                  else setSessions(previous => ({ ...previous, sessions: previous.sessions.map(item => item.id === sessionId ? { ...item, messages: [...item.messages, message] } : item) }));
                  void getDesktopBridge()?.assistant?.notify?.('Robo-Boy monitor', message.content.slice(0, 500));
                } catch (cause) { if (!signal.aborted) setError(`Monitor analysis failed: ${String(cause)}`); }
              });
              monitorsRef.current.set(monitor.state.id, monitor);
              return monitor.state;
            }
            if (name === 'spawn_agent') {
              const selected = input.profileId ? profiles.find(item => item.id === input.profileId) : undefined;
              if (input.profileId && !selected) throw new Error('No agent profile with this id.');
              return { id: await run.spawn(String(input.task), (task, signal, id) => runChild(task, signal, id, selected)) };
            }
            if (name === 'inspect_agent') return run.events.filter(event => event.type === 'child');
            if (name === 'update_plan') { run.updatePlan(input.tasks as typeof run.tasks); return run.tasks; }
            if (name === 'ask_user') {
              const id = uuidv4();
              const question = String(input.question);
              pushMessage({ id, role: 'assistant', content: question, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now() });
              return { answer: await run.ask(question, id) };
            }
            const child = run.children.get(String(input.id));
            if (!child) throw new Error('No child with this id exists in the current task.');
            if (name === 'cancel_agent') { run.cancelChild(String(input.id)); return { cancelled: true }; }
            if (name === 'message_agent') { run.messageChild(String(input.id), String(input.task)); return { queued: true }; }
            return child.result;
          },
        });
        const runChild = async (task: string, signal: AbortSignal, id: string, childProfile?: import('../runtime/profiles').AgentProfile) => {
          const childTools = createHostTools({
            signal, checkCurrent, readOnly: true, schemas: () => parserSchemas, validate, execute: response => execute(response, signal),
            allowedTools: childProfile?.tools,
            present: () => { throw new Error('Children cannot change documents.'); },
            document: (kind, documentId) => kind === 'pad' ? readPadLibrary().find(item => item.layout.id === documentId)?.layout : readTreeLibrary().find(item => item.tree.id === documentId)?.tree,
            beforeTool: run.beforeTool,
            progress: message => reportActivity(`Child: ${message}`),
            event: (type, label, status, detail, eventId) => run.emit(type, label, status, detail, eventId, id),
            agentTool: async (name, input) => { if (name === 'read_skill') return readSkill(String(input.id)); if (name === 'read_monitors') return [...monitorsRef.current.values()].map(monitor => monitor.state); if (['read_integrations', 'read_integration'].includes(name)) return integrationTool(name, input, signal, true); throw new Error('Children cannot edit or delegate.'); },
          });
          return sendAssistantChat({ settings: childProfile?.model ? { ...resolvedSettings, model: childProfile.model } : resolvedSettings, systemPrompt: composeNativeSystemPrompt({ settings, autoContext: buildAutoContext(discovery, interfaceSchemas), pinnedChips: [], needs }) + `\nYou are a read-only child investigator. Retrieve evidence, report findings with sources. Do not edit or delegate.\n${childProfile?.instructions ?? ''}`, messages: [{ role: 'user', content: task }], signal, tools: childTools, beforeStep: run.beforeStep });
        };
        const answer = await request();
        continueQueue = true;
        await run.settle();
        checkCurrent();
        // Captures survive follow-up turns in memory only, never in persisted conversation text.
        observationsRef.current = [...turnChips.filter(chip => chip.automatic)].slice(-48);

        presentResponse({ kind: 'explanation', message: answer });
        if (turnThinking || turnActivity.length || run.events.length) setMessages(previous => previous.map((message, index) => index === previous.length - 1 && message.role === 'assistant' ? { ...message, thinking: turnThinking, activity: [...turnActivity], events: [...run.events] } : message));
        setProgress([]);
      } catch (cause) {
        if (abortRef.current !== controller) return;
        setProgress([]);
        if (cause instanceof AgentYield || run.isSteering) { continueQueue = true; run.cancel(); pushMessage({ id: uuidv4(), role: 'assistant', content: 'Redirecting to your steering message. Completed changes are preserved.', attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), events: [...run.events] }); }
        else {
          const wasCancelled = controller.signal.aborted;
          const reason = wasCancelled
            ? controller.signal.reason instanceof Error && controller.signal.reason.message !== 'This operation was aborted' ? controller.signal.reason.message : 'Task stopped.'
            : isAbortError(cause) ? 'The model request was interrupted before completion.' : cause instanceof Error ? cause.message : 'The assistant request failed.';
          run.cancel();
          pushMessage({ id: uuidv4(), role: 'assistant', content: `${reason}\nCompleted changes and proposals are preserved; no edits were automatically retried.${turnAnswer ? `\n\nPartial response (not completed):\n${turnAnswer}` : ''}`, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now(), thinking: turnThinking, events: run.events.map(event => event.status === 'running' ? { ...event, status: 'cancelled' as const } : { ...event }) });
          // The failure is already an assistant message; do not repeat it in a second alert.
        }
      } finally {
        clearTimeout(streamUpdateTimer);
        if (abortRef.current === controller) {
          if (runRef.current === run) runRef.current = null;
          abortRef.current = null;
          setIsGenerating(false);
          setStreamedAnswer('');
          const pending = continueQueue || inputQueueRef.current.items[0]?.delivery === 'interrupt' ? inputQueueRef.current.next() : undefined;
          setPendingInputs([...inputQueueRef.current.items]);
          if (pending) void generateFromPrompt(pending.text, historyRef.current, undefined, pending.attachments);
        }
      }
    };

    const submitInput = (delivery: InputDelivery = 'steer') => {
      if (!prompt.trim() && !attachments.length) return;
      if (delivery === 'steer' && attachments.length && runRef.current?.events.some(event => event.type === 'question' && event.status === 'running')) { setError('Question replies accept text. Choose “Stop and send” to attach media; your attachments were kept.'); return; }
      if (prompt.trim() && delivery === 'steer' && runRef.current?.answer(prompt)) {
        pushMessage({ id: uuidv4(), role: 'user', content: prompt, attachments: [], contextChipIds: [], checkpoint: null, createdAt: Date.now() });
        setPrompt(''); return;
      }
      if (!abortRef.current) { void generateFromPrompt(prompt); return; }
      inputQueueRef.current.enqueue(prompt, delivery, attachments); setPendingInputs([...inputQueueRef.current.items]); setPrompt(''); setAttachments([]);
      if (delivery === 'interrupt') runRef.current?.cancel();
      else if (delivery === 'steer') runRef.current?.steer();
    };

    const handleNewConversation = () => {
      const previousMessages = historyRef.current;
      abandonTurn();
      abortContextWork();
      // A new conversation looks at nothing until it is told to: context belongs to the chat that
      // gathered it, not to the panel.
      updatePinnedChips(() => []);
      observationsRef.current = [];
      nativeHistoryRef.current = undefined;
      historyBranchRef.current = uuidv4();
      historyRef.current = [];
      setMessages([]);
      setClarificationSuggestions(undefined);
      setProgress([]);
      setError('');
      setPrompt('');
      setAttachments([]);
      setAttachmentError('');
      saveAssistantConversation([], conversationScope);
      const created = newAgentSession();
      setSessions(previous => ({ ...previous, activeId: created.id, sessions: [...previous.sessions.map(session => session.id === previous.activeId ? snapshotAgentSession(session, previousMessages) : session), created].slice(-20) }));
    };
    const switchSession = (id: string) => {
      const next = sessions.sessions.find(item => item.id === id);
      if (!next) return;
      const previousMessages = historyRef.current;
      abandonTurn();
      nativeHistoryRef.current = undefined;
      historyBranchRef.current = uuidv4();
      observationsRef.current = []; updatePinnedChips(() => []); setEvents([]); setProgress([]); setError('');
      setSessions(previous => ({ ...previous, activeId: id, sessions: previous.sessions.map(session => session.id === previous.activeId ? snapshotAgentSession(session, previousMessages) : session) }));
      const loaded = next.messages.map(message => ({ ...message, id: uuidv4(), attachments: [], contextChipIds: [], checkpoint: null, ...(message.response ? { proposedAtGeneration: -1 } : {}) }));
      historyRef.current = loaded; setMessages(loaded);
    };
    const deleteSession = (id: string) => {
      if (!sessions.sessions.some(session => session.id === id)) return;
      const remaining = sessions.sessions.filter(session => session.id !== id);
      if (id !== sessions.activeId) { setSessions(previous => ({ ...previous, sessions: previous.sessions.filter(session => session.id !== id) })); return; }
      const next = remaining[0] ?? newAgentSession();
      abandonTurn(); abortContextWork();
      nativeHistoryRef.current = undefined; historyBranchRef.current = uuidv4(); observationsRef.current = [];
      updatePinnedChips(() => []); setClarificationSuggestions(undefined); setError(''); setPrompt(''); setAttachments([]);
      const loaded = next.messages.map(message => ({ ...message, id: uuidv4(), attachments: [], contextChipIds: [], checkpoint: null, ...(message.response ? { proposedAtGeneration: -1 } : {}) }));
      historyRef.current = loaded; setMessages(loaded);
      setSessions({ ...sessions, activeId: next.id, sessions: remaining.length ? remaining : [next] });
    };
    const handleEditMessage = (messageIndex: number, nextText: string) => {
      const message = messages[messageIndex];
      if (!message) return;
      if (abortRef.current) return;
      // Editing branches conversation only. Reverting documents is an explicit checkpoint action.
      nativeHistoryRef.current = undefined;
      historyBranchRef.current = uuidv4();
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
      if (abortRef.current) return;
      nativeHistoryRef.current = undefined;
      historyBranchRef.current = uuidv4();
      const history = messages.slice(0, commandIndex);
      setMessages(history);
      void generateFromPrompt(message.content, history, message.checkpoint, message.attachments);
    };
    const handleAttachFiles = async (fileList: FileList | readonly File[] | null) => {
      const files = Array.from(fileList ?? []);
      if (!files.length) return;
      setAttachmentError('');
      if (attachments.length + files.length > MAX_ATTACHMENTS) { setAttachmentError(`Attach up to ${MAX_ATTACHMENTS} files per message.`); return; }
      if (attachments.reduce((total, item) => total + item.size, 0) + files.reduce((total, file) => total + file.size, 0) > MAX_ATTACHMENT_TOTAL_SIZE) { setAttachmentError('Attachments can use up to 12 MB per message.'); return; }
      try {
        const attachmentBranch = historyBranchRef.current;
        const next = await Promise.all(files.map(createAttachment));
        if (attachmentBranch !== historyBranchRef.current) return;
        setAttachments(previous => [...previous, ...next.filter(item => !previous.some(existing => existing.id === item.id))]);
      } catch (cause) {
        setAttachmentError(cause instanceof Error ? cause.message : 'Could not attach that file.');
      }
    };
    const handleReviewPad = async (messageId: string) => {
      const message = messages.find(item => item.id === messageId);
      if (!message || message.response?.kind !== 'padProposal' || !onReviewPadProposal) return;
      if (message.proposedAtGeneration !== undefined && message.proposedAtGeneration !== connectionGeneration) { setError('The robot connection changed. Ask the assistant to revalidate this Pad before reviewing it.'); return; }
      const proposal = message.response;
      if (proposal.baseRevision) {
        const draft = padDraftReaderRef.current?.();
        const current = draft?.id === proposal.layout.id ? draft : readPadLibrary().find(item => item.layout.id === proposal.layout.id)?.layout;
        if (!current || await documentRevision(current) !== proposal.baseRevision) { setError('The Pad changed after this proposal. Ask the assistant to rebase the edit; your current draft was preserved.'); return; }
      }
      onReviewPadProposal(message.response.layout);
      updateMessage(messageId, { resolution: 'applied' });
    };
    const handleSaveTree = (messageId: string) => {
      const message = messages.find(item => item.id === messageId);
      if (!message || message.response?.kind !== 'behaviorTree') return;
      if (message.proposedAtGeneration === -1) { setError('This recovered proposal needs revalidation. Ask the agent to read it, check the current robot interfaces, and save a validated revision.'); return; }
      const existing = readSavedDocument('behaviorTree', message.response.tree.id);
      if (existing && documentDiff(existing, message.response.tree)) { setError('This saved tree already has a different revision. Ask the agent to read and rebase the change; nothing was overwritten.'); return; }
      if (!saveBehaviorTree(message.response.tree)) { setError('The owning tree store could not save the proposal. Existing data was preserved.'); return; }
      updateMessage(messageId, { resolution: 'saved' });
    };

    return (
      <>
      <button
        type="button"
        className={`assistant-launcher${compact ? ' is-compact' : ''}${isOpen ? ' is-open' : ''}`}
        onClick={() => isOpen ? closeAssistant() : setIsOpen(true)}
        aria-label={`${isOpen ? 'Close' : 'Open'} Robo-Boy assistant`}
        aria-controls="robo-boy-assistant-panel"
        aria-expanded={isOpen}
        aria-hidden={compact && isOpen ? true : undefined}
        tabIndex={compact && isOpen ? -1 : undefined}
        title={`${isOpen ? 'Close' : 'Open'} Robo-Boy assistant`}
      >
        <HiSparkles aria-hidden="true" />
      </button>
      <AssistantPanel
        open={isOpen}
        compact={compact}
        onClose={closeAssistant}
        messages={messages}
        isGenerating={isGenerating}
        progressMessages={progress}
        thinking={thinking}
        streamedAnswer={streamedAnswer}
        events={events}
        pendingInputs={pendingInputs}
        onMovePendingInput={(id, direction) => { inputQueueRef.current.move(id, direction); setPendingInputs([...inputQueueRef.current.items]); }}
        monitors={monitors}
        onStopMonitor={id => monitorsRef.current.get(id)?.stop()}
        sessions={sessions.sessions.map(session => session.id === sessions.activeId ? snapshotAgentSession(session, messages) : session)}
        activeSessionId={sessions.activeId}
        onSwitchSession={switchSession}
        onRenameSession={(id, title) => { const name = title.trim().replace(/\s+/g, ' ').slice(0, 80); if (name) setSessions(previous => ({ ...previous, sessions: previous.sessions.map(session => session.id === id ? { ...session, title: name, titleEdited: true } : session) })); }}
        onDeleteSession={deleteSession}
        onArchiveSession={id => setSessions(previous => ({ ...previous, sessions: previous.sessions.map(session => session.id === id ? { ...session, archived: !session.archived } : session) }))}
        onForkSession={() => { abandonTurn(); nativeHistoryRef.current = undefined; historyBranchRef.current = uuidv4(); const created = newAgentSession(historyRef.current); setSessions(previous => ({ ...previous, activeId: created.id, sessions: [...previous.sessions.map(session => session.id === previous.activeId ? snapshotAgentSession(session, historyRef.current) : session), created].slice(-20) })); }}
        documentChanges={documentChanges}
        onUndoDocument={id => { void restoreDocument(id).catch(cause => setError(String(cause))); }}
        onPendingInputChange={(id, text) => { inputQueueRef.current.update(id, text); setPendingInputs([...inputQueueRef.current.items]); }}
        onRemovePendingInput={id => { inputQueueRef.current.remove(id); setPendingInputs([...inputQueueRef.current.items]); }}
        error={error || storageError}
        clarificationSuggestions={clarificationSuggestions}
        onSelectSuggestion={setPrompt}
        prompt={prompt}
        onPromptChange={setPrompt}
        onSubmit={submitInput}
        onStop={() => { inputQueueRef.current.items = []; setPendingInputs([]); runRef.current?.cancel(new Error('Stopped by you.')); }}
        onNewConversation={handleNewConversation}
        onRepeat={handleRepeat}
        onEditMessage={handleEditMessage}
        onOpenResource={onOpenResource}
        canOpenResource={canOpenResource}
        contextPickerSections={contextPickerSections}
        attachments={attachments}
        attachmentError={attachmentError}
        onAttachFiles={handleAttachFiles}
        onTranscribeAudio={audio => transcribeAssistantAudio(audio, resolvedSettings)}
        onRemoveAttachment={id => setAttachments(previous => previous.filter(item => item.id !== id))}
        settings={settings}
        resolvedBaseUrl={resolvedSettings.baseUrl}
        onProviderChange={(provider: AssistantProviderId) => updateSettings({ provider, authMode: 'api-key', apiKey: '', thinkingEffort: undefined, ...getProviderDefaults(provider), ...(provider === 'ollama' ? { ollamaUseBackendHost: true } : {}) })}
        onUpdateSettings={updateSettings}
        apiKeyStorage={apiKeyStorage}
        loadingCredentials={loadingCredentials}
        onApiKeyStorageChange={updateApiKeyStorage}
        ollamaModels={ollamaModels}
        ollamaModelsError={ollamaModelsError}
        isLoadingOllamaModels={isLoadingOllamaModels}
        onRefreshOllamaModels={() => setOllamaModelsRefresh(value => value + 1)}
        onReviewPadProposal={handleReviewPad}
        onRejectProposal={messageId => {
          const message = historyRef.current.find(item => item.id === messageId);
          if (message?.response?.kind === 'behaviorTree') {
            const tree = message.response.tree;
            for (const bridge of bridgesRef.current.values()) {
              if (!documentDiff(bridge.getPreviewTree(), tree)) bridge.applyPreview(null);
            }
          }
          updateMessage(messageId, { resolution: 'rejected' });
        }}
        onSaveBehaviorTreeProposal={handleSaveTree}
        hasActiveBehaviorTreeBridge={Boolean(activeBridge)}
      />
      </>
    );
  }
);

GlobalAssistant.displayName = 'GlobalAssistant';
export default GlobalAssistant;
