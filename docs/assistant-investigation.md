# Assistant retrieval and execution investigation

Baseline: `dev` at `f23f8fc`, inspected October 8, 2026. Repro: preparing a Home button required
manual tags for `/joint_states` and a trajectory action, then produced a primary action with no
executable goal. Workspace continuations could appear as user-authored messages.

## Findings and fixes

| Gap | Ownership and resulting behavior |
| --- | --- |
| One provider call; tags/regex are the only live retrieval triggers | `providers/native.ts` uses the installed AI SDK native multi-step tool conversation. The old JSON loop was removed. |
| Short follow-ups omit tool instructions | `prompt.ts` always offers all implemented domain tools. |
| Workspace `followUp` recurses through the user-send path | Continuations are application observations in the same turn; only actual submissions enter user history. |
| A graph fetched during the first request can be omitted from context because React state is stale | Build context from the discovery result and captured generation directly. |
| Primary service/action fields are accepted but ButtonComponent executes `eventOperations` | Normalize supplied payloads into executable events; reject missing goals, validate fields/trajectory structure, and feed failures back for repair. |
| Introspection drops the element fields of message arrays | Expand nested array element schemas, retaining trajectory point positions and duration fields. |
| Provider thinking is discarded | Dedicated callbacks and request-scoped Electron events stream provider-exposed thinking into expandable assistant UI. |
| Read captures disappear from follow-up context | Keep bounded session observations with timestamps/generation; clear on new chat; exclude raw values from disk history. |
| A looping model repeats successful UI mutations | Deduplicate replay by call identity, preserve completed-effect receipts during compaction, and stop repeated failures at the step boundary. |

## Primary source comparison

- [VS Code harness overview](https://code.visualstudio.com/blogs/2026/05/15/agent-harnesses-github-copilot-vscode/)
  describes rebuilding context, executing requested tools, observing outcomes and continuing
  under cancellation and tool limits. Its open-source
  [toolCallingLoop](https://github.com/microsoft/vscode-copilot-chat/blob/main/src/extension/intents/node/toolCallingLoop.ts)
  stores tool results separately from turns. Its
  [thinking container](https://github.com/microsoft/vscode-copilot-chat/blob/main/src/platform/endpoint/common/thinkingDataContainer.tsx)
  distinguishes reasoning data from answer content.
- [VS Code tool UI](https://code.visualstudio.com/docs/agents/run/tools) uses expandable thinking
  and tool activity, keeping the transcript readable.
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
  and [Claude tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
  both make tool calls an iterative application/model exchange; returning observations is
  essential. Native provider APIs also require preserving their reasoning/tool identifiers.
- [Claude Code's harness](https://code.claude.com/docs/en/how-claude-code-works) gathers context,
  acts and verifies repeatedly; tools return information that informs subsequent decisions.
- [T3 Code's glossary](https://github.com/pingdotgg/t3code/blob/main/docs/internals/glossary.md)
  distinguishes a user turn from non-message activity and provider adapters from the agent
  runtime. Its source now uses
  [CodexAdapterV2](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts),
  rather than the older adapter path surfaced by search. T3 is a useful UI/orchestration
  comparison, but delegating work to an installed coding runtime is different from exposing
  Robo-Boy's own ROS/panel tools to a model.
- Cline's [reasoning API](https://github.com/cline/cline/blob/main/docs/api/chat-completions.mdx)
  separates reasoning deltas; its
  [loop detection](https://github.com/cline/cline/blob/main/sdk/packages/core/src/runtime/safety/loop-detection.ts)
  guards repeated identical calls. The corresponding Robo-Boy protections prevent duplicate
  successful workspace batches and bound a turn.

## Architecture choice

Use one Robo-Boy-owned lifecycle controller around the installed AI SDK native tool loop.
Provider adapters own wire formats, tool IDs/results and reasoning replay; the host registry
owns schemas, validation, effects and cancellation. `agentLoop.ts` and its JSON response loop
were removed. JSON parsing remains only for validated tool arguments and authoring artifacts,
not the assistant's answer or thinking. Native assistant text is streamed directly.

Browser/Tauri inference uses the same native provider adapters. Electron API inference reads
credentials in the main process and uses a request-scoped host-tool bridge. OpenAI subscription
uses native Responses tools; Claude Code receives only code-owned Robo-Boy tools through an
authenticated temporary loopback MCP bridge, with built-in tools, hooks, commands and project
settings disabled. Neither path silently falls back to API billing. The CLI owns its native
loop; the application owns shared task/call limits, steering and effect validation.

The public implementations examined were Copilot Chat `5863f5a7088958050792b5dccbe8b46c6e13eccc`,
Cline `faf05ef067dd4f5908c9e909dd757581089905ca`, and T3
`3143335fc3a568cbbb5174764961889272135cb9`. The chosen adaptations are native tool/result
conversations, separate activity events, scoped children, whole-turn compaction and verified
effects—not a robot-facing shell or a second orchestration server.

Read tools reuse serialized rosapi, bounded subscriptions, TF/camera/Pad utilities and host-owned
panel bridges. Autonomous data retrieval does not imply autonomous robot motion or invented
joint configurations. A captured pose is evidence of joint positions, not a collision-checked
return path.

## Verification boundary

Regression tests cover iteration, invalid-response repair, reconnect/Stop, named-resource reads,
payload validation, thinking separation, session ownership, checkpoint conflicts/recovery,
read-only child lifetimes, monitor budgets and subscription event cleanup. Browser tests exercise
the Home workflow, automatic save/read-back/undo and zero robot commands with rosbridge and
native provider protocol fixtures on desktop/mobile widths.
These are reproducible harness tests; they do not establish live provider reasoning quality,
physical device behavior or safe robot motion.
