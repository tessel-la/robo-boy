# Enterprise login and company branding

Use your company's OpenID Connect identity provider to decide who can access a Robo-Boy
deployment. Keep employee accounts, MFA, password policy and app assignment in that provider.
Robo-Boy does not store employee passwords or create a second user database.

Login is **off by default**. A normal web or packaged build keeps its existing connection flow.
Branding is independent: you can brand a build without requiring login.
The login guards backend data and operations. Frontend bundles, branding and installed-panel
assets retain their public-static distribution model; put no credentials in those assets.

The optional enterprise overlay defaults `ROBOBOY_ENTERPRISE_LOGIN=true`. That one deployment
flag feeds both the server policy and the frontend build flag. Set it to `false` and rebuild
the overlay to keep a branded, managed deployment without requiring sign-in. Disabling login
intentionally permits unauthenticated access; robot ownership is still enforced independently.
In that mode, issuer, client ID and secret-file settings may be omitted. Enabled mode refuses to
start without valid provider credentials.

## Architecture

```text
Web app:      secure HttpOnly session cookie
Packaged app: system-browser sign-in -> one-time handoff -> in-memory session credential
                       |
                       v
            Caddy HTTPS -> enterprise gateway (Node.js)
                              | OIDC authorization code + PKCE, state, nonce and signature checks
                              | with the company's identity provider
                              v
                       private Caddy routes
                              |
                 ROS control gateway, camera, recordings, installed panels
```

The optional gateway in `infra/enterprise/gateway.mjs` owns access sessions. It uses
`openid-client` for OIDC validation, `http-proxy` for HTTP and `ws` for WebSockets.
`src/features/enterprise/` owns the login UI, public branding and client transport. Runtime
endpoint selection stays in `src/runtime/runtimeConfig.tsx`.

Authentication answers **who may access this deployment**. The existing robot gateway still
answers **which connected session currently owns control**. Signing in does not acquire the
control lease or change the optional robot-side `allow_control` switch. Two signed-in tabs
still compete for the selected robot’s lock. The control-session label remains editable; it is not an
authenticated employee audit trail. Panel installation also retains its separate admin token.

## Set up the hosted deployment

The supplied overlay targets a Linux robot host, using the same host networking as the ROS
stack. Use Docker Compose **2.24.4 or newer**. Register a confidential web client in your OIDC
provider with this exact callback:

```text
https://robots.example.com/auth/callback
```

Enable the authorization code flow and `openid profile email` scopes. Assign the application
to the employees who should use it. Use a tenant-specific issuer. To restrict access to a group,
set `ROBOBOY_OIDC_REQUIRED_GROUP`. The gateway reads `ROBOBOY_OIDC_GROUPS_CLAIM` (default
`groups`, a string or array) from the signed ID token, or from userinfo when the ID token omits
it. Provider notes:

- **Keycloak:** add a _Group Membership_ mapper. Its default full paths (`/robot-operators`) match.
- **Okta:** add a groups claim and set `ROBOBOY_OIDC_SCOPE="openid profile email groups"`. If Okta
  rejects `prompt=select_account`, set `ROBOBOY_OIDC_PROMPT=login` or `off`.
- **Entra ID:** group claims carry object IDs and are omitted above 200 groups. Prefer an app
  role and set `ROBOBOY_OIDC_GROUPS_CLAIM=roles` with the role value as the required group.

### Google and Microsoft sign-in

The gateway can offer company OIDC, Google and Microsoft side by side. Configure any combination;
the login screen shows one button per provider, and older apps get a chooser page in the browser.
Register `https://robots.example.com/auth/callback` as the redirect URI with each provider.

- **Google:** create an OAuth web client in Google Cloud and set `ROBOBOY_GOOGLE_CLIENT_ID` and
  `ROBOBOY_GOOGLE_CLIENT_SECRET_FILE`. The gateway refuses to start without an access policy:
  `ROBOBOY_GOOGLE_ALLOWED_DOMAINS` admits Google Workspace accounts by their verified `hd` claim,
  and `ROBOBOY_GOOGLE_ALLOWED_EMAILS` admits individual verified addresses. An email domain alone is
  not trusted, because a personal Google account can verify any address.
- **Microsoft:** register a web app in Entra ID and set `ROBOBOY_MICROSOFT_CLIENT_ID`,
  `ROBOBOY_MICROSOFT_CLIENT_SECRET_FILE` and the directory (tenant) ID in `ROBOBOY_MICROSOFT_TENANT`.
  Multi-tenant endpoints (`common`, `organizations`) are rejected. To admit only some employees,
  define an app role and set `ROBOBOY_MICROSOFT_REQUIRED_ROLE`, or require assignment in Entra ID.

Account IDs from Google and Microsoft are namespaced (`google:<sub>`, `microsoft:<sub>`).

The gateway session lasts `ROBOBOY_AUTH_SESSION_SECONDS`, independent of the provider's ID-token
lifetime. Revoking an employee in the provider takes effect at the next sign-in; use a short
session lifetime when revocation must be faster. A cancelled or denied provider sign-in shows
a browser page and is reported to a waiting packaged app.

Add the settings from [the example environment file](../config/enterprise.example.env) to
your ignored `.env` file. Store the actual client secret in `.secrets/oidc-client-secret`, with
permissions that let the broker container's non-root Node user (UID 1000) read it. Do not put the secret in
a `VITE_*` variable, a branding file, a Git commit or a frontend bundle. The secret is mounted
read-only into the broker. Environment and secret files are excluded from Docker build contexts.

Start the enterprise variant:

```bash
docker compose -f docker-compose.yml -f infra/compose/enterprise.yml up -d --build
```

Caddy obtains TLS for `ROBOBOY_ENTERPRISE_ORIGIN`; DNS and certificate issuance must work for
that host. The overlay builds the production frontend with login enabled, serves it with Nginx
on loopback, and binds Robo-Boy's ROS and video endpoints to loopback. The recordings TCP
listener, if selected, also binds loopback. Only the authenticated HTTPS entry is intended for
remote employee access. The default Caddy deployment and the enterprise deployment share the
same backend route definitions.

External mesh servers, robot web apps, Ollama and media gateways remain deployment-owned.
Bind their administrative/HTTP endpoints privately or protect them independently. WebRTC media
uses the media gateway's ICE transport directly and keeps that gateway's access policy. Native
ROS/DDS tools and trusted processes on the robot host remain outside web authentication.

The standalone Panel Manager is optional, as in the default installation. If you combine its
Compose overlay with enterprise, publish its port only on `127.0.0.1:4100`, and mount installed
panel assets into `/usr/share/nginx/html/panels` in the production app. Its admin token is still
required. Do not publish the private app or broker ports.

## Build web and packaged apps

For a local build against an existing enterprise gateway:

```bash
VITE_ENTERPRISE_LOGIN=true \
VITE_ENTERPRISE_SERVER_URL=https://robots.example.com \
ROBOBOY_BRANDING_FILE=config/branding.example.json \
npm run build
```

Use the same variables with `npm run build:tauri` or `npm run build:electron`. Native packaging
then follows the ordinary platform workflow. Enterprise Electron builds disable the normal LAN self-signed-certificate exceptions; install a certificate trusted by the operating system, including for private robot addresses. The public enterprise URL and branding are compiled
into the frontend. OIDC credentials exist only on the gateway. The `VITE_ENTERPRISE_LOGIN` flag
must be `true` or `false`; invalid values fail the build. The hosted Compose overlay supplies
the enabled flag and matching URL automatically. Enterprise web builds omit the offline service
worker because access must be checked online. When converting an existing PWA on the same
origin, unregister its old service worker first; a new company origin avoids that migration.

Packaged apps open the system browser using the shell's native browser opener. The gateway
performs the same OIDC flow, then delivers the result once to the app that proves possession of
the random handoff secret. Handoffs expire after 5 minutes and cannot be replayed. The app asks
you to confirm the signed-in account before mounting the workspace. No embedded identity-provider
webview, client secret, custom deep link, or per-platform callback registration is required.

The default permitted native origins are `app://robo-boy`, `tauri://localhost`,
`http://tauri.localhost` and `https://tauri.localhost`. If a native development build uses an HTTP
Vite origin, add that exact origin through the broker's `ROBOBOY_AUTH_NATIVE_ORIGINS` setting.
Production origins and issuers require HTTPS. Loopback HTTP is allowed for the isolated test
fixture, but the native browser opener deliberately accepts only HTTPS login links.

To return to the standard installation entirely, stop the enterprise services and rebuild with
only `docker-compose.yml`. Keep the robot's recovery-journal and recording volumes; no data
removal is needed. Packaged apps must be rebuilt with `VITE_ENTERPRISE_LOGIN=false` when access
requirements change. Setting `VITE_ENTERPRISE_SERVER_URL` still pins a login-disabled managed
build to that HTTPS gateway; leave it unset to restore the ordinary direct-host workflow.

When enterprise login is disabled, native apps keep their direct robot-host workflow. When it
is enabled, robot endpoints are pinned to the configured enterprise gateway; saved raw host
addresses cannot bypass it. The server still enforces authentication if someone alters the
frontend flag or uses another WebSocket client.

## Customize the interface

Use [the branding example](../config/branding.example.json) as a template. The versioned public
configuration supports:

- Company name in the login screen, connection screen, workspace account bar and native title bar
- A bundled logo under `public/branding/`
- Login eyebrow (the small label above the heading), heading, explanatory text and HTTPS support link
- Optional rotating heading/message pairs, with manual navigation and pause controls
- A default company theme using the existing custom-theme format, plus an optional wordmark logo
- Account and sign-out controls in the existing connection menu, without a second workspace header

A small **Powered by Robo-Boy** attribution appears on the connection screen and in the workspace's
connection menu, including company editions with login disabled. The login screen uses the same
attribution in its footer. Branding does not remove it.

Point `ROBOBOY_BRANDING_FILE` at the file when building. The broker uses the same file for its
browser completion screen. Invalid colors, remote logo URLs, unknown fields, script URLs and
unsupported versions fail configuration validation. A `theme` object accepts `id`, `name`,
`fontFamily` and `colors` (the existing custom-theme fields); color values must be six-digit hex.
Set `logoWordmark=true` for a complete company wordmark; symbol logos display beside the company name.
The company theme applies before the first paint, remains available in the theme picker and has
its own saved selection key, so operators can change it without another company replacing their choice. Copy new logo assets into `public/branding/`
before building. Use assets your company is authorized to distribute; the example is fictional.

This is declarative branding, with no injected HTML, CSS or executable tenant code. Feature
surfaces belonging to one company should use the existing external Panel SDK. Native application
identifiers, installer names, OS icons and signing certificates remain platform packaging settings.

### Edit the login text

All copy beneath the company mark belongs to the branding file:

| Field | Behavior |
| --- | --- |
| `loginEyebrow` | Small label above the heading; defaults to `Your robotics workspace`. Set `""` to hide it |
| `loginTitle` | Static heading, up to 200 characters; cannot be blank |
| `loginMessage` | Static supporting sentence, up to 500 characters; `""` hides it |
| `loginSlides` | Optional array of up to eight `{ "title": "…", "message": "…" }` pairs, with the same text limits |

Omit `loginSlides` or set it to `[]` to keep the existing static heading and sentence. A single
slide is also static. With two or more, the slide pairs replace `loginTitle` and `loginMessage`
and advance in order every 8 s, wrapping to the start. For example:

```json
{
  "version": 1,
  "name": "Example Manufacturing",
  "loginEyebrow": "Company operations",
  "loginSlides": [
    { "title": "Start your shift.", "message": "Choose a robot and open your workspace." },
    { "title": "See your fleet.", "message": "Use the tools your team needs." }
  ]
}
```

Operators can pause, resume, or browse messages. Hover pauses temporarily; focusing the navigation
or selecting a message stops automatic rotation until **Play messages** is selected. Hidden tabs
stop their timer. Reduced-motion preferences disable automatic rotation while preserving manual
navigation. The layout reserves room for the longest slide so sign-in controls stay in place.
Only the active slide is exposed to assistive technology; automatic changes are not announced.
Timers and preference/visibility listeners are removed when the login screen unmounts.

Copy is public plain text, escaped by React. It cannot inject markup, styles, scripts or provider
settings. Provider button labels still come from the configured authentication providers. These
settings affect the login screen in web, Electron and Tauri; they do not replace the robot connection
screen, loader, gateway completion messages, or security notices. Editing JSON requires rebuilding
the frontend and redistributing native packages. Keep the gateway on the same branding-capable
release when it loads the same file.

Existing version-1 branding files remain valid. Older Robo-Boy pins reject these new fields, so
update the core release/submodule pin before adding them to a company file. In the company starter,
edit `companies/<company>/branding.json` and use its normal build/package commands. No React patch
or new company-specific component is needed. A separate company repository is optional; a direct
build can use an externally maintained JSON file via `ROBOBOY_BRANDING_FILE`.

See [the enterprise branding architecture review](enterprise-branding-review.md) for the repository
ownership recommendation and the inspected starter's upgrade considerations.

## Select robots after sign-in

A company login grants access to every robot in its server-owned registry. Set
`ROBOBOY_ROBOTS_FILE` to a JSON file shaped like `config/robots.example.json`, then restart the
gateway. Each entry has a unique `id`, a display `name` and a private loopback HTTP `upstream`.
The upstream is that robot's private proxy, with the same routes as the existing private Caddy
listener. Provision additional private robot proxies in deployment configuration. The registry
is never compiled into public frontend assets; only IDs and names are returned to signed-in users.
An empty list keeps the classic landing page, host/IP and service-port fields, recent connections,
and the existing connection/loading flow. Company login gates the application; it does not select
or authenticate an arbitrary robot. A browser's Quick Connect still uses its same-origin backend.
A packaged app asks for a robot host on first launch, then offers the last successful connection.
Manual connections use the ordinary direct/proxy rules and send no enterprise credential to a
separate host or port. Robots reached directly need their own network access policy and control
gateway; company sign-in cannot protect a separately exposed rosbridge. HTTPS web installations
need HTTPS/WSS and suitable CORS on any directly selected remote backend.

For a managed fleet, configure a nonempty registry. Its selector replaces manual host selection;
saved raw addresses cannot bypass registry routing.

The connection screen keeps a **Robot** selector after sign-in. Open additional robots through
**Open another connection**; workspaces, sockets and control ownership remain independent.
HTTP and WebSocket requests use `/robots/<id>/...` through the same authentication gateway.
The server strips the namespace and enterprise credentials before forwarding. Unknown IDs and
administrative paths inside a robot namespace are rejected. Clients cannot choose arbitrary
upstream URLs, and signing out closes connections to all robots. Native media read credentials
also support these robot-scoped routes. This selection requires login-enabled deployments;
login-disabled installations retain their normal connection workflow.

## Session lifetime and failure behavior

Web session credentials use host-only, Secure, HttpOnly, SameSite=Lax cookies. State and nonce
bind the browser callback, PKCE protects code exchange, and signed ID tokens are checked against
the provider's issuer, audience and keys. Cookie-authenticated writes require the exact public
origin. Provider errors are sanitized rather than echoing tokens or codes.

Native credentials remain in memory and are not saved in browser storage. They travel only to
the configured enterprise origin. Robot WebSockets authenticate in their first message; no
robot connection opens before that check. Native images, meshes and recording workers use a
separate random read credential restricted to GET/HEAD under video, mesh and recording routes.
Canonical runtime endpoints, saved connection keys and recording descriptors never contain this
credential. It is attached only when an image, mesh, download or recording-worker request is sent.
That credential cannot send commands or call administrative APIs. It expires and is revoked
with its parent session. Treat those URLs as credentials: the enterprise entry does not log
request URLs, and responses use `no-store` and `no-referrer`. Backend responses cannot overwrite
the broker's session cookies. Credentials are stripped before forwarding to robot services.
Feature-owned Authorization headers, such as a media gateway credential or the Panel Manager's
admin token, retain their existing transport; they do not authenticate a Robo-Boy access session.

`ROBOBOY_AUTH_SESSION_SECONDS` defaults to **3600** and accepts **60–86400**. Sessions expire
after that duration, independent of the provider's ID-token lifetime. There is no silent refresh
and the client holds no refresh token.
Logout or expiry immediately revokes the broker session and closes its WebSockets and active
HTTP streams; closing the robot socket triggers the existing ownership-recovery behavior.

Five minutes before expiry the workspace shows a non-blocking notice with **Sign in again**. The
web app opens the provider sign-in in a new tab (`/auth/login?renew=1`, which ends on a completion
page instead of loading a second workspace) and picks up the new cookie at its next session check;
if pop-ups are blocked it falls back to the ordinary sign-in redirect. The packaged app runs the
normal browser handoff and identifies its current session when starting it. When the fresh sign-in
is the same provider subject, the broker moves that session's live robot WebSockets and HTTP
streams to the new session, so control and its ownership lease continue uninterrupted under the
new expiry. A different account closes them, and the app asks you to confirm the new account
before mounting the workspace again. A renewed packaged-app credential replaces the old one in
memory; the old one stays valid only until its original expiry, without any connections.
The frontend rechecks server state every 10 seconds and unmounts robot components on loss of
access. Persistent trees retain the robot control model's documented disconnect behavior.

An unavailable identity provider cannot grant a new session. An unavailable broker never
falls back to raw robot ports. Session state is bounded to 1024 sessions and 128 pending requests
per sign-in stage. Company policy scales through the identity provider, and the same configuration
supports separate robot/cell deployments without company-specific source forks.

### Recover sign-ins after a gateway restart

The enterprise Compose overlay stores completed access sessions in its **enterprise-sessions**
volume, at `/var/lib/roboboy-auth/sessions.json`. Restarting or recreating the gateway with that
volume preserves unexpired web cookies, native credentials held by running apps, and their
read-only media access. Recovery keeps the original expiry; a restart never extends a session.
Existing memory-only sessions need one sign-in after upgrading to this version.

For a standalone Node gateway on Linux, set `ROBOBOY_AUTH_SESSION_FILE` to an absolute path in a
private writable directory. The gateway creates a missing directory with mode `0700` and its file
with mode `0600`. It rejects symlink files, loose file permissions, or a directory writable by other
users. Without this setting, standalone/test gateways retain memory-only sessions.

The file contains credential hashes, provider and user identifiers, the display name, and expiry.
It contains no raw cookie, native or media token, provider token, client secret, or pending login
proof. Sign-in, renewal, logout, and expiry commit an atomic snapshot before reporting success.
Snapshots synchronize both file contents and the containing directory; a killed process cannot
leave a partially written session file. Writes happen when access sessions change, not for robot
commands, session checks, or telemetry. The bounded snapshot needs no separate database service.

The store belongs to one gateway process. A second writer is rejected; after a crash its abandoned
writer lease becomes recoverable after 10 s. The Compose restart policy retries startup. Do not
share this volume across active gateway replicas or manually remove a live writer's lock. A lost
writer lock or failed write fences authenticated access, closes live authenticated connections,
and returns an unavailable response. A failed logout commit is never acknowledged as successful.
Corrupt or unreadable storage prevents startup instead of bypassing authentication.

Saved sessions are bound to the public origin, session lifetime, provider issuers/client IDs, and
provider access restrictions. Changing those settings invalidates saved sessions. Branding and
robot-registry changes do not. To revoke every persisted session, stop the gateway, delete its
session file, and start it again. Keep the volume for ordinary upgrades; do not restore an old
snapshot as a routine rollback because it can restore credentials revoked after that snapshot.

A gateway restart still drops active sockets and streams. Clients reconnect using their restored
access session, and the robot control gateway applies its normal disconnect, action-recovery, and
ownership rules. Login persistence never restores a robot-control lease automatically. Pending
OIDC callbacks and unredeemed native handoffs are discarded and must be started again. A packaged
app that itself restarts still needs to sign in because its raw credential remains memory-only.
Multiple active gateway replicas still require shared transactional session storage and coordinated
connection revocation; this deployment does not support them.

## Current boundaries

- Provider logout, employee deprovisioning and changed groups take effect at reauthentication or
  local session expiry. This version has no OIDC back-channel logout, SCIM or role editor.
- Robo-Boy sign-out ends its access session; it does not sign you out of other company applications
  or erase the identity provider's browser SSO session.
- If logout cannot reach the broker, only local disconnect is guaranteed until the server session
  expires or is revoked. The UI reports that failure and does not reopen the workspace automatically.
- The native app requests sign-in again after a reload or restart. There is no persisted refresh token.
- Employee login does not partition existing browser/OS profile data. Workspace preferences and
  separately configured assistant credentials retain their existing storage rules; use separate
  profiles where those must be isolated between employees. Signing out does not erase workspaces.
- External streams, native ROS access and arbitrary embedded robot applications need their own
  deployment access policy. This gateway protects Robo-Boy's proxied HTTP and WebSocket routes.
- Integration tests use a local signed OIDC issuer. A production tenant still needs acceptance
  testing for its app assignment, MFA, claims and TLS settings. Native opener code is shared across
  platforms; Linux compile checks do not certify a macOS, Windows, iOS or Android installer.

## Verification

```bash
npm run test:enterprise
npm run test:run
npm run e2e:enterprise
npm run build
```

The gateway suite uses a real local issuer with signed JWTs and simulated robot endpoints. Restart
tests cover restored browser/native access, media and sockets, logout, expiry during downtime,
policy changes, abandoned handoffs, process death, writer-lock recovery, corrupt/private storage,
and fail-closed write errors. The suite also covers callback binding, replay, wrong token claims,
group restrictions, native proof handoff,
unauthorized reads and writes, scoped media access, credential stripping and WebSocket revocation.
Browser tests exercise branded login/logout, the native handoff and confirmation flow, and a
320 px login layout in Chromium and Firefox. The ordinary suite continues to cover login-disabled
connections and robot ownership. No test requires an employee account or controls real hardware.

Enterprise Electron builds and packages with a custom application name do not use the upstream
in-app installer. Update them by building and distributing a new company package; a stock release
cannot preserve their compiled provider/server configuration and branding.
