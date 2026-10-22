# Enterprise branding architecture review

Reviewed on 2026-10-21 against Robo-Boy `dev` at `7506921` and the local
`robo-boy-company-starter` checkout. The existing split is sound: Robo-Boy already owns the login
feature, while the starter supplies company data and builds. Keep that split for maintained company
editions. A separate repository is useful deployment ownership, not a prerequisite for branding.

## What exists and what changes

Before this change, `loginTitle` and `loginMessage` already customized the heading and supporting
sentence beneath the company mark. They were rendered as static text by
`src/features/enterprise/EnterpriseBoundary.tsx`. There was no list or rotation setting: the validator
in `infra/enterprise/config.mjs` rejected unknown fields. This was an unsupported capability rather
than a broken advertised feature.

The small `Your robotics workspace` label was hardcoded. That was a minor customization gap:
changing it required patching the core component. This branch adds `loginEyebrow` and optional
`loginSlides` to the existing public branding contract, with validation, accessible navigation,
and login-owned timer cleanup. The default installation and existing company JSON files stay static.
See [the enterprise guide](enterprise.md#edit-the-login-text) for the configuration contract.

No robot commands, access policies, session storage, provider selection or gateway authentication
logic are changed. The new fields are public presentation data, not an authorization mechanism.

## Where the responsibilities belong

| Responsibility | Owner | Reason |
| --- | --- | --- |
| Login layout, supported copy fields, validation and accessibility | Robo-Boy | One implementation across web, Electron and Tauri |
| OIDC, session handling, secure transport and robot access enforcement | Robo-Boy | Security fixes must reach every edition through upstream updates |
| Company wording, authorized logos, palette and default theme | Deployment/company configuration | These change independently of product code |
| Provider tenant, account policy and secret references | Deployment configuration; values in the identity provider/secret store | Branding files and frontend assets are public |
| App identifiers, OS icons, signing and installer distribution | Company packaging/deployment | Branded installers have their own release identity and lifecycle |
| Company-specific tools | External panels through the Panel SDK | Avoid tenant branches inside the application shell |

The starter's `scripts/company.mjs` calls upstream `loadBranding`; its `scripts/build.mjs` stages
assets outside the submodule and passes `ROBOBOY_BRANDING_FILE`, `ROBOBOY_PUBLIC_DIR` and
`ROBOBOY_DIST_DIR` to upstream builds. Its Compose override changes build inputs and reuses the
upstream gateway and private-route definitions. The starter does not own a second login component.
Those boundaries are worth preserving.

## Separate repo or one Robo-Boy checkout?

For a maintained enterprise edition, keep a deployment repo with a pinned Robo-Boy release,
branding assets, packaging configuration, CI and environment templates. It gives the company
independent reviews and release cadence, keeps its assets out of the standard product, and avoids
source forks. The cost is an explicit upstream update and acceptance test for every supported
deployment. A Git submodule is adequate here; replacing it with another dependency system would
add migration work without fixing a demonstrated issue.

For one installation with a logo and a few text changes, the starter is optional. Point a normal
Robo-Boy build at an externally managed branding JSON file and stage its assets in the configured
public directory. This consumes the same contract without maintaining wrapper scripts. Authentication
still uses the optional upstream enterprise gateway.

Embedding real company editions, provider policies and duplicated build/deployment scripts in
Robo-Boy would couple product releases to customer-specific changes. It would also make private
assets and operational settings harder to own separately. Keep the generic capability in core;
keep selected company data outside it. Do not introduce injected tenant HTML/CSS/JavaScript just
to customize login copy.

## Upgrade considerations found in the starter

These are maintenance observations, not evidence of an authentication vulnerability:

- The inspected starter records submodule `390733b`; its working checkout is at `9eeb00f` and has
  other uncommitted company work. `dev` already contains the merged enterprise feature. The pin
  therefore needs an explicit update before using the new text fields. This task leaves that work
  intact. Older validators fail on unknown fields rather than silently accepting unsupported settings
- Its README includes a preview paragraph saying restarts sign everyone out. Durable sessions are
  opt-in through a private session file/volume in core; the inspected demo does not configure that
  store. Keep the distinction between demo memory sessions and production persistent sessions clear
- Company packages deliberately disable the stock Robo-Boy updater. Continue distributing a rebuilt
  company package so an upstream installer cannot replace its compiled server URL and branding

Update the pin first, then add the company copy, build the selected edition, and test its actual
provider, TLS and desktop package. There is no need to move the starter into Robo-Boy or modify
its authentication implementation to support rotating messages.

## Verified

The review traces the core validator/types, Vite branding inputs, React login boundary, gateway
branding use, and the starter's company loader, asset staging, Compose override and packaging script.
Tests in this branch cover old/static branding, malformed and excessive slide configuration,
plain-text rendering, paired rotation, pause/manual controls, reduced motion, hidden tabs and
cleanup. The enterprise browser suite exercises branded web login and simulated native handoff
in Chromium and Firefox, including mobile layout and sign-in control stability.

| Check | Result |
| --- | --- |
| `npm run test:run -- --maxWorkers=2` | 1,748 passed, 10 skipped |
| `npm run test:enterprise` | 52 passed |
| `LIBGL_ALWAYS_SOFTWARE=1 npm run e2e:enterprise -- --workers=1` | 12 passed across Chromium and Firefox |
| `npm run lint` and `npm run build` | Passed |
| `npm run build:electron` with login enabled, the example branding file and an HTTPS gateway URL | Renderer and shell built successfully |
| Current Sunrise, Boston Dynamics, ANYbotics and tessel·la JSON files through `loadBranding` | Accepted unchanged; static copy preserved |
| Older starter pin given the new fields | Reproduced rejection of unknown settings |

The initial full unit run timed out in an existing native-sign-in fake-timer test under concurrent
load. Its focused rerun and the complete two-worker suite passed. Browser testing also reproduced
Chromium losing a hover-exit event when the play/pause SVG changed under the pointer. Decorative
icons now leave pointer events on the stable button; the pause/resume browser checks cover that path.
Desktop and 320 px screenshots were inspected. The branch starts at the latest fetched `dev`
baseline above, with no merge conflicts.

## Not verified

The company starter's tracked and untracked files are not changed. Its current branding files are
checked against the new core validator, but its full build/package suite is not rerun: the task
does not change its build scripts or update its submodule. No employee identity provider, production
tenant, signing certificate or physical Mac/iOS/Android installer is certified by these tests.
