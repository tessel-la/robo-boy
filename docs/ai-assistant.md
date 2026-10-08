# AI Assistant

Robo-Boy has one global AI assistant, reachable from anywhere in the connected app through a launcher button. It replaces the earlier Behavior-Tree-panel-owned assistant. Chats are scoped to the robot connection, with new/fork/search/export controls. Opening it from a panel pins that panel onto the current chat; it does not start a competing agent.

## User Workflow

1. Press the assistant launcher, fixed in the bottom-right corner. It takes its size, icon size and edge inset from the `--floating-action-*` tokens in `src/index.css`, whose bottom offset clears a phone's gesture bar.
2. On desktop it opens on the right and can be moved/resized. It is non-modal; workspace controls remain live. Mobile portrait docks into the workspace with a resizable boundary; landscape uses a side panel. Safe-area and visual-viewport handling keep the composer reachable above the keyboard, and the system back gesture closes it.
3. Ask a question, or bring something with it. Files can be dropped anywhere on the panel or picked with the paperclip; an image shows as a thumbnail and opens full size when clicked. The microphone records a clip you can play back before sending, and `To text` converts it instead — a recording is sent as audio to providers that read audio (Gemini, and the OpenAI chat-completions shape), and refused with that suggestion for the ones that cannot (Anthropic, Ollama).
4. `Enter` sends and `Shift+Enter` starts a new line. An in-progress IME composition never submits.
5. Validated workspace/Pad/BT authoring can be applied automatically. Expand **Changes** for the before/after diff and conflict-safe Undo. Saved Pad controls require explicit **Activate updated controls**; a saved tree is not a running tree. Review-only proposals are still available.

### Native agent runtime

The old JSON response loop is removed. One native tool conversation can discover resources,
read bounded samples/logs/parameters/TF, retrieve exact schemas, inspect saved or unsaved documents,
modify panels and save validated authoring. Tags are optional references, never access gates.
Provider-exposed thinking, assistant text and tool activity are separate expandable UI parts.

During work, **Steer**, **Queue** and **Interrupt** keep genuine user inputs distinct. Queued
messages can be edited, removed or reordered. Session switches, reconnects, settings changes and
Stop cancel owned work; late results cannot enter another chat. Editing branches conversation
history, not document history. Forking creates a separate conversation branch.

The default task allowance is 50 model steps and 150 host calls, shared with up to three
read-only investigations. Each child has its own ten-step/read-tool limits. Plans/questions,
spawn/wait/inspect/message/cancel operations, usage events and per-call status are visible.
Three identical tool failures pause continuation; successful effects are not blindly replayed.
Context compaction retains complete tool/result exchanges and a bounded completed-effect ledger.
The model context-window setting is an operator-verified limit, not inferred model metadata.

Skills are enabled instruction-only workflows. Six robotics workflows are built in; trusted
`SKILL.md` imports never execute referenced scripts. Custom profiles can narrow tools and select
an explicit same-provider model. Declarative tool hooks can block a tool or add a reminder before
execution/after success/error; they cannot grant access or run shell commands.

MCP integrations require explicit per-tool read/local-edit grants, credential-free HTTPS or
loopback endpoints and compatible HTTP/CORS. Tokens stay session-only. Remote descriptions and
results are untrusted data; a declared read grant is an operator trust decision, not a guarantee
about a remote server's side effects. Do not grant robot-control tools. OAuth and arbitrary
desktop stdio MCP servers are not implemented.

Opt-in watches use deterministic, bounded ROS subscriptions; threshold/change edges trigger
read-only analyses with expiry, a five-minute cooldown and an explicit inference allowance.
Electron can keep these watches in the tray after window closure, with notifications and Stop/
Quit controls. Quit/shutdown ends them; watches are not resurrected on restart. Web/mobile/Tauri
are foreground-only. Hiding the app releases held virtual controls using their existing stop path.

Chats and validated authoring artifacts/checkpoints are bounded local data. Raw captures, images,
provider reasoning and native histories remain session-only. Recovered proposals require fresh
validation; journal recovery reconciles an interrupted save and never replays it. Revisions,
cooperative browser locks and final synchronous owner checks protect saved documents; existing
manual edits are not overwritten by Undo.

Settings (provider, model, API key, instructions) live in the gear icon inside the panel. Preferences persist in this browser; current Electron shells own API-key persistence natively.

The header's **Chats** button opens search, archived chats, switching, fork and export controls.
Chats and Settings replace the conversation body; Back or Escape returns to the conversation.
Tool activity, watch status, queued messages and **Changes** live in the scrollable transcript,
not the fixed composer. Tool results expand individually, with explicit Running/Done/Failed
status words. During a task, message delivery and Stop remain available while drafting a follow-up.

The assistant follows the handbook's [Robo-Boy product UI](https://github.com/tessel-la/tessella-handbook/blob/main/design/product-ui.md):
runtime theme surfaces and fonts, restrained message tinting, shared panel resize controls,
visible keyboard focus, and 44px touch controls. Settings respond to the panel width, including a
narrow desktop frame. Provider and extension forms use the same spacing and control treatment.
No fixed brand palette or fonts are imported into the application.

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

There is no context picker to manage. The assistant can request a topic's live sample, a service or action schema, a TF snapshot, a `/rosout` capture, node/parameter details, camera image or displayed Pad values itself. Tags remain optional references; you do not need to attach resources before it can use them.

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

**Data Explorer and Record & Replay.** While either panel is open, its contents go in every turn
like any other panel's settings, and the assistant can act on it with `configurePanel`.

- **Data Explorer:** every topic, service, action and node with its counts, the measured rate,
  bandwidth and message age of watched topics, QoS incompatibilities, diagnostics (problems
  first), the newest `/rosout` entries with warning and error counts, events, and each health
  rule with its state. The assistant can watch or stop watching topics (32 at most), add, change
  or remove health rules, select a resource, and switch the view. A selected resource brings its
  endpoints, QoS, schema and latest message.
- **Logs:** the Explorer keeps the newest 200 `/rosout` entries since it opened. The assistant
  sees the newest 25; when it needs more, it asks for the matching entries by level, node or text
  and reads them on its next turn.
- **Record & Replay:** the open recording's name, size, duration and start time, every topic with
  type, message count, average rate and the start of its definition, the playback position, the
  recordings stored on the ROS host, and the recorder's state and options. The assistant can open
  a recording stored on the ROS host, play, pause, seek, change speed and looping, and set
  recording options. When asked to record, it can start, pause, resume, split or stop a recording.
  A file on this device can only be opened by the user.
- **Message contents of a recording:** "sample" reads the latest message of up to six topics at
  the playback position. "read" goes through up to six topics over any stretch of the recording
  with a reader of its own, so playback is not disturbed. It can keep one message per interval,
  keep only named fields, or keep only messages containing a word. It returns at most 300 messages
  and about 60 KB, and still counts every match, so "how many errors" has a true answer. A read
  stops after 20 seconds or half a million messages and says where it stopped.

Data that a request reads (a selected message, a log query, a sample, a read) arrives on the
assistant's next model round within the same user turn. A panel's `apply` may finish
asynchronously; the assistant waits for it before continuing. Its continuation and tool results
are never inserted as messages from you.

The assistant can also see which Behavior Tree is running, its active node and its last status,
and it can set a camera panel's stream quality.

**Cameras and Pads.** Asked what a camera shows ("what does the camera see", "is there anyone in
front of the robot"), the app attaches the latest frame of each open camera panel, up to two, or of
an image topic the user names. The frame is read as a ROS message, so it works for the live robot
and, during replay, for the recording, and it is scaled to at most 1024 px. A compressed version of
the topic is used when the robot publishes one. Questions that change a camera panel ("remove the
camera panel") do not capture anything. Asked what a Pad shows ("what is the battery level"), the
app reads each topic the open Pad displays once and formats every gauge, level, readout, state,
text, plot and heartbeat as the Pad does, warning and alarm levels included. A provider without
image input ignores the frame.

**The app around the workspace.** The assistant sees every robot connection tab with its status
(only the current robot's graph is read), the app version, the theme and the available themes,
every installed panel with whether it is offered, and its own provider, model and thinking effort,
never a key or token. It can switch to another connection tab, open the form to connect to another
robot, close another connection tab, change the theme, offer or hide an installed panel, and open
the panel manager. Installing a panel is never done from chat: the assistant can open the manager
with that install prepared, and the user reviews the verified sources and permissions there and
applies it.

**Tagging.** Typing `@` names a resource in a sentence — it reads back as `@Camera` or `@/cmd_vel` — and for a ROS topic, service or action it also fetches that live data, which is too costly to carry for every one of them. `CONTEXT_CATALOG` is what the picker offers and what the prompt lists, so the two cannot disagree.

A mention is coloured as it is written: a backdrop behind the textarea paints the marks, since a textarea cannot style its own content, and it stays coloured in the transcript. One treatment for every kind of resource, tinted from the text colour of whatever surface it sits on — colouring by source gave a workspace tag the theme's primary, the same colour as the user's own message bubble, so it disappeared into it while a Pad tag beside it stayed visible. Matching is case-insensitive, because nobody types "TF tree" the way the panel spells it.

A message's tags are read from its own text, so the colouring survives a reload, a repeat and an edit. Editing an already-sent message uses the same picker and colouring; its list opens downwards, because an editor in the transcript would otherwise put the list under the header. A tag whose resource is currently on screen is clickable and opens it; one with no view waiting stays a plain mark rather than a dead link.

## What The Model Is Told About The App

The assistant uses native tools, paired observations and plain assistant text. Workspace changes
return actual owning-host outcomes before the next model step. The host flushes React commits
at the read-after-write boundary. Stop, account changes and reconnect cancel owned work. The
task/child allowances and recovery behavior are described above; `agentLoop.ts` no longer exists.

All domain tools are offered even for short follow-ups such as "solve it". Keyword matching
only optimizes eager retrieval; it no longer hides Pad/BT/layout
instructions. Live captures remain session-only, carry age and connection generation, and can be
used in a follow-up about the same capture. New conversation clears them.

Provider-exposed thinking appears in a separate expandable assistant section while streaming
and below the completed reply. It is never treated as answer JSON, a user message or persisted
conversation content. OpenAI-compatible reasoning, Claude thinking, Gemini thought parts,
Ollama thinking, and Electron subscription streams use this path. Providers that expose no
thinking show tool activity instead. Read completions and failures remain in the expandable
assistant section after the answer, in memory only.

Pad service/action bindings must have an executable `eventOperations` payload. A primary action
with a supplied request/goal is migrated to the correct button/toggle event; an absent or empty
goal is rejected and returned to the model for correction. Retrieved schemas check supplied
field names/types and nested arrays. Joint-trajectory goals additionally need distinct joint
names, one finite position per joint, and increasing positive times. These checks do not certify
joint limits, collision clearance or robot safety; motion remains in the reviewed Pad/BT flow.

See [assistant investigation](assistant-investigation.md) for source comparisons and the protocol
choice.

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
| Every saved Pad and Behavior Tree | ✅ catalogs | ✅ complete documents and revisions | ✅ validated save/patch with checkpoint/undo | |
| ROS node and parameter names | ✅ (every turn) | | | |
| Live topic sample | | ✅ (3 messages by default, 40 at most, 24 KiB each) | | |
| Workspace: add/remove panels, camera topic, stream quality or Pad of a panel, load/save layouts | | | ✅ applied at once through the same handlers as the menus; each outcome is listed in the reply | |
| Open panel settings: 3D view (frames, visualizations), TF tree (filters), Time Series (signals, math, smoothing, window, Y axis, pause/clear) | ✅ (each bridged panel's current settings and signal status) | | ✅ applied at once through the panel's settings bridge; each outcome is listed in the reply | |
| Data Explorer: resources and counts, watched-topic rates, QoS issues, diagnostics, `/rosout`, events, health rules | ✅ (while the panel is open; bounded) | ✅ (a resource's latest message and schema, up to 200 kept log entries) | ✅ watch/unwatch, health rules, selection and view, applied at once | |
| Record & Replay: the open recording, its topics and definitions, playback, recordings on the ROS host, recorder state | ✅ (while the panel is open) | ✅ (messages at a position, or a whole stretch of up to six topics) | ✅ open a recording from the ROS host, playback, recording options; start/stop recording when asked | ❌ opening a file from this device (only the user can choose it) |
| Behavior Tree run state (running, active node, status) | ✅ | | | ❌ starting, pausing or stopping a tree |
| Camera frames | | ✅ (latest frame of open cameras, up to two, when asked what they show) | | |
| Live values shown on a Pad | | ✅ (each displayed topic read once, formatted as the Pad shows it) | | |
| Connection tabs | ✅ (labels and status) | | ✅ switch, open the connect form, close another tab | ❌ closing the tab the conversation runs in |
| App settings: version, theme, installed panels, the assistant's provider and model | ✅ | | ✅ theme, offer or hide an installed panel, open the panel manager | ❌ installing or removing a panel (prepared for the user to review and apply), API keys and tokens |
| Pad create / repair | | ✅ current editor draft | ✅ automatic validated authoring, or explicit preview; control activation stays manual | |
| Behavior Tree create / edit | | ✅ current editor draft | ✅ automatic validated authoring, or explicit preview; execution stays manual | |
| Topic publish / service call / action goal | | | ✅ **review-only** — shown as a card, never run | |
| External panel JSON / internals | | | | ❌ (the assistant sees an installed panel's name, version and whether it is offered, never its contents; it generates Pads, not external panels) |
| ROS 2 lifecycle state | | | | ❌ (see [Known limitations](#known-limitations)) |
| Provider API key | | | | ❌ (never placed in context, logs, or prompts) |
| Filesystem / shell / ROS CLI / raw ROSLIB objects | | | | ❌ (does not exist anywhere in the app, on any platform) |

## Trust Model

Three tiers, and the assistant never silently crosses from one to the next:

1. **Read-only inspection** — ROS graph discovery, schemas and bounded samples, TF lookups, `/rosout`, workspace/Pad/BT reads. No confirmation needed; every value shown carries its source and fetch time, and is marked stale if a reconnect happened since.
2. **App functions applied at once** — workspace changes, panel settings, watching topics, health rules, playback, and the recorder on the ROS host. None of them commands the robot: watching and rules use the Robo-Boy inspection companion, and recording uses the Robo-Boy recorder, both on their own topics. Every outcome is listed in the reply, and the assistant is told to record only when the user asks.
3. **Proposals** — a Pad, a Behavior Tree, or a ROS operation. Nothing is written, saved, or sent until the user acts in the editor that owns it. Pad and BT proposals are validated (topic/service/action existence and message-type match) against the live ROS graph, and a Pad proposal is normalized, binding-checked and overlap-repaired before it opens in the Pad editor.

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

In the updated Electron shell, **Remember API key** has three per-provider choices:

- **Automatic (secure storage)** is the default. Keys are encrypted with Electron's asynchronous
  OS-backed `safeStorage` API when available. Missing/locked stores, rejected operations and
  timeouts fall back to native memory for the current app session. Newly entered keys are never
  silently written as plaintext. Settings disclose when the key must be re-entered after quitting.
- **This session only** bypasses the OS credential store and retains the key until Robo-Boy quits.
- **Save unencrypted on this device** explicitly enables private plaintext persistence and bypasses
  the OS credential store. Someone with access to app files or backups can read this key.

Robo-Boy does not ask for a storage password or require an unlock before using an entered API key.
The OS can still display a keychain permission/unlock dialog in Automatic mode; Electron cannot
universally suppress it. Each asynchronous native operation has a three-second timeout, and an
unavailable store is not retried until the next app start. Late native completions cannot write
an older key. The other two modes avoid keychain calls entirely. These choices apply to API keys;
subscription credentials retain their separate storage requirements.

The per-provider record lives in `assistant/api-keys/api-keys.json`. Encrypted entries contain
ciphertext; session entries contain only an empty marker and the storage preference. Clearing or
switching to session-only storage replaces that provider's saved secret, preventing old keys
from resurfacing. Writes remain serialized, atomic and synced before rename; POSIX directories
use `0700` and files `0600`. API keys remain credentials that can incur charges.

The native bridge permits only the trusted main app frame to read or update keys and preferences.
API transports load keys into renderer memory. Existing browser keys migrate automatically, and
the live browser entry is cleared only after the native write succeeds (including session markers).
Failures preserve the original browser entry. Earlier plaintext app records upgrade to encryption
when that provider is loaded and secure storage is available. If unavailable, the existing saved
key remains usable, with an explicit plaintext disclosure; choosing session-only removes it.
Legacy encrypted `api-keys.bin` records are recovered when they can be decrypted; otherwise they
are preserved and a replacement key can be entered. New records and cleared markers take
precedence. Historical browser/database/backup copies are not securely erased.

ChatGPT subscription tokens retain their separate OS-backed encrypted storage described above.
Claude Code continues to own its subscription credential storage.

Browser, Tauri/mobile and older Electron shells retain their existing plaintext `localStorage`
API-key behavior; use a server-side proxy for shared deployments. No provider key or subscription
token is included in assistant prompts, logs or conversation exports. Nonsecret provider/model/
thinking preferences and conversation history remain in browser storage.

Conversation history (role, content, timestamp only — never attachments or settings) persists to `localStorage`, capped at 100 messages, so it survives a reload. This is a new capability the BT-owned assistant did not have.

Anthropic's Messages API has no CORS allowance for a bare `x-api-key` browser call; Robo-Boy has no application server to proxy it (see [Application architecture](architecture.md)), so a direct-from-browser Anthropic call uses the `anthropic-dangerous-direct-browser-access` header with a user-supplied key — the same trust boundary the existing OpenAI/Gemini providers already have, made explicit rather than hidden. Ollama keeps its existing same-origin `/ollama` Caddy proxy.

The assistant cannot reach into an external panel's sandboxed iframe. It sees only what the panel registry lists (name, version, origin, offered or not), and installs go through the panel manager's own review.

## Known Limitations

- **The whole conversation is sent on every turn, and so is every Pad and Behavior Tree.** There is no summarization or sliding window, and the libraries are carried in full. A large library or a long conversation will grow the request past a small model's context window; the trade was made deliberately, against making the user fetch the right resource before asking about it.
- **Diagnostics are read only while a Data Explorer is open, and ROS 2 lifecycle state is not read.** The assistant can add an Explorer to read diagnostics. No cheap rosapi call enumerates which nodes are lifecycle nodes; doing so would require probing every node's service list, which is exactly the concurrent-rosapi-call risk the shared queue and `discoverAllROSResources` already guard against. Smallest credible future step: an explicit, user-named "check lifecycle state of node X" tool that queries only that one node's `~/get_state` service.
- **ROS operation proposals are checked for existence and top-level message-type match, not full field-level payload schema.** A Behavior Tree or Pad proposal does get the full schema; a standalone publish/call/send card only gets the name/type check. Since nothing runs from chat, this bounds a review aid rather than an execution gate.
- **A recording on this device cannot be opened by the assistant**, and reading one is bounded: at most six topics, 300 returned messages, about 60 KB and 20 seconds per read. Ask several narrower questions for a long recording.
- **Logs are those the Data Explorer kept since it opened** (the newest 200), or a short live `/rosout` capture. Older robot logs are not available unless they were recorded.
- **A camera frame is a single picture**, at most 1024 px, read when asked; it is not a video and not updated while the model answers. A Pad's values are likewise read once per question, from at most eight topics.
- **Only Pads are generated, not external panels.** An external panel is a versioned, sandboxed artifact under `src/panels/`, outside the assistant's dependency boundary.
- **The composer's tag colouring is a backdrop, not styled text.** A textarea cannot carry inline styling, so the marks are painted by a mirrored layer behind it. It must keep the same font, padding and wrapping as the textarea to stay aligned; a `contenteditable` composer would style the text directly but cost IME, undo, and mobile-keyboard behavior that currently works.
- **Re-typing a mention by hand reuses the resource read for it earlier in the conversation** rather than re-reading it. Selecting it again from the picker forces a fresh read, and `Context used` always shows the age of what was actually sent.
- **Domain-fragment prompt routing (whether to include the BT/Pad schema text for a turn) is keyword-based**, not a real intent classifier.
- **The assistant is not available before connecting** (on the entry/connect screen). Adding this would require lifting `useRos()` out of `MainControlView`, a materially separate and independently risky refactor; see [Application architecture](architecture.md#ros-boundary).
- **No live-provider or live-ROS validation was performed as part of building this feature** — all automated coverage uses a mocked provider `fetch` and the existing `e2e/helpers/rosMock.ts`. No physical iOS or Android microphone testing has been done.

## Future: External-Agent (MCP) Integration

Not built, deliberately: read/write access to Pads and Behavior Trees from an external agent (Claude Desktop, Codex, ChatGPT) over the Model Context Protocol is a real, credible next step, but Robo-Boy has no backend process to host an MCP server and its state lives in browser `localStorage`. The smallest credible increment is extending the existing manual Pad/BT export/import JSON round-trip into an automatic, watched two-way file sync, with a standard filesystem-flavored MCP server pointed at that directory — reusing `padValidator.ts` and the BT parser as the same validation gate, never a parallel one. See the architecture plan history for the full comparison of that option against a live local bridge.
