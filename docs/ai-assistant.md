# AI Assistant

Robo-Boy has one global AI assistant, reachable from anywhere in the connected app through a launcher button. It replaces the earlier Behavior-Tree-panel-owned chat assistant, which existed only while a BT panel was open and only knew about BT and ROS-discovery context. There is exactly one conversation: opening the assistant from a contextual button (for example a Behavior Tree panel's toolbar) pins that panel's context onto the existing conversation rather than starting a new one.

## User Workflow

1. Press the assistant launcher, fixed in the bottom-right corner. It takes its size, icon size and edge inset from the `--floating-action-*` tokens in `src/index.css`, whose bottom offset clears a phone's gesture bar.
2. On desktop the assistant is a fixed right-side panel (`clamp(420px, 32vw, 480px)`) running the full height under the app bar, on the launcher's side. It is non-modal — the workspace to its left stays live — and it does not drag, resize, or minimize. Below 768px it fills the screen under the app bar as a modal dialog with a focus trap, and the system back gesture closes it.
3. Ask a question, or bring something with it. Files can be dropped anywhere on the panel or picked with the paperclip; an image shows as a thumbnail and opens full size when clicked. The microphone records a clip you can play back before sending, and `To text` converts it instead — a recording is sent as audio to providers that read audio (Gemini, and the OpenAI chat-completions shape), and refused with that suggestion for the ones that cannot (Anthropic, Ollama).
4. `Enter` sends and `Shift+Enter` starts a new line. An in-progress IME composition never submits.
5. Review any proposed change in the editor that owns it — see [Capability matrix](#capability-matrix) and [Trust model](#trust-model) below.

Settings (provider, model, API key, instructions) live in the gear icon inside the panel and persist to this browser only.

### API keys and subscription sign-in

For OpenAI and Anthropic Claude, **Authentication** selects **API key** or **Sign in** (subscription).
API-key mode keeps the existing model, base URL and key fields. Switching authentication modes does
not discard the saved API key, and subscription requests never fall back to API billing.

Recognized OpenAI reasoning models and current Claude Sonnet/Opus models show **Thinking effort**.
Choose Model default to send no override, or select an offered level to control reasoning depth.
Changing models or authentication resets the override. OpenAI subscription requests use
`reasoning.effort`, its API transport uses `reasoning_effort`, Claude API requests use adaptive
thinking and `output_config.effort`, and Claude Code receives `--effort`. Higher effort can take
longer and consume more tokens or plan allowance; organization caps still apply. Unknown model
IDs and unsupported models retain their default behavior instead of receiving speculative fields.
See [OpenAI reasoning controls](https://developers.openai.com/api/docs/guides/reasoning) and
[Claude effort controls](https://code.claude.com/docs/en/model-config#adjust-effort-level).

Subscription sign-in currently requires the **Electron desktop app**. Browser and Tauri/mobile builds
show the desktop requirement and continue to support API-key authentication; they do not run a hidden
credential proxy. Older desktop shells also need an update before the sign-in controls are available.

- **OpenAI:** choose Continue with ChatGPT, complete the browser sign-in and allow ChatGPT plan usage.
  The model picker uses the selected account's catalog. Add account, account selection, reconnect,
  sign-out and Manage usage are available in settings. An eligible plan is required; sign-in alone
  does not guarantee inference access. The native runtime uses the documented Sign in with ChatGPT
  OAuth/Responses contract, with `jose` for signed identity verification. It does not use private
  ChatGPT endpoints or extract credentials from another application.
- **Claude:** install the official Claude Code CLI **2.1.278 or newer**, then choose Sign in through
  Claude Code. Anthropic's own runtime completes login and manages credentials in a Robo-Boy-specific
  configuration directory, separate from the user's ordinary Claude Code setup. Choose Sonnet,
  Opus or Haiku; availability and usage follow the account. Robo-Boy launches the unmodified native
  binary without a shell and without API keys or gateway credentials inherited from its environment.
  The runtime's tools, skills, plugins, hooks, Chrome integration and inherited MCP configuration are
  disabled. It receives the full conversation as JSON context plus the final turn's images, rather
  than adopting a persistent Claude Code project session. Its output goes through the existing
  assistant parser and validators.

ChatGPT credentials are encrypted with Electron's OS-backed `safeStorage`, written atomically under
the native app's data directory, and never returned to the renderer. On Linux, a working system
keyring is required; the insecure `basic_text` backend is refused. Claude Code owns its own native
credential storage. Neither provider's subscription tokens enter `localStorage`, prompts or exports.
The native bridge validates the top-level app caller and bounded request data. Account changes,
window navigation/closure and cancellation stop in-flight work; late results are rejected.

Browser speech recognition remains available with sign-in. Recorded-audio transcription is not
included in these subscription transports; choose API-key mode for a provider that supports it.

Official contracts: [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source),
[preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
[Claude Code authentication](https://code.claude.com/docs/en/authentication), and
[Claude product integration conditions](https://code.claude.com/docs/en/legal-and-compliance).

## Context

**Everything the app holds goes in every turn.** The workspace snapshot (panels with their configuration, the current and saved layouts), every saved Pad and every saved Behavior Tree as complete JSON, the whole ROS graph, and the node and parameter lists. They are local reads, so making a user fetch the right one first cost more than carrying them all. Every reply lists what it used, with source and age, and a reconnect marks stale data rather than presenting it as current.

There is no context picker to manage. What is left for the user to choose is the data that is genuinely expensive: a topic's live sample, a service or action schema, a TF snapshot, a `/rosout` capture.

Plotting requests automatically retrieve a schema and one bounded live sample for up to three
explicitly named topics. A joint-state request without a topic name samples graph topics of type
`sensor_msgs/msg/JointState` (or its ROS 1 spelling), so joint names and array indices are available
without manually tagging the topic. It does not subscribe to every topic on the graph.

The assistant can add a Time Series panel and configure it in one reply. Settings wait for that
specific tile to mount, including a mobile replacement. If the model only adds the panel and
omits the remaining plotting task, the app continues that task against the updated workspace.
Open plots report connected/active state, signals and field paths, sample counts, latest sample
timestamps, numeric fields, filters/math, and plot controls. A saved signal with no samples is
reported as pending; it is not evidence that the robot is publishing.

For example: “Add a Time Series panel showing joint positions from /robot/joint_states.”
Joint-state fields use indexed paths such as `position[0]`; the sample's `name[0]` provides its label.
If data is unavailable, automatic discovery starts when a message arrives (up to eight fields;
at most sixteen configured signals). Indexed paths follow the publisher's array order; joint-name
labels do not dynamically rebind if that order changes. Specific named joints need a live sample.

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
| Workspace: add/remove panels, camera topic or Pad of a panel, load/save layouts | | | ✅ applied at once through the same handlers as the menus; each outcome is listed in the reply | |
| Open panel settings: 3D view (frames, visualizations), TF tree (filters), Time Series (signals, math, smoothing, window, Y axis, pause/clear) | ✅ (each bridged panel's current settings and signal status) | | ✅ applied at once through the panel's settings bridge; each outcome is listed in the reply | |
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
- `providers/subscription.ts` — routes subscription requests to the typed native bridge in
  `src/runtime/assistantSubscription.ts`. `electron/assistant.ts` owns caller validation, cancellation
  and account transitions; `openaiSubscription.ts` owns OAuth, encrypted accounts and Responses;
  `claudeSubscription.ts` owns the restricted official CLI lifecycle. The browser holds no tokens.
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

In the updated Electron shell, API keys are encrypted with OS-backed `safeStorage` in
`assistant/api-keys/api-keys.bin`. The native bridge allows only the trusted main app frame to
read or update a key. API transports load it into renderer memory when needed. Existing browser
keys migrate automatically: the live settings entry is cleared only after encrypted persistence
succeeds, and a failed migration retains the original entry and displays an error. Clearing a key
removes the native secret, retaining an empty marker to prevent stale browser keys from returning.
Previously stored copies in browser databases or backups are
not securely erased by migration. Encryption protects disk storage, not a compromised logged-in
OS account or running app.

Browser, Tauri/mobile and older Electron shells retain their existing plaintext `localStorage`
API-key behavior; use a server-side proxy for shared deployments. No provider key or subscription
token is included in assistant prompts, logs or conversation exports. Nonsecret provider/model/
thinking preferences and conversation history remain in browser storage.

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
