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
still compete for one lock. The control-session label remains editable; it is not an
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
configure the provider to include a `groups` array in its signed ID token and set the exact
required group value. Entra ID, Okta and Keycloak use the same OIDC boundary; their tenant,
client registration and claim-mapping settings remain provider-specific.

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
- Login heading, explanatory text and HTTPS support link
- An accent color for the login action, with the rest of the UI following Robo-Boy's current theme

Point `ROBOBOY_BRANDING_FILE` at the file when building. The broker uses the same file for its
browser completion screen. Invalid colors, remote logo URLs, unknown fields, script URLs and
unsupported versions fail configuration validation. Copy new logo assets into `public/branding/`
before building. Use assets your company is authorized to distribute; the example is fictional.

This is declarative branding, with no injected HTML, CSS or executable tenant code. Feature
surfaces belonging to one company should use the existing external Panel SDK. Native application
identifiers, installer names, OS icons and signing certificates remain platform packaging settings.

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

`ROBOBOY_AUTH_SESSION_SECONDS` defaults to **3600** and accepts **60–86400**. Sessions expire at
the earlier of that duration and the verified ID token expiry. There is no silent refresh.
Logout or expiry immediately revokes the broker session and closes its WebSockets and active
HTTP streams; closing the robot socket triggers the existing ownership-recovery behavior.
The frontend rechecks server state every 10 seconds and unmounts robot components on loss of
access. Persistent trees retain the robot control model's documented disconnect behavior.

An unavailable identity provider cannot grant a new session. An unavailable broker never
falls back to raw robot ports. Restarting the broker signs out all sessions. Session state is
bounded to 1024 sessions and 128 pending requests per sign-in stage; it is held in memory on
one broker per deployment. Company policy scales through the identity provider, and the same
configuration supports separate robot/cell deployments without company-specific source forks.
Multiple broker replicas would require a shared session store and coordinated revocation;
they are not supported by this in-memory implementation.

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

The gateway suite uses a real local issuer with signed JWTs and simulated robot endpoints. It
covers callback binding, replay, wrong token claims, group restrictions, native proof handoff,
unauthorized reads and writes, scoped media access, credential stripping and WebSocket revocation.
Browser tests exercise branded login/logout, the native handoff and confirmation flow, and a
320 px login layout in Chromium and Firefox. The ordinary suite continues to cover login-disabled
connections and robot ownership. No test requires an employee account or controls real hardware.
