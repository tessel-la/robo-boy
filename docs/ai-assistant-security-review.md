# Assistant authentication security review

Review date: 2026-10-05. Scope: assistant settings, Electron credentials, provider transports,
OAuth callback, native IPC and official Claude Code subprocesses.

## Findings and changes

- **API-key storage favors OS protection without blocking use.** The default uses asynchronous
  `safeStorage`; failures fall back to native session memory, never implicit plaintext persistence.
  Each native operation is bounded to three seconds and failed availability is cached until restart.
  The OS may still show its own keychain permission/unlock dialog; asynchronous operation and a
  timeout keep Robo-Boy responsive but cannot dismiss that OS UI. Per-provider session-only and
  explicit plaintext modes bypass all keychain calls. The UI discloses actual storage and the
  plaintext risk. Existing plaintext records are upgraded where possible, otherwise preserved
  with disclosure; legacy encrypted records remain recoverable. Browser migration clears the
  live browser secret only after a native write succeeds, including empty session/clear markers.
  Failed writes keep the new key usable in session memory and preserve the previous disk record.
- **Credential-file ownership and write durability.** ChatGPT sessions and API keys share atomic
  record writes. POSIX directories are restricted to `0700`, records to `0600`; temporary files
  are synced before rename. ChatGPT tokens retain OS-backed encryption and failed persistence
  does not activate a new session in memory. Linux `basic_text` and unavailable keyrings are
  refused for ChatGPT tokens and automatic API-key encryption. API keys fall back to session memory.
- **OAuth callback shutdown.** The old callback forcibly closed active browser connections after
  writing confirmation. It now flushes the response before settling the attempt, closes gracefully,
  ignores duplicate completion, bounds idle clients and handles listener errors without an
  unhandled event. Tests read the full confirmation and verify session recovery after restart.
- **Post-login rendering.** Account/model replies are validated before updating component state.
  Malformed replies become an assistant-settings error instead of reaching the global app error
  boundary. A catalog that finishes after an account switch is discarded.
- **Claude prompt cleanup.** Private prompt directories are removed after success/failure/cancellation.
  The next runtime start also removes stale Robo-Boy chat directories left by a main-process crash.
  Credentials remain owned by the unmodified official CLI in its isolated configuration directory.

## Boundaries checked

The native bridge rejects external origins and embedded frames, validates bounded DTOs and permits
only the originating window to cancel a request. Subscription tokens do not enter renderer state,
browser storage, prompts or exports. OAuth uses loopback-only callbacks, state, nonce, PKCE and
signed issuer/audience/identity checks. Token refresh and credential updates are serialized; logout
clears the local session even when remote revocation fails. Authenticated OpenAI requests reject
HTTP redirects. Subscription failures never select a separately billed API transport.

Claude subprocesses do not inherit API keys, OAuth-token environment overrides, gateways or Node
customization. Runtime tools, hooks, plugins and MCP integrations remain disabled and permission
checks remain enabled. Thinking values are whitelisted; `ultracode`, executable flags and arbitrary
runtime settings cannot be supplied through the assistant request.

## Limits of this review

The original encrypted-storage review passed 268 assistant/native regression tests and one Chromium settings-flow test,
frontend/native type checks, focused lint, and web/Electron production builds. Both full
`npm audit` and `npm audit --omit=dev` report zero known vulnerabilities for this branch's
dependency lockfile. GitHub separately reports seven alerts on the repository's default branch
(three high, four moderate); this audit does not resolve or dismiss those default-branch alerts.

The current graceful-storage change passed 294 assistant/native regression tests, the Chromium
settings flow, frontend/native type checks, focused lint and the Electron production build.
The regression suite covers concurrent writes, encrypted restart recovery,
explicit local/session preferences, cleared-key precedence, missing/locked/basic-text backends,
rejected and hanging encryption operations, late completions, plaintext and encrypted migration,
damaged-record preservation, session usability after disk failure and renderer hydration races.
The Chromium settings flow verifies session disclosure and explicit plaintext selection alongside
subscription sign-in and thinking controls. Platform keychain behavior is mocked, not certified.

Automated tests use fake tokens, signed test identities, mock network responses and fake subprocesses.
They verify the storage contract, permissions, migrations, trust boundary and request behavior;
they do not constitute a penetration test or target-OS keychain certification. No real account
credentials were decrypted or printed, and no subscription inference was run for this review.

The reported crash after OpenAI consent has no available crash trace in this workspace. The
callback and renderer failure paths above were corrected and regression-tested, but that does not
establish the cause of the user's particular crash. OS/native renderer failures need their own
crash trace to diagnose. Successful account persistence can survive a later UI/process failure.

See [credential and thinking setup](ai-assistant.md#api-keys-and-subscription-sign-in) for current
platform support and [privacy boundaries](ai-assistant.md#privacy-and-credentials) for storage limits.
