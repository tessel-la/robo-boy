# Agent architecture and feature gap analysis

Inspected October 8, 2026. Baseline: Robo-Boy `dev` at `f23f8fc`. PR #225 initially added an
application-managed JSON loop; the implementation now replaces it with the native architecture
described below. The matrix records the investigated baseline gaps.
"Missing" below describes the baseline, not a claim that every comparison app has every feature.

## Meaningful gaps

| Feature                         | Typical coding-agent approach                                               | Robo-Boy baseline / required adaptation                                                                                                                      | Priority             |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Native tool calls               | Typed tool definitions, call IDs, paired results; provider reasoning replay | One JSON response, no native tool conversation. Use a standard multi-provider runtime.                                                                       | Essential            |
| Iterative execution             | Observe results, repair errors, continue until finished or stopped          | One-shot generation and synthetic follow-up user messages. Preserve one real user turn.                                                                      | Essential            |
| Unified tool registry           | Same declared capability owns schema, validation, execution and help        | Prompt fragments and host callbacks are separate; centralize registered host tools.                                                                          | Essential            |
| Autonomous retrieval            | Model chooses relevant reads rather than requiring manual attachment        | Tags/keyword matching gate ROS samples and schemas. Enable named-resource tools for every turn.                                                              | Essential            |
| Semantic verification           | Validate tool results and generated changes before claiming success         | A primary action with no goal can produce a dead Pad button. Check executable events and retrieved schemas.                                                  | Essential            |
| Native API adapters             | Provider formats, tool IDs, thinking signatures and error semantics         | String-only transport loses native parts. Keep typed messages and vendor metadata.                                                                           | Essential            |
| Subscription tools              | Native runtime or app-server can invoke scoped host tools                   | Claude's runtime tools are disabled; subscription calls cannot reach host data themselves. Supply only Robo-Boy tools through an authenticated local bridge. | Essential            |
| Tool activity                   | Separate input/running/result/error events, expandable details              | Status strings and final context disclosure; no complete per-call lifecycle.                                                                                 | Essential            |
| Streaming answers/thinking      | Assistant text, exposed reasoning and tool events are distinct              | Answer appears only after complete JSON; thinking is discarded or synthetic continuations appear as user text.                                               | Essential            |
| Context budgets                 | Retrieval, summaries and compaction preserve complete tool/result groups    | Every saved Pad/BT is sent in full; no budget. Send catalogs and retrieve documents as needed.                                                               | Essential            |
| Session scope                   | History and tool execution belong to a specific thread/environment          | Global storage key is shared by connection views. Isolate conversation and provenance by robot/session.                                                      | Essential            |
| Cancellation/reconnect          | Interrupt inference and reads; reject stale results                         | Partial guards and no prompt release while shared discovery is pending. Preserve shared discovery without trapping a cancelled reader.                       | Essential            |
| Call/step budgets               | Stop runaway loops, repeated failures and oversized output                  | No real agent loop budget. Bound steps, reads, images, result bytes and retries.                                                                             | Essential            |
| Write coordination              | Host-owned execution, idempotency, state refresh after writes               | Async React changes can leave the next model request looking at old panels. Serialize host writes and return actual outcomes.                                | Essential            |
| Targeted document edits         | Patch a selected document rather than regenerate everything                 | Whole-layout Pad generation can lose working fields; add typed component edits and explicit document targets.                                                | Important            |
| Version/conflict checks         | Changes are based on a known document version                               | Pad/BT drafts can change during generation. Use document revision checks before applying edits.                                                              | Important            |
| Preview/diff/undo               | Review changes and restore checkpoints                                      | BT preview/checkpoints exist; Pad review is mainly a full editor handoff. Reuse these and improve targeted-edit review.                                      | Important            |
| Current draft context           | Unsaved editor state is visible to the agent                                | Pad library state is not necessarily the current unsaved editor draft. Read through the owning editor.                                                       | Important            |
| Task state                      | Plan, work, verify, blocked/cancelled/completed states                      | No explicit task state or verified completion conditions. Add a compact task view, not fake chain-of-thought.                                                | Important            |
| Failure recovery                | Clear failed/cancelled tool states and bounded retry                        | Provider errors and invalid proposals often terminate the request. Return tool errors to the model; do not retry successful mutations.                       | Essential            |
| Local session/proposal recovery | Threads, reviewed proposals and task state survive restart                  | Only text survives; pending proposal controls vanish. Persist bounded proposal/task records and revalidate restored proposals.                               | Important            |
| Resource provenance             | Source, timestamps and environment identity accompany observations          | Some freshness/generation tracking exists; preserve it in native tool results and cross-session boundaries.                                                  | Essential            |
| Cross-robot handoff             | Explicit environment selection and continuation ownership                   | Switching a connection does not automatically transfer a running assistant's ROS handle. Never silently read the previous robot after a switch.              | Important            |
| Scoped subagents                | Read-only delegated tasks, limits, parent-owned changes and evidence        | No delegation. Useful for independent TF/log/controller inspection; child agents must not publish or apply conflicting edits.                                | Optional after core  |
| Parallel work                   | Independent reads may overlap; mutations have clear ownership               | rosapi must remain serialized because of ROS 2 contention. Parallelism must respect that invariant.                                                          | Essential constraint |
| External MCP tools              | Discovered descriptions, permissions and lifecycle                          | No generic assistant MCP integration. A local subscription bridge is useful now; arbitrary third-party servers need a separate explicit permission design.   | Optional             |
| Scheduled/background work       | Durable jobs with cancellation, visibility and budgets                      | No durable background agent. Suitable later for monitoring; never silently resume robot motion.                                                              | Optional             |
| Attachments/vision/voice        | Structured attachments and media tools                                      | Already partly implemented; extend tool-result images and keep raw captures session-only.                                                                    | Extend existing      |
| Provider/accounts/usage         | Consistent model selection, credential isolation, usage/errors              | Multiple providers and desktop account storage exist. Preserve billing mode; do not silently fall back from subscription to API.                             | Preserve existing    |
| Accessibility/mobile            | Keyboard controls, reachable composer, expandable activity                  | Responsive layouts exist; native tool progress must remain usable in small tiles and with the keyboard open.                                                 | Essential            |
| Evaluations                     | Reproducible complete tasks, provider-boundary tests and live checks        | Good mocks/build tests exist; no live-provider quality evidence. Add task-level tests and distinguish fixtures from actual model validation.                 | Essential            |

## What should not be copied blindly

Terminal execution, repository edits, Git worktrees, code diagnostics and arbitrary filesystem
access are coding-agent capabilities. Their Robo-Boy equivalents are ROS discovery, diagnostics,
TF, panel configuration, Pad/BT edits, schemas and recordings. Giving a robot copilot a shell is
not a prerequisite for autonomy. Robot motion remains in the operator-reviewed Pad/BT workflow;
permission to inspect data is not permission to invent a safe target or execute a trajectory.

## Implemented adaptation and honest remaining boundaries

Implemented: native multi-provider tool calling and reasoning replay; one owned run controller;
separate answer/thinking/tool events; steering/queue/interrupt and editable queues; robot-scoped
searchable/forkable/exportable chats; automatic resource reads and targeted schemas; bounded
whole-turn compaction; shared budgets and repeated-failure recovery; scoped read-only children
with follow-up/cancel/inspect; workflow imports/custom profiles/declarative hooks; explicit HTTP
MCP grants; deterministic opt-in watches and Electron tray lifetime; draft-aware document patches,
validated saves, revision checks, journal reconciliation, diffs and undo; held-control revision
isolation; native desktop API credentials and scoped subscription tools. The old JSON answer loop
was deleted. Workspace state commits are acknowledged before the next model step.

Not claimed: proprietary-agent feature parity, automatic model capability/context discovery,
arbitrary shell/project hooks, unrestricted web browsing, MCP OAuth/stdio transports, durable
post-Quit/mobile background execution, or persisted provider reasoning/signatures. External
search/fetch is available through explicitly configured trusted integrations. Native histories
are deliberately ephemeral; recovered proposals require revalidation. Live paid-provider quality,
installed Claude CLI execution, physical robot safety and iOS/Android device behavior need their
own validation and cannot be inferred from mocked protocol tests or browser/build success.

### Delivery verification

The final local verification on October 8 passed: 215 unit-test files (1,769 tests passed,
10 skipped), 21 desktop/mobile Chromium browser tests, ESLint, renderer/Electron typechecks,
web and Tauri renderer builds, and Linux Electron Debian packaging. Coverage was 77.89% lines
and 66.58% branches. A separate smoke test launched the packaged ASAR with an isolated profile
and fixture model/ROS endpoints: native credential routing, native tool IPC, workspace
read-after-write, zero robot execution, and tray hide-on-close passed on the actual desktop.

These are harness/build proofs, not live paid-provider or robot quality evidence. WebKit device
coverage remains unverified: the Linux host lacks the required browser libraries. The desktop
smoke script does not install the package or change the user's normal app profile.

## Recommended architecture

1. **Host tool layer:** code-owned descriptors, JSON schemas, validated handlers and explicit
   read/edit/proposal effects. Reuse rosapi serialization and the existing panel/document bridges.
2. **Agent runtime:** a maintained native tool-calling implementation rather than a second hand-
   written vendor protocol. One turn contains multiple model/tool steps with cancellation,
   structured errors, budgets and verified outcomes.
3. **Provider adapters:** native OpenAI Responses, Claude Messages, Gemini, compatible APIs and
   Ollama. Native subscription runtimes access exactly the same host tools through a scoped
   bridge; API credentials remain in their existing stores.
4. **Conversation state:** typed assistant/tool messages retain native IDs and reasoning metadata
   in memory. Separate UI events from user messages. Scope records to a robot/session, and bound
   context while preserving tool/result pairs.
5. **Document ownership:** editors own their drafts, revisions, previews and undo. Tools read or
   patch those documents through bridges, not by duplicating UI state or blindly replacing JSON.
6. **UI:** stream assistant text; separately show exposed thinking, task state and per-tool
   running/success/error details. Keep results collapsed by default and available after completion.
7. **Verification:** test the Home-capture task end to end, malformed schemas/goals, reconnect,
   cancellation, replay data, document changes during a turn and subscription boundaries.

For the current multi-provider browser/desktop app, AI SDK's native multi-step tool runtime fits
better than embedding a coding agent's unrestricted execution environment. T3's event/state
separation is a useful UI and lifecycle pattern; its complete orchestration server/outbox is not
automatically required for foreground ROS inspection. Durable background jobs are a distinct
future requirement rather than scaffolding for every chat turn.

## Primary sources inspected

- [VS Code harness](https://code.visualstudio.com/blogs/2026/05/15/agent-harnesses-github-copilot-vscode/)
  and [tool loop source](https://github.com/microsoft/vscode-copilot-chat/blob/main/src/extension/intents/node/toolCallingLoop.ts).
- [VS Code tools UI](https://code.visualstudio.com/docs/agents/run/tools) and
  [thinking-part container](https://github.com/microsoft/vscode-copilot-chat/blob/main/src/platform/endpoint/common/thinkingDataContainer.tsx).
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).
- [Claude Code architecture](https://code.claude.com/docs/en/how-claude-code-works) and
  [Claude tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview).
- [T3 glossary](https://github.com/pingdotgg/t3code/blob/main/docs/internals/glossary.md) and
  [current native adapter](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts).
- [Cline loop detection](https://github.com/cline/cline/blob/main/sdk/packages/core/src/runtime/safety/loop-detection.ts).
- [AI SDK native tool loop](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) and
  [runtime reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text).
- [MCP TypeScript server](https://ts.sdk.modelcontextprotocol.io/server).

These are public implementation/documentation comparisons, not an audit of proprietary backend
internals or a claim of exhaustive feature parity with every release of every app.
