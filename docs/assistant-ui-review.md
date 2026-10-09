# Assistant UI and lifecycle source review

This change adapts established patterns, not another coding-agent server. Robo-Boy owns robot
interfaces and panel/document effects; provider adapters own native inference and tool exchanges.

## Sources inspected

- T3 Code at `a6ec88f7a716fc421bd22c2484881c44110f9375`:
  [`ChatMarkdown.tsx`](https://github.com/pingdotgg/t3code/blob/a6ec88f7a716fc421bd22c2484881c44110f9375/apps/web/src/components/ChatMarkdown.tsx),
  [`markdownPipeline.ts`](https://github.com/pingdotgg/t3code/blob/a6ec88f7a716fc421bd22c2484881c44110f9375/packages/shared/src/markdownPipeline.ts),
  `ChatComposer.tsx`, `CompactComposerControlsMenu.tsx`, `MessagesTimeline.tsx`,
  `ThreadStatusLine.tsx`, `RunningThreadKeepAlive.tsx` and the thread-sidebar guide.
  The runtime's `ThreadLiveEventCoalescer.ts` preserves terminal boundaries while coalescing
  repeated in-flight updates; `ThreadStop.test.ts` covers queued/unstarted work and Stop.
- Copilot Chat at `5863f5a7088958050792b5dccbe8b46c6e13eccc`:
  [`toolCallingLoop.ts`](https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/extension/intents/node/toolCallingLoop.ts)
  (native rounds, graceful yield, separate reasoning/tool results, cancellation),
  and `sessionTranscriptService.ts` (separate user/assistant/tool entries).
- The chat DOM belongs to VS Code, not Copilot Chat. VS Code at
  `6eb5f37d1c05683262724dba334221290d8f4188`:
  [`chatInputPickerResponsiveLayout.ts`](https://github.com/microsoft/vscode/blob/6eb5f37d1c05683262724dba334221290d8f4188/src/vs/workbench/contrib/chat/browser/widget/input/chatInputPickerResponsiveLayout.ts)
  and `chatPhoneInputPresenter.ts` (compact pickers and phone-specific mode/model presentation).

## Adaptations

| Observed pattern | Robo-Boy implementation |
| --- | --- |
| One Markdown pipeline for streaming and completed content | `AssistantMarkdown`: react-markdown + remark-gfm, semantic tables/lists/code, copyable fences, resource mentions only in prose. No custom Markdown grammar or heavy syntax-highlighting runtime. |
| Trusted rendering boundary | Literal raw HTML, allowlisted link schemes, no model-authored remote image requests. Tool output remains literal text. T3's optional sanitized raw HTML/local-media machinery is not needed for Robo-Boy. |
| Composer editor + bottom actions; compact provider pickers | One input and action row; Edit/Goal/Plan/Ask, model and supported reasoning are directly selectable. Catalogs come from the account or local provider, with direct entry for unknown API-compatible models. Delivery options appear during work; drawing and manual context-budget controls are removed. |
| Responsive phone picker and keyboard-aware layout | Existing visual-viewport sheet retained; options use actual frame height, 44px actions, 16px mobile input, no forced keyboard on open. Tiny viewports no longer fabricate extra height. |
| Searchable history rather than a crowded composer | Dedicated chat-list view with current/working/archived state, rename, confirmed permanent deletion, empty results, fork/archive/export; Settings is a separate view. Explicit names survive auto-title snapshots. |
| User-controlled transcript following | Follow streaming when near the end; Latest message when reading older output. Tables and code own horizontal overflow. |
| Task lifetime independent of panel visibility | Hide does not cancel the connection-owned run. Explicit Stop, scope/account changes and quit remain ownership boundaries. Partial failure output remains an assistant message. |
| Tool identity, real outcomes and clear deadlines | Existing native tool loop retained; dispatch deadlines start after queued host work begins. Rejected malformed/oversized replies settle their pending calls immediately. Checkpoints avoid duplicating new tool observations; escaped context is budgeted. Disposal prevents queued mutations; native cancellation preserves the tool/task reason. |
| Ordered input delivery and scoped children | FIFO within interrupt/steering/queue priorities. Canceling a child settles the owned result even if its transport ignores abort; stale output is discarded and canceled children cannot start later. |
| Bounded streaming update work | Answer/thinking deltas accumulate immediately; UI snapshots publish at most every 50ms during a burst. Terminal messages use the complete snapshot and pending timers are disposed. The Markdown parser is lazy-loaded separately, retaining the existing PWA precache limit. |
| Reusable validation and replay receipts | Tool validators are compiled once per host scope. Completed native call identities replay observations without rerunning effects or spending another call allowance; new IDs still request fresh reads. |
| Review in the owner, distinct from execution | Pad/BT proposals require approval with truthful awaiting-review receipts; no authoring-policy settings switch. Existing journal Undo remains recoverable. Catalog updates and fresh reads fix save-then-select; runtime Pads retain explicit control activation and fill their tile. |
| Stable task status and durable user questions | A single checklist updates in place with done/running/pending/waiting/blocked steps. Answered agent questions remain assistant messages. Hidden disclosures unmount their content rather than copying blank list markers. |
| Reasoning and activity distinct from answers | Shared Markdown for provider-exposed thinking; expandable tool details, separate token usage, no synthetic user messages. |

## Remaining boundaries

This is not feature parity with a general-purpose IDE agent. Robo-Boy still owns one foreground
run per connection/chat context; switching chats cancels that run. Concurrent independent chat
runs, restart-resumable inference, arbitrary terminals/filesystem access, stdio MCP/OAuth,
rich Markdown diagrams and IDE code/diff renderers are not added by this change. Read-only child
investigations, steering, queued inputs, native tools, bounded diagnostics, profiles and granted
HTTP MCP integrations already exist; they are not reimplemented here. Robot execution stays in
the owning Pad/BT controls regardless of authoring policy.

Browser regressions exercise protocol fixtures, themes, desktop/phone/landscape and reduced
viewport geometry. They do not prove physical iOS/Android keyboard behavior, live paid-provider
quality, safe robot motion, or background operation after OS suspension.
