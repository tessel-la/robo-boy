# AI Subscription Integration Investigation

Research date: 2026-10-05. Code inspected at `dev` commit `9378813`.
This records the original feasibility investigation. A subsequent Electron implementation now
provides API-key/subscription selection; see [current setup and boundaries](ai-assistant.md#api-keys-and-subscription-sign-in).
“Cloud” in the request is interpreted as Claude.

## Finding

Users can potentially power Robo-Boy's assistant with an existing subscription, but the supported
integration differs by provider. Subscription billing still requires a network protocol; the goal
is to remove the separately billed API key requirement.

| Option | Current official support | Fit for Robo-Boy |
| --- | --- | --- |
| ChatGPT plan through Sign in with ChatGPT | Eligible Plus/Pro accounts can authorize plan usage in open-source/local apps. Commercial/remote offerings have separate access requirements. | Best first implementation: add a subscription provider to the existing assistant, starting with Electron. |
| Claude subscription through Robo-Boy's own HTTP client | Third-party apps may not offer Claude.ai login or route model requests using users' subscription credentials. | Do not implement a token-based replacement for the Anthropic API provider. |
| User signs into unmodified Claude Code | Permitted under Anthropic's stated product integration conditions; users authenticate through Anthropic and use their own credentials. | A distinct desktop runtime integration, requiring a separate feasibility spike. |

Sources: [OpenAI quickstart](https://developers.openai.com/siwc/quickstart),
[ChatGPT plan overview](https://developers.openai.com/siwc/token-sharing-open-source),
[Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).

The repository is Apache-2.0 licensed. That makes the open-source route relevant, but documentation
and licensing alone do not prove a particular account's eligibility or a deployment's approval.

## Current Behavior and Invariants

The existing flow is:

```text
GlobalAssistant: context + conversation + images
  -> sendAssistantChat / SendChatRequest
  -> vendor HTTP transport
  -> complete raw text
  -> parseAssistantResponse and domain validators
  -> existing workspace handlers or proposal editors
```

Evidence in the current source:

- [Provider contract](../src/features/assistant/providers/types.ts): five provider IDs, API key,
  base URL, model, multi-turn messages, JSON-mode request, progress/token callbacks, and cancellation.
- [OpenAI adapter](../src/features/assistant/providers/openai.ts) reuses
  [OpenAI-compatible chat](../src/features/assistant/providers/openaiCompatible.ts), calling
  `/chat/completions` with a system message, temperature, and `response_format`.
- [Anthropic adapter](../src/features/assistant/providers/anthropic.ts) calls `/messages` with a
  supplied API key. Its browser-access header does not confer subscription access.
- [Settings persistence](../src/features/assistant/storage/assistantStorage.ts) stores settings,
  including API keys, in plaintext browser storage. There is no OAuth/session credential owner.
- [GlobalAssistant](../src/features/assistant/components/GlobalAssistant.tsx) submits the full
  conversation and checks cancellation and ROS connection generation before applying a parsed result.
  Workspace edits use existing handlers immediately; Pad/BT proposals go through their editor flows;
  proposed ROS operations remain review-only.
- [Electron preload](../electron/preload.ts) exposes named native capabilities. The renderer has
  context isolation and no Node integration in [main.ts](../electron/main.ts). There is no assistant
  process or secret-store bridge. Web has no application backend; Tauri needs its own native owner.

A new provider should reuse this flow. Preserve JSON parsing, Pad/BT validation and review,
review-only ROS operations, connection-generation checks, cancellation, and external-panel isolation.
Changing the inference transport must not grant shell, filesystem, or direct robot execution.

## Recommended ChatGPT Implementation

Start in Electron, where a native process already exists. Keep account credentials and model requests
in that process and expose only narrowly validated account, model, send, and cancel operations through
the desktop bridge. Validate the caller and request shape; do not expose arbitrary URLs or tokens.
Persist only the provider/model and an opaque account reference in frontend settings.

OpenAI publishes an Electron example and a devkit using `@siwc/local` and `@siwc/react`. Evaluate
its packaging and license before adopting it; those dependencies are not currently installed here.
Reusing the supported auth runtime is preferable to hand-writing OAuth/JWT verification.
See the [official integration example](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt).

The auth contract requires a stable installation host ID, a loopback callback, fresh state/nonce and
PKCE, retaining the issued client ID, validating the ID token, and checking the granted plan-use scope.
Identity-only sign-in does not enable inference.
See [registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).

Credentials need protected native storage, isolated account records, atomic updates, serialized token
refresh, and logout/revocation handling. An account change must cancel its in-flight requests and
invalidate late replies. The current plaintext API-key storage is unsuitable for these tokens.
See [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

Add an explicit subscription provider behind `SendChat`, with credentials resolved natively rather
than passed in `settings.apiKey`. Discover models for the selected account. Translate the prompt,
history, and images to `/v1/responses`; collect output and require `response.completed` before
returning text. Handle failures, incomplete responses, and an interrupted stream as errors, including
errors that arrive after text begins streaming.
See [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

This is not compatible with simply substituting a subscription token into the current OpenAI adapter:
the plan route requires `store: false`, `stream: true`, context supplied in `input`, and instructions
or developer messages. Several existing parameters, including temperature, are unsupported. Audio
and transcription are outside this route. Keep text/image support explicit, retain local browser
speech where available, and require a separately selected supported transcription route for recordings.
Confirm structured-output support in the spike; otherwise retain prompt-based JSON and the existing
parser. See [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

Settings need Continue with ChatGPT, the connected account, a discovered model picker, account switching,
sign-out, a plan-usage indicator, and Manage usage. Limit or consent errors must be actionable.
Never silently switch to separately billed API usage.

Codex app-server is also documented for this plan route, but adds a child-process/runtime lifecycle
that the current assistant does not need. Prefer direct Responses requests through the auth runtime;
consider app-server only if a later feature actually needs Codex's agent runtime.
See [Codex app-server integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).

## Claude Alternative

Anthropic distinguishes custom apps using its API/Agent SDK from end users signing into the unmodified
Claude Code binary. Product integrations must preserve its built-in authentication methods and cannot
collect or intermediate Claude.ai credentials or resell users' usage. The Agent SDK is not a blanket
subscription-login entitlement for third-party apps.
See [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).

A credible separate spike would launch the official binary from the native shell, let the user
complete Anthropic's own login, and adapt its completed output to Robo-Boy's existing parser.
Claude Code supports subscription sign-in and programmatic execution; these are different from
making Robo-Boy's own HTTP calls with its OAuth tokens.
See [authentication](https://code.claude.com/docs/en/authentication) and
[programmatic execution](https://code.claude.com/docs/en/headless).

Before adopting this path, prove that its runtime can be constrained to the assistant's current
capabilities, with no ambient shell/filesystem/robot access, hooks, or inherited MCP configuration.
Also prove JSON output, full-history compatibility, cancellation, process cleanup, platform packaging,
and missing-binary/version errors. Do not turn off permission checks to make it work. If those constraints
cannot be enforced, keep Claude Code as an external user-controlled tool and investigate a narrow
Robo-Boy MCP bridge instead; the current [assistant guide](ai-assistant.md#future-external-agent-mcp-integration)
describes that unimplemented alternative.

## Deployment Scope and Effort

These are engineering estimates from the inspected architecture, not delivery commitments:

| Increment | Rough effort for one engineer | Main uncertainty |
| --- | --- | --- |
| ChatGPT Electron spike: sign-in, protected session, one completed text/image + JSON turn | 2–4 days | Devkit packaging, account access, JSON reliability |
| Ship Electron support with account/usage UI, refresh/revocation, cancellation and tests | About 1–2 weeks total, including the spike | Secure storage across target OSes and release validation |
| Claude Code runtime feasibility spike | 2–4 days | Product integration fit and enforceable capability restrictions |
| Web, Tauri and mobile support | Estimate after the first spike | Different credential owners, callback and deployment constraints |

Electron is the smallest first scope. Tauri desktop needs equivalent native auth/storage/transport.
A browser-only implementation cannot host the documented loopback listener or hold these tokens in
browser storage; web needs an authenticated local/self-hosted companion with origin checks and
isolated sessions. That is a new application-runtime boundary. Paid or remotely hosted offerings
need their access conditions checked separately. Mobile needs its own supported callback/storage
design; desktop CLI execution is not a phone-local solution.

## Proof Required Before Shipping

Use focused tests around OAuth callback validation, identity/scope checks, credential isolation,
refresh races, failed revocation, IPC caller validation, stream completion/error handling, cancellation,
account switches, and stale ROS connections. Run existing provider, storage, parser, and assistant
component tests to preserve the review flows. Add an end-to-end Electron sign-in/request test and
target-OS packaging checks. Finally verify one completed inference with an eligible real account;
sign-in or a populated model list alone does not prove subscription inference works.

The original investigation used current official documentation and source inspection without login,
live inference or robot operations. The subsequent Electron implementation adds the documented
authentication routes, native credential ownership, request cancellation and settings controls.
Automated OAuth, IPC, provider, subprocess and settings tests cover those boundaries. Live inference
with an eligible account and target-OS packaging remain release checks.
