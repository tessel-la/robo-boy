# AI Assistant

Robo-Boy has one global AI assistant, reachable from anywhere in the connected app through a launcher button. It replaces the earlier Behavior-Tree-panel-owned chat assistant, which existed only while a BT panel was open and only knew about BT and ROS-discovery context. There is exactly one conversation: opening the assistant from a contextual button (for example a Behavior Tree panel's toolbar) pins that panel's context onto the existing conversation rather than starting a new one.

## User Workflow

1. Press the assistant launcher, fixed in the bottom-left corner. It is the mirror image of the theme button in the bottom-right: both take their size, icon size and edge inset from the same `--floating-action-*` tokens in `src/index.css`, including the bottom offset, which clears a phone's gesture bar by the same amount for each so the pair do not sit at different heights.
2. On desktop the assistant is a fixed left-side panel (`clamp(420px, 32vw, 480px)`) running the full height under the app bar. It is non-modal — the workspace to its right stays live — and it does not drag, resize, or minimize. Below 768px it fills the screen under the app bar as a modal dialog with a focus trap, the system back gesture closes it, and the theme button hides for as long as it is open rather than floating over the composer.
3. Ask a question, or bring something with it. Files can be dropped anywhere on the panel or picked with the paperclip; an image shows as a thumbnail and opens full size when clicked. The microphone records a clip you can play back before sending, and `To text` converts it instead — a recording is sent as audio to providers that read audio (Gemini, and the OpenAI chat-completions shape), and refused with that suggestion for the ones that cannot (Anthropic, Ollama).
4. `Enter` sends and `Shift+Enter` starts a new line. An in-progress IME composition never submits.
5. Review any proposed change in the editor that owns it — see [Capability matrix](#capability-matrix) and [Trust model](#trust-model) below.

Settings (provider, model, API key, instructions) live in the gear icon inside the panel and persist to this browser only.

## Context

**Everything the app holds goes in every turn.** The workspace snapshot (panels with their configuration, the current and saved layouts), every saved Pad and every saved Behavior Tree as complete JSON, the whole ROS graph, and the node and parameter lists. They are local reads, so making a user fetch the right one first cost more than carrying them all. Every reply lists what it used, with source and age, and a reconnect marks stale data rather than presenting it as current.

There is no context picker to manage. What is left for the user to choose is the data that is genuinely expensive: a topic's live sample, a service or action schema, a TF snapshot, a `/rosout` capture.

**Tagging.** Typing `@` names a resource in a sentence — it reads back as `@Camera` or `@/cmd_vel` — and for a ROS topic, service or action it also fetches that live data, which is too costly to carry for every one of them. `CONTEXT_CATALOG` is what the picker offers and what the prompt lists, so the two cannot disagree.

A mention is coloured as it is written: a backdrop behind the textarea paints the marks, since a textarea cannot style its own content, and it stays coloured in the transcript. One treatment for every kind of resource, tinted from the text colour of whatever surface it sits on — colouring by source gave a workspace tag the theme's primary, the same colour as the user's own message bubble, so it disappeared into it while a Pad tag beside it stayed visible. Matching is case-insensitive, because nobody types "TF tree" the way the panel spells it.

A message's tags are read from its own text, so the colouring survives a reload, a repeat and an edit. Editing an already-sent message uses the same picker and colouring; its list opens downwards, because an editor in the transcript would otherwise put the list under the header. A tag whose resource is currently on screen is clickable and opens it; one with no view waiting stays a plain mark rather than a dead link.

## What The Model Is Told About The App

Left to general ROS knowledge the model answers app questions from outside the app: asked whether Robo-Boy could measure the distance between two frames, it replied "write a `tf2_ros` node" — for something computed here from live `/tf` before a provider is called.

So the assistant's self-description is data, not prose. Each capability is an `AssistantCapability` declared beside the code that implements it — `TF_CAPABILITY` next to the phrase parsers, `PAD_CAPABILITY` next to the Pad generator, and so on — collected in `ASSISTANT_CAPABILITIES` and rendered into the prompt by `describeCapabilities`. Delete a feature and its description goes with it.

`capabilities.test.ts` is what holds the registry to the code: every TF phrasing offered to users is fed through the parsers that must match it, and every declared `responseKind` through the response parser. Change how a capability is triggered without updating its declaration and the test fails, rather than the assistant continuing to promise something that no longer works.

## Capability Matrix

| Capability | Read automatically | Retrieve on demand | Propose (reviewed in its own editor) | Not accessible |
| --- | --- | --- | --- | --- |
| Connection status | ✅ | | | |
| Open panels / layouts / selected Pad | ✅ (snapshot with each panel's configuration) | | | |
| ROS topics/services/actions + schemas | | ✅ (cached, reconnect-aware) | | |
| ROS nodes and parameters | | ✅ (rosapi, serialized) | | |
| TF snapshot, two-frame transform / distance | | ✅ (on demand, no background subscription) | | |
| `/rosout` recent messages | | ✅ (bounded: up to 40 messages over 4s, on demand) | | |
| Every saved Pad and Behavior Tree | ✅ (complete JSON, every turn) | | | |
| ROS node and parameter names | ✅ (every turn) | | | |
| Live topic sample | | ✅ (3 messages by default, 40 at most, 24 KiB each) | | |
| Pad create / repair | | | ✅ (opens in the existing Pad editor) | |
| Behavior Tree create / edit | | | ✅ (live canvas preview if a BT panel is open, otherwise saved-library) | |
| Topic publish / service call / action goal | | | ✅ **review-only** — shown as a card, never run | |
| External panel JSON / internals | | | | ❌ (no dependency edge to `src/panels/`; the assistant generates Pads, not external panels) |
| ROS 2 lifecycle state | | | | ❌ (see [Known limitations](#known-limitations)) |
| Provider API key | | | | ❌ (never placed in context, logs, or prompts) |
| Filesystem / shell / ROS CLI / raw ROSLIB objects | | | | ❌ (does not exist anywhere in the app, on any platform) |

## Trust Model

Two tiers, and the assistant never silently crosses from one to the next:

1. **Read-only inspection** — ROS graph discovery, schemas and bounded samples, TF lookups, `/rosout`, workspace/Pad/BT reads. No confirmation needed; every value shown carries its source and fetch time, and is marked stale if a reconnect happened since.
2. **Proposals** — a Pad, a Behavior Tree, or a ROS operation. Nothing is written, saved, or sent until the user acts in the editor that owns it. Pad and BT proposals are validated (topic/service/action existence and message-type match) against the live ROS graph, and a Pad proposal is normalized, binding-checked and overlap-repaired before it opens in the Pad editor.

**Robot-affecting execution never happens from chat.** A proposed publish, service call, or action goal renders as a review-only card with its target, type, and payload; there is no button that runs it. To act on one, put it into a Pad or a Behavior Tree and run it there, where the existing review, validation, and cancellation behavior applies. The former `tools/rosActionGuard.ts` execution path is removed, not disabled.

Whole-conversation history is sent to the provider on every turn (see [Known limitations](#known-limitations)).

## Architecture

`src/features/assistant/` is a self-contained feature module (see [Application architecture](architecture.md#global-ai-assistant)):

- `providers/` — one file per vendor (OpenAI, Gemini, Ollama, OpenAI-compatible, Anthropic) behind a single `sendChat` contract, using real multi-turn message arrays.
- `context/` — `rosGraphCache.ts` (TTL + single-flight + reconnect-generation invalidation around the existing `discoverAllROSResources`), `rosContext.ts` (exact interface/schema lookups, bounded topic sampling, bounded `/rosout` capture), `tfContext.ts` (on-demand transform and distance, no background subscription), `workspaceSnapshot.ts` (pure builder consumed by `MainControlView`).
- `tools/` — `padGeneration.ts` (proposal normalization, binding validation, overlap repair), `padValidator.ts` (whole-Pad-vs-ROS check), `rosActionValidator.ts` (existence and type check for review-only operation cards), `behaviorTreeTool.ts` (reuses the kept `treeGeneration.ts` parser).
- `components/` — `GlobalAssistant.tsx` (conversation/provider/context state, exposes an imperative `open()`/`registerBehaviorTreeBridge()` handle), `AssistantPanel.tsx` (the desktop side panel / mobile full-screen dialog), `AssistantSettingsPopover.tsx`, and the relocated `AssistantSpeechTextarea.tsx` / `AssistantSketchEditor.tsx`.

Every rosapi call in the app goes through the shared serialized queue in `src/utils/rosapiQueue.ts`. rosbridge answers rosapi requests one at a time, and a burst of concurrent calls — which context discovery would otherwise produce — is how that service is made to drop replies.

Each ROS connection carries a generation number. Retrieved context records the generation it was read at; a reconnect marks that data stale rather than presenting it as current, and in-flight context work is aborted rather than allowed to land against a different robot.

### Behavior Tree integration

A mounted `BehaviorTreePanel` registers a `BehaviorTreeAssistantBridge` (`getCurrentTree`, `getSelectedTreeContext`, `captureCheckpoint`, `applyPreview`, `restoreCheckpoint`, `notify`) — the same seven-callback shape it used to pass to its own embedded chat panel, now formalized as the seam to the global assistant. The panel's diff/canvas-overlay/accept-mode/checkpoint logic is unchanged; the assistant only calls `applyPreview(tree)` where the old embedded panel used to. The toolbar's "Create tree with AI" button and Ctrl/Cmd+I open the global assistant with that panel's bridge pinned instead of embedding a second chat surface.

### Pad integration

A Pad proposal is handed to `MainControlView`, which opens the existing Pad editor in create or edit mode against the proposed layout. Nothing is written to the Pad library until the user saves there.

## Migration From The BT-Owned Assistant

The former `src/features/behaviorTree/agent/agentClient.ts` and `agentStorage.ts`, and the component `BehaviorTreeAgentPanel.tsx`, are removed. `treeGeneration.ts` (LLM-output parsing/repair) and `BehaviorTreeAgentPreview.tsx` (diff/summary, used by the canvas overlay) are unchanged. `AgentSpeechTextarea.tsx` and `BehaviorTreeSketchEditor.tsx` moved to `src/features/assistant/components/` under new names (`AssistantSpeechTextarea.tsx`, `AssistantSketchEditor.tsx`).

Two deliberate scope reductions relative to the old BT-only chat:

- The BT agent's canvas-anchored Ctrl+I micro-form is gone; Ctrl+I now opens the global assistant panel with the tree pinned, since the micro-form's reason to exist — avoiding a heavy modal — no longer applies.
- The `@mention` picker reuses the same context-catalog options as the `Context` browser rather than a bespoke per-node autocomplete list.

## Voice Input

Voice uses the Web Speech API where the browser provides it, and otherwise records audio and sends it to the configured provider for transcription. Both need microphone permission, and the browser only grants that on a secure origin: a phone browsing Robo-Boy over plain `http://<LAN-IP>` cannot record, and no frontend code can work around that. Use HTTPS, `localhost`, or the packaged app.

The packaged Android app declares both `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS`. The webview asks for the pair in a single request (wry's `RustWebChromeClient.onPermissionRequest`) and an undeclared permission comes back denied, which denies the whole request. `NSMicrophoneUsageDescription` covers the same ground on iOS.

## Privacy And Credentials

Provider settings, including the API key, are stored in plaintext `localStorage` — unchanged from the previous BT-agent assistant, which already disclosed this in its own UI. This is **not** hardened further in this change; a real secret store (OS keychain via a new Tauri command, or a backend proxy) is a materially separate, security-review-worthy change and is left as documented future work. The API key is never included in any prompt, log, or exported conversation.

Conversation history (role, content, timestamp only — never attachments or settings) persists to `localStorage`, capped at 100 messages, so it survives a reload. This is a new capability the BT-owned assistant did not have.

Anthropic's Messages API has no CORS allowance for a bare `x-api-key` browser call; Robo-Boy has no application server to proxy it (see [Application architecture](architecture.md)), so a direct-from-browser Anthropic call uses the `anthropic-dangerous-direct-browser-access` header with a user-supplied key — the same trust boundary the existing OpenAI/Gemini providers already have, made explicit rather than hidden. Ollama keeps its existing same-origin `/ollama` Caddy proxy.

The assistant has no dependency edge to or from `src/panels/` — it cannot be reached from, and cannot reach into, an external panel's sandboxed iframe.

## Known Limitations

- **The whole conversation is sent on every turn, and so is every Pad and Behavior Tree.** There is no summarization or sliding window, and the libraries are carried in full. A large library or a long conversation will grow the request past a small model's context window; the trade was made deliberately, against making the user fetch the right resource before asking about it.
- **`/diagnostics` and ROS 2 lifecycle state are not read.** No cheap rosapi call enumerates which nodes are lifecycle nodes; doing so would require probing every node's service list, which is exactly the concurrent-rosapi-call risk the shared queue and `discoverAllROSResources` already guard against. Smallest credible future step: an explicit, user-named "check lifecycle state of node X" tool that queries only that one node's `~/get_state` service.
- **ROS operation proposals are checked for existence and top-level message-type match, not full field-level payload schema.** A Behavior Tree or Pad proposal does get the full schema; a standalone publish/call/send card only gets the name/type check. Since nothing runs from chat, this bounds a review aid rather than an execution gate.
- **Only Pads are generated, not external panels.** An external panel is a versioned, sandboxed artifact under `src/panels/`, outside the assistant's dependency boundary.
- **The composer's tag colouring is a backdrop, not styled text.** A textarea cannot carry inline styling, so the marks are painted by a mirrored layer behind it. It must keep the same font, padding and wrapping as the textarea to stay aligned; a `contenteditable` composer would style the text directly but cost IME, undo, and mobile-keyboard behavior that currently works.
- **Re-typing a mention by hand reuses the resource read for it earlier in the conversation** rather than re-reading it. Selecting it again from the picker forces a fresh read, and `Context used` always shows the age of what was actually sent.
- **Domain-fragment prompt routing (whether to include the BT/Pad schema text for a turn) is keyword-based**, not a real intent classifier.
- **The assistant is not available before connecting** (on the entry/connect screen). Adding this would require lifting `useRos()` out of `MainControlView`, a materially separate and independently risky refactor; see [Application architecture](architecture.md#ros-boundary).
- **No live-provider or live-ROS validation was performed as part of building this feature** — all automated coverage uses a mocked provider `fetch` and the existing `e2e/helpers/rosMock.ts`. No physical iOS or Android microphone testing has been done.

## Future: External-Agent (MCP) Integration

Not built, deliberately: read/write access to Pads and Behavior Trees from an external agent (Claude Desktop, Codex, ChatGPT) over the Model Context Protocol is a real, credible next step, but Robo-Boy has no backend process to host an MCP server and its state lives in browser `localStorage`. The smallest credible increment is extending the existing manual Pad/BT export/import JSON round-trip into an automatic, watched two-way file sync, with a standard filesystem-flavored MCP server pointed at that directory — reusing `padValidator.ts` and the BT parser as the same validation gate, never a parallel one. See the architecture plan history for the full comparison of that option against a live local bridge.
