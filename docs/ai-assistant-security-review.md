# Assistant authentication security review

Review date: 2026-10-05. Scope: assistant settings, Electron credentials, provider transports,
OAuth callback, native IPC and official Claude Code subprocesses.

## Findings and changes

- **API keys were stored in plaintext settings.** Electron now stores per-provider keys in encrypted
  native records and hydrates them into renderer memory for the existing API transports. Migration
  clears the live browser entry only after native persistence succeeds; failed migration retains
  the old key and reports an error. Other deployment modes retain their disclosed browser storage.
- **Credential-file ownership and write durability.** ChatGPT sessions and API keys share OS-backed
  encryption and atomic record writes. POSIX directories are restricted to `0700`, records to
  `0600`; encrypted temporary files are synced before rename. Failed persistence does not activate
  new ChatGPT session state in memory. Linux `basic_text` and unavailable keyrings are refused.
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
