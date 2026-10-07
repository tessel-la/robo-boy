# Assistant retrieval and execution investigation

Baseline: `dev` at `f23f8fc`, inspected October 8, 2026. Repro: preparing a Home button required
manual tags for `/joint_states` and a trajectory action, then produced a primary action with no
executable goal. Workspace continuations could appear as user-authored messages.

## Findings and fixes

| Gap | Ownership and resulting behavior |
| --- | --- |
| One provider call; tags/regex are the only live retrieval triggers | `agentLoop.ts` continues model rounds after validated `contextRequest` reads or workspace results. |
| Short follow-ups omit tool instructions | `prompt.ts` always offers all implemented domain tools. |
| Workspace `followUp` recurses through the user-send path | Continuations are application observations in the same turn; only actual submissions enter user history. |
| A graph fetched during the first request can be omitted from context because React state is stale | Build context from the discovery result and captured generation directly. |
| Primary service/action fields are accepted but ButtonComponent executes `eventOperations` | Normalize supplied payloads into executable events; reject missing goals, validate fields/trajectory structure, and feed failures back for repair. |
| Introspection drops the element fields of message arrays | Expand nested array element schemas, retaining trajectory point positions and duration fields. |
| Provider thinking is discarded | Dedicated callbacks and request-scoped Electron events stream provider-exposed thinking into expandable assistant UI. |
| Read captures disappear from follow-up context | Keep bounded session observations with timestamps/generation; clear on new chat; exclude raw values from disk history. |
| A looping model repeats successful UI mutations | Reuse an identical batch's outcomes within a turn and stop at the round limit. |

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
- Cline's [reasoning API](https://github.com/cline/cline/blob/main/docs/api/chat-completions.mdx)
  separates reasoning deltas; its
  [loop detection](https://github.com/cline/cline/blob/main/sdk/packages/core/src/runtime/safety/loop-detection.ts)
  guards repeated identical calls. The corresponding Robo-Boy protections prevent duplicate
  successful workspace batches and bound a turn.

## Architecture choice

Reuse the existing validated JSON response protocol for tool requests and observations. This
provides one loop for all five API/local providers and both subscription paths without changing
account billing or granting native CLI tools. It is application-managed tool calling, not
provider-native `function_call`/`tool_use`. Results stay separate from user history and the prompt
is rebuilt after each read/change. Unknown tools cannot publish, invoke robot services/actions,
or access the filesystem.

A provider-native protocol would require a new multi-part transport, native reasoning replay,
tool IDs/results in each vendor format, and corresponding Electron subscription changes. It is
a valid further migration, but is not necessary to make existing tools autonomous. Adding an
agent framework would likewise duplicate the application's ROS and panel bridges. The smaller
loop preserves those validated boundaries and avoids an additional runtime/dependency.

Read tools reuse serialized rosapi, bounded subscriptions, TF/camera/Pad utilities and host-owned
panel bridges. Autonomous data retrieval does not imply autonomous robot motion or invented
joint configurations. A captured pose is evidence of joint positions, not a collision-checked
return path.

## Verification boundary

Regression tests cover iteration, invalid-response repair, reconnect/Stop, named-resource reads,
payload validation, thinking separation and subscription event cleanup. Browser tests exercise
the Home workflow with rosbridge and provider protocol fixtures on desktop/mobile widths.
These are reproducible harness tests; they do not establish live provider reasoning quality,
physical device behavior or safe robot motion.
