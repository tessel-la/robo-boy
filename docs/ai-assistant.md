# AI Assistant

Robo-Boy has one global AI assistant, reachable from anywhere in the connected app through a launcher button. It replaces the earlier Behavior-Tree-panel-owned chat assistant, which existed only while a BT panel was open and only knew about BT and ROS-discovery context. There is exactly one conversation: opening the assistant from a contextual button (for example a Behavior Tree panel's toolbar) pins that panel's context onto the existing conversation rather than starting a new one.

## User Workflow

1. Click the assistant launcher (bottom-left, fixed) from any view.
2. On desktop it opens as a floating, resizable, non-modal panel; on mobile it opens as a draggable bottom sheet that leaves the workspace above it visible and usable. Neither blocks interaction with the rest of the app — dismiss with the close button or Escape.
3. Ask a question, or attach files, a sketch, or your voice (Web Speech API, or record-and-transcribe when unavailable).
4. Pin extra context with the `+` button or by typing `@` inline (all saved Pads, all saved Behavior Trees, `/rosout`, or a fresh ROS graph refresh). Every context chip is visible and individually removable.
5. Review any proposed change before it takes effect — see [Capability matrix](#capability-matrix) and [Trust model](#trust-model) below.

Settings (provider, model, API key, instructions) live in the gear icon inside the panel and persist to this browser only.

## Capability Matrix

| Capability | Read automatically | Retrieve on demand | Propose (needs accept) | Execute only after explicit confirm | Not accessible |
| --- | --- | --- | --- | --- | --- |
| Connection status | ✅ | | | | |
| Open workspace panels / selected Pad | ✅ (bounded snapshot) | | | | |
| ROS topics/services/actions + schemas | | ✅ (cached, reconnect-aware) | | | |
| TF diagnostics / two-frame transform | | ✅ (on-demand, no background subscription) | | | |
| `/rosout` recent messages | | ✅ (bounded ring buffer, only while the panel is open) | | | |
| Pad JSON | | ✅ | | | |
| Pad create / repair | | | ✅ (goes through the existing Pad save flow) | | |
| Behavior Tree JSON | | ✅ | | | |
| Behavior Tree create / edit | | | ✅ (live canvas preview if a BT panel is open, otherwise saved-library) | | |
| Topic publish / service call / action goal | | | ✅ (shown as a card with target, type, and payload) | ✅ (single explicit click, capped, cancellable) | |
| `/diagnostics`, ROS 2 lifecycle state | | | | | ❌ (see [Known limitations](#known-limitations)) |
| Provider API key | | | | | ❌ (never placed in context, logs, or prompts) |
| External-panel internals | | | | | ❌ (no dependency edge between the assistant and `src/panels/`) |
| Filesystem / shell / ROS CLI | | | | | ❌ (does not exist anywhere in the app, on any platform) |

## Trust Model

Three tiers, and the assistant never silently crosses from one to the next:

1. **Read-only inspection** — ROS graph discovery, TF lookups, `/rosout`, workspace/Pad/BT reads. No confirmation needed; every value shown carries its source and fetch time, and is marked stale if a reconnect happened since.
2. **Proposals** — a Pad, a Behavior Tree, or a ROS action the assistant wants to create or change. Nothing is written or sent until the user clicks an explicit accept/save/run action. Pad and BT proposals are validated (topic/service/action existence and message-type match) against the live ROS graph before that button is even shown as clean.
3. **Robot-affecting execution** — a topic publish, service call, or action goal. This is a proposal *and* an execution: the guard in `src/features/assistant/tools/rosActionGuard.ts` enforces a JSON-object/size cap, checks the ROS connection has not changed since the proposal was made (and again after the call returns), and delegates the actual call to the same `executeRosOperation` the Pad/BT editors already use (same timeout and cancellation behavior). There is no batching or looping — one explicit click runs exactly one action.

## Architecture

`src/features/assistant/` is a self-contained feature module (see [Application architecture](architecture.md#global-ai-assistant)):

- `providers/` — one file per vendor (OpenAI, Gemini, Ollama, OpenAI-compatible, Anthropic) behind a single `sendChat` contract, using real multi-turn message arrays.
- `context/` — `rosGraphCache.ts` (TTL + single-flight + reconnect-generation invalidation around the existing `discoverAllROSResources`), `tfContext.ts` (on-demand transform lookup, no background subscription), `rosoutBuffer.ts` (bounded ring buffer), `workspaceSnapshot.ts` (pure builder consumed by `MainControlView`).
- `tools/` — `padValidator.ts` (whole-Pad-vs-ROS check), `rosActionGuard.ts` / `rosActionValidator.ts` (the trust-model tier 3 gate), `behaviorTreeTool.ts` (reuses the kept `treeGeneration.ts` parser).
- `components/` — `GlobalAssistant.tsx` (conversation/provider/context state, exposes an imperative `open()`/`registerBehaviorTreeBridge()` handle), `AssistantPanel.tsx` (non-modal desktop panel / mobile bottom sheet), `AssistantSettingsPopover.tsx`, and the relocated `AssistantSpeechTextarea.tsx` / `AssistantSketchEditor.tsx`.

### Behavior Tree integration

A mounted `BehaviorTreePanel` registers a `BehaviorTreeAssistantBridge` (`getCurrentTree`, `getSelectedTreeContext`, `captureCheckpoint`, `applyPreview`, `restoreCheckpoint`, `notify`) — the same seven-callback shape it used to pass to its own embedded chat panel, now formalized as the seam to the global assistant. The panel's diff/canvas-overlay/accept-mode/checkpoint logic is unchanged; the assistant only calls `applyPreview(tree)` where the old embedded panel used to. The toolbar's "Create tree with AI" button and Ctrl/Cmd+I open the global assistant with that panel's bridge pinned instead of embedding a second chat surface.

## Migration From The BT-Owned Assistant

The former `src/features/behaviorTree/agent/agentClient.ts` and `agentStorage.ts`, and the component `BehaviorTreeAgentPanel.tsx`, are removed. `treeGeneration.ts` (LLM-output parsing/repair) and `BehaviorTreeAgentPreview.tsx` (diff/summary, used by the canvas overlay) are unchanged. `AgentSpeechTextarea.tsx` and `BehaviorTreeSketchEditor.tsx` moved to `src/features/assistant/components/` under new names (`AssistantSpeechTextarea.tsx`, `AssistantSketchEditor.tsx`) with no behavior change beyond CSS class renaming.

Two deliberate scope reductions relative to the old BT-only chat:

- The BT agent's canvas-anchored Ctrl+I micro-form is gone; Ctrl+I now opens the (lightweight, non-modal) global assistant panel with the tree pinned, since the micro-form's reason to exist — avoiding a heavy modal — no longer applies.
- The `@mention` picker is simpler: it reuses the same "+" context-picker options rather than a bespoke per-node autocomplete list.

## Privacy And Credentials

Provider settings, including the API key, are stored in plaintext `localStorage` — unchanged from the previous BT-agent assistant, which already disclosed this in its own UI. This is **not** hardened further in this change; a real secret store (OS keychain via a new Tauri command, or a backend proxy) is a materially separate, security-review-worthy change and is left as documented future work. The API key is never included in any prompt, log, or exported conversation.

Conversation history (role, content, timestamp only — never attachments or settings) persists to `localStorage`, capped at 100 messages, so it survives a reload. This is a new capability the BT-owned assistant did not have.

Anthropic's Messages API has no CORS allowance for a bare `x-api-key` browser call; Robo-Boy has no application server to proxy it (see [Application architecture](architecture.md)), so a direct-from-browser Anthropic call uses the `anthropic-dangerous-direct-browser-access` header with a user-supplied key — the same trust boundary the existing OpenAI/Gemini providers already have, made explicit rather than hidden. Ollama keeps its existing same-origin `/ollama` Caddy proxy.

The assistant has no dependency edge to or from `src/panels/` — it cannot be reached from, and cannot reach into, an external panel's sandboxed iframe.

## Known Limitations

- **`/diagnostics` and ROS 2 lifecycle state are not read.** No cheap rosapi call enumerates which nodes are lifecycle nodes; doing so would require probing every node's service list, which is exactly the concurrent-rosapi-call risk `discoverAllROSResources` already guards against. Smallest credible future step: an explicit, user-named "check lifecycle state of node X" tool that queries only that one node's `~/get_state` service.
- **ROS action proposals are checked for existence and top-level message-type match, not full field-level payload schema.** A Behavior Tree proposal does get the full schema (via `fetchBehaviorTreeSchemas`); a standalone "publish/call/send" proposal only gets the JSON-shape/size cap plus the name/type check.
- **Domain-fragment prompt routing (whether to include the BT/Pad schema text for a turn) is keyword-based**, not a real intent classifier.
- **The assistant is not available before connecting** (on the entry/connect screen). Adding this would require lifting `useRos()` out of `MainControlView`, a materially separate and independently risky refactor; see [Application architecture](architecture.md#ros-boundary).
- **No live-provider or live-ROS validation was performed as part of building this feature** — all automated coverage uses a mocked provider `fetch` and the existing `e2e/helpers/rosMock.ts`.

## Future: External-Agent (MCP) Integration

Not built, deliberately: read/write access to Pads and Behavior Trees from an external agent (Claude Desktop, Codex, ChatGPT) over the Model Context Protocol is a real, credible next step, but Robo-Boy has no backend process to host an MCP server and its state lives in browser `localStorage`. The smallest credible increment is extending the existing manual Pad/BT export/import JSON round-trip into an automatic, watched two-way file sync, with a standard filesystem-flavored MCP server pointed at that directory — reusing `padValidator.ts` and the BT parser as the same validation gate, never a parallel one. See the architecture plan history for the full comparison of that option against a live local bridge.
