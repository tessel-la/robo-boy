# Codebase audit and cleanup

Audit date: 2026-10-24. Base: `dev` at `89ef22d07892e72780c61e8d0c9863c202788a43`.
Branch: `codex/codebase-audit-cleanup`.

## Scope and invariants

This audit covers application entry points, components, hooks, utilities, tests, dependencies,
assets, build configuration, native shells, ROS host services, and the external-panel boundary.
Only verified internal dead code is eligible for removal. Keep public SDK types, panel registration,
runtime-selected native adapters, persisted IDs and migrations, deployment endpoints, and robot-control
validation unchanged. A missing static caller alone is insufficient evidence for deletion.

Evidence combines a TypeScript AST import/re-export/dynamic-import graph, repository-wide searches,
TypeScript unused-local diagnostics, build scripts, runtime catalogs, configuration aliases, guides,
and focused tests. Entry points include `src/main.tsx`, the panel sandbox, the replay worker, native
shells, scripts, and Vite's native/web aliases. The SDK is type-only; external panels cannot import
host internals through its contract.

## Findings and decisions

| Finding                                                                                                                                                                                                                        | Impact                                                                                                                   | Confidence                                                                                          | Action                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Navbar`, the standalone standard/Game Boy/voice pads, and `useThreePanelLayout` have only test callers. `App` retains a commented Navbar import. The shell uses configurable pads and the recursive workspace layout instead. | Duplicate UI and lifecycle code; tests exercise unreachable implementations. The voice prototype sends placeholder data. | High: imports, runtime dispatch, stored panel types, SDK, and guides checked.                       | Remove these components, private styles/types, and their obsolete tests. Keep the live configurable joystick/physical-pad implementations and their dependencies.                                                        |
| `src/utils/ros3d/index.ts` and its Viewer, URDF, PointCloud2, Grid, and Axes implementations form a shadow graph. Imports of `utils/ros3d` resolve to `src/utils/ros3d.ts`.                                                    | Competing 3D implementations and misleading tests.                                                                       | High: TypeScript resolution, import graph, build entry points, hooks, and architecture guide agree. | Remove the shadow graph. Keep `visualizers/LaserScan.ts`, imported by the live entry point. Move primitive coverage onto the live exports; retain live viewer, URDF, point-cloud, TF, disposal, and browser regressions. |
| `vite-plugin-mkcert` is commented out; `@types/uuid` duplicates uuid's own declarations; coverage uses Istanbul; the React Refresh ESLint rule is explicitly disabled.                                                         | Unnecessary direct tooling dependencies and lockfile entries.                                                            | High for direct usage; transitive retention must be checked.                                        | Remove these four direct dependencies and stale configuration comments/disabled registration. Apply the security updates recorded below after completing the initial cleanup.                                            |
| Entry/workspace code contains unused local helpers and abandoned handlers. Several imports are unused.                                                                                                                         | Maintenance noise and unnecessary render-time work.                                                                      | High only for compiler-confirmed local references.                                                  | Remove pure, unused computations/helpers and imports; preserve live initializers, side effects, and lifecycle behavior.                                                                                                  |
| Navigation E2E assertions can pass without checking anything; the old Viewer tests mostly check Three.js itself.                                                                                                               | False confidence in application coverage.                                                                                | High: assertions inspected.                                                                         | Replace vacuous navigation/manifest assertions with application expectations. Keep meaningful live 3D lifecycle checks.                                                                                                  |
| Native HTTP/window/Tauri stubs have no relative import callers.                                                                                                                                                                | A naive dead-file scan would break web/Electron builds.                                                                  | High: Vite and TypeScript aliases select them.                                                      | Retain.                                                                                                                                                                                                                  |
| Workspace migration, old Time Series IDs, ROS discovery fallbacks, and desktop/mobile branches remain runtime inputs.                                                                                                          | Removing them can lose saved state or break older robot stacks and deployment modes.                                     | High.                                                                                               | Retain compatibility and tests.                                                                                                                                                                                          |
| Icons, manifests, launch images, Android/iOS assets, example branding, and README media have indirect/platform or documentation consumers.                                                                                     | Static import scans cannot establish safe deletion.                                                                      | Medium for apparently unreferenced variants.                                                        | Retain assets; do not break published asset URLs or native packaging.                                                                                                                                                    |
| `TfClient` and other exported 3D members look lightly used but remain on the live entry point.                                                                                                                                 | Potential internal/indirect API use.                                                                                     | Insufficient for removal.                                                                           | Retain the live export surface.                                                                                                                                                                                          |

## Baseline

Before source edits: web build (including TypeScript), lint, Electron typecheck, and Tauri frontend
build pass. Unit tests: 214 files, 1,771 passed and 10 skipped. Node tests for installer, notices,
and enterprise: 75 passed. Coverage: 76.51% statements, 67.98% branches, 76.56% functions,
78.80% lines. Formatting fails in 335 existing files; wholesale formatting is outside this cleanup.

Restricted-sandbox runs cannot open test sockets or launch required subprocesses; reruns with the
required access pass. Python host-service tests pass after installing their existing `tornado`/PyYAML prerequisites
under `/tmp` with the bundled Python 3.12. Three native ROS tests require a ROS installation.
The first full browser run uses the default empty panel registry: 246 pass, 26 skip, and four
panel scenarios fail. Those four pass with CI's pinned artifacts. Enterprise tests and a second
Vite profiling server initially exhaust file watchers under the existing 13 GiB Rust target tree;
polling resolves browser validation, and profiling uses saved production builds.

## Implemented cleanup

The proposed removals above are complete. No production dependency is removed: ROS/MCAP,
Three.js, joystick, Lodash, UUID, native networking, and enterprise authentication packages have
verified consumers. Removed direct development dependencies are `vite-plugin-mkcert`,
`@types/uuid`, `@vitest/coverage-v8`, and `eslint-plugin-react-refresh`. The initial cleanup leaves the V8 provider
locked as an optional Vitest peer and removes seven lockfile package entries (1,009 → 1,002),
with no version changes among retained packages. The subsequent security update removes the
remaining unused V8 provider subtree and updates the vulnerable dependencies, as recorded below. An isolated `npm ci --ignore-scripts` succeeds;
its clean source snapshot passes the full unit suite, build, lint, and Electron typecheck.

Nine obsolete test files are removed along with their unreachable implementations. Two new files
and an additional Viewer case cover the live 3D exports: grid geometry/color/orientation, axis
resource ownership, PointCloud2 buffer/offset-view/base64 inputs, point limits, TF conversion,
settings, render requests, subscription/animation cleanup, and missing-container failure.
Navigation E2E now checks the connection disclosure and fetched manifest rather than accepting
missing elements or a nonnegative element count. The live `ros3d.ts` implementation is unchanged.

The final import-graph scan finds only three source modules outside ordinary relative-import
reachability: the web HTTP, Tauri, and window stubs. All three are explicitly selected by build
and TypeScript aliases and are retained. The opt-in unused-local diagnostic count falls from
106 to 73. Remaining findings include unused state readouts, test mocks/parameters, and imports;
there is no blanket compiler-rule enablement or repository-wide formatting change.

## Initial cleanup validation

| Check                                                                                       | Baseline                                                     | Cleanup                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| `npm run test:run` / `npm run test:coverage`                                                | 214 files; 1,771 pass, 10 skip                               | 207 files; 1,735 pass, 10 skip             |
| Statement / branch / function / line coverage                                               | 76.51 / 67.98 / 76.56 / 78.80%                               | 78.12 / 69.17 / 77.36 / 80.62%             |
| Live `ros3d.ts` line coverage                                                               | 53.04%                                                       | 69.73%                                     |
| `npm run lint`                                                                              | Pass                                                         | Pass                                       |
| `npm run build` (includes frontend TypeScript)                                              | Pass                                                         | Pass, also with clean dependencies         |
| `npm run typecheck:electron`                                                                | Pass                                                         | Pass                                       |
| `npm run build:tauri`                                                                       | Pass                                                         | Pass; module/lazy-chunk check passes       |
| `npm run build:electron`                                                                    | Pass                                                         | Pass; renderer and shell                   |
| `node --test scripts/*.test.mjs infra/enterprise/*.test.mjs`                                | 75 pass                                                      | 75 pass                                    |
| Python 3.12 `-m unittest discover -s infra/ros -v`                                          | 103 pass, 3 skip                                             | 103 pass, 3 skip                           |
| Chromium + Firefox E2E                                                                      | 246 pass + 4 panel cases pass after fixture staging; 26 skip | 250 pass, 26 skip in one full run          |
| `npm run e2e:enterprise`                                                                    | 12 pass                                                      | 12 pass                                    |
| `npm run profile:frontend -- --project=chromium` against production builds                  | 12 pass                                                      | 12 pass                                    |
| `npm run build:enterprise`, `npm run test:electron-updater`, `npm run check:release-panels` | Not separately recorded                                      | Pass                                       |
| `npm run format:check`                                                                      | Fails: 335 files                                             | Fails: 314 files; existing formatting debt |

Browser runs use `CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=1000`. Final full E2E:
`ROBOBOY_PUBLIC_DIR=.panel-stage/public npm run e2e -- --workers=4 --reporter=line`.
Panel staging uses `config/panel-sources.e2e.json`, Hello commit
`45323eb6fac60899dbc6e7d609fe7c23e71d8ef5`, and WebRTC commit
`4f3251c3e4f86210eceab679c3e92c097675b2a3`, matching CI. These flows cover ROS mocks,
stream cleanup, 3D, behavior trees, record/replay workers, workspace persistence, and mobile layouts.
The 26 browser skips are the opt-in profiles and two Firefox-only capability exclusions.

## Performance

Measurements use Node 22.22.1, TypeScript 5.9.3, Playwright 1.57.0, local production preview
servers, and the same installed dependencies. Baseline and cleaned output trees are retained
separately to prevent native builds from changing the measured assets. The profile uses the
existing deterministic ROS mock and 5 s sampling windows. CPU percentages describe the renderer
main thread, not whole-machine CPU. They are scheduling-sensitive samples, not a statistical
performance guarantee.

| Asset metric                                      |    Baseline |     Cleanup |          Difference |
| ------------------------------------------------- | ----------: | ----------: | ------------------: |
| All emitted asset JavaScript                      | 2,285,561 B | 2,285,358 B |              −203 B |
| JavaScript, each asset gzip-compressed and summed |   664,708 B |   664,750 B |     +42 B (0.0063%) |
| CSS                                               |   447,853 B |   447,853 B | 0; identical hashes |
| CSS, gzip                                         |    71,451 B |    71,451 B |                   0 |
| Replay worker                                     |   144,473 B |   144,473 B |   0; identical hash |

Most removed code was already outside the production graph. It reduces maintenance burden,
not shipped bundle size. The tiny gzip increase comes from changed minified code/chunk references;
no runtime package or asset is added. The existing approximately 1.86 MB main-workspace chunk
warning remains. Detailed samples, hashes, methods, and advisory URLs are in
[the measurement record](codebase-audit-measurements.json).

| Browser metric                                                   |             Baseline |              Cleanup |
| ---------------------------------------------------------------- | -------------------: | -------------------: |
| Cold-context startup: DOMContentLoaded median, 9 samples         |              19.8 ms |              19.4 ms |
| Cold-context startup: Quick Connect visible median, 9 samples    |              43.8 ms |              45.1 ms |
| Entry idle main-thread CPU, median of 3 repeats                  |                1.37% |                1.09% |
| URDF at 40 Hz TF: main-thread CPU, median of 3 repeats           |               19.49% |               18.87% |
| URDF at 40 Hz TF: collected JS heap, median of 3 repeats         |             7.50 MiB |             7.50 MiB |
| URDF at 40 Hz TF: draws/s, median of 3 repeats                   |                79.17 |                79.16 |
| One empty 3D panel: idle CPU / heap / draws/s                    | 0.04% / 6.17 MiB / 0 | 0.04% / 6.17 MiB / 0 |
| After 5 panel mount/remove cycles: heap / canvases / pending RAF |     6.39 MiB / 0 / 0 |     6.39 MiB / 0 / 0 |
| Camera without decode: idle CPU / heap                           |     0.05% / 5.94 MiB |     0.05% / 5.94 MiB |

An initially higher active-URDF CPU sample overlapped the parallel validation suite. Three paired
repeats after that workload finished, alternating build order, do not reproduce an increase.
All 12 paired tests pass. Startup-ready time moves by 1.3 ms while DOMContentLoaded is unchanged
within sample variation; no material regression is observed in these measurements. They establish
neither real camera-decode throughput nor whole-process/native memory usage.

LaserScan's settled transform loop still schedules approximately 60 callbacks/s, with zero WebGL
draws, in both builds. Replacing that polling loop requires a separate lifecycle/performance change;
it is intentionally retained in this cleanup.

## Security update and final validation

The dependency security update is included before publishing this branch. `npm audit`
now reports **zero vulnerabilities**, down from eight affected packages (two high, five moderate,
one low). A fresh RustSec audit finds nine vulnerable-crate advisories and a fixable Tokio
soundness warning; targeted compatible updates resolve those too. Electron stays on major 44,
Vitest/Istanbul stay on the matching 4.1 line, and Rust dependencies stay in their existing
compatible version ranges:

| Dependency                   | Before          | Patched         |
| ---------------------------- | --------------- | --------------- |
| Electron                     | 44.4.3          | 44.9.3          |
| Vitest and Istanbul provider | 4.1.11          | 4.1.12          |
| Undici                       | 7.29.1 / 6.28.1 | 7.30.1 / 6.29.1 |
| fast-uri                     | 3.1.8           | 3.1.9           |
| serialize-javascript         | 7.0.5           | 7.1.4           |
| quinn-proto                  | 0.11.17         | 0.11.18         |
| rustls                       | 0.23.45         | 0.23.46         |
| rustls-webpki                | 0.103.15        | 0.103.16        |
| webpki-roots                 | 1.0.9           | 1.0.10          |
| Tokio                        | 1.52.3          | 1.53.3          |

Vitest's matching internal packages and compatible Chai/std-env/tinyrainbow dependencies update
with it. npm 11 resolves the documented npm 9 `edgesOut` failure. No new overrides or major-version
upgrades are introduced. The lockfile now contains 997 package entries; a fresh `npm ci` passes,
and Electron's official installer supplies and verifies the actual 44.9.3 binary.

After these updates, the full coverage run with `--maxWorkers=4` passes 1,735 tests with 10 skips;
line coverage remains 80.62% (statements 78.11%, branches 69.17%, functions 77.35%). The initial
unbounded run overlapped builds and hit a 1 s subprocess-startup wait; bounded workers resolve it
without weakening assertions. All 75 Node tests, lint, frontend/Electron typechecks, web/Tauri
frontend/Electron/enterprise builds, updater checks, and 12 enterprise browser tests pass.
The final isolated Chromium/Firefox run passes 250 tests with 26 expected skips. It uses
`FRONTEND_PORT=5178 PLAYWRIGHT_BASE_URL=http://127.0.0.1:5178` and `--workers=2`
with the same CI-pinned panel artifacts. The earlier parallel run had two timing-sensitive
connection/status assertion failures (248 passed); a focused attempt that reused the first
server was invalidated by that server shutting down. The isolated full run resolves those
validation conditions without changing application code, relaxing assertions, or adding retries.

RustSec 0.22.2 runs from `/tmp` using the official release binary and verified SHA-256 digest,
with an isolated advisory database. The final audit reports zero vulnerable-crate advisories;
the glib soundness warning and nine unmaintained-crate warnings remain unsuppressed. `cargo test
--manifest-path src-tauri/Cargo.toml --locked --lib` compiles the native stack and passes 14 tests,
with one live-release download test intentionally ignored. Only five crate versions change.
Cargo also normalizes six existing platform/getrandom dependency edges among already locked
versions; there are no additional crate-version upgrades or Rust source/manifest changes.

The patched native runtime also passes `test:robot-resources`, `test:embed-proxy`, and
`test:electron-tls` under Xvfb: meshes/materials/textures/cache replacement, sandbox isolation,
embed host/port restrictions, local robot HTTPS/WSS, rejection of fake public TLS, and opaque-panel
WebRTC signaling. The TLS fixture now waits for its `app://robo-boy/index.html` navigation before
renderer assertions; it previously raced that navigation. The earlier Electron attachment timeout
is a baseline limitation, not an outstanding final failure.

The security update emits byte-identical web JavaScript and CSS to the measured cleanup build.
The preceding bundle/performance tables therefore still describe the final web assets. Native
Electron/Tauri performance and platform installers are not benchmarked here.

## ROS discovery deprecation follow-up

Compose previously defaulted `ROS_LOCALHOST_ONLY` to `0` alongside the modern discovery variables.
The [Jazzy initialization code](https://github.com/ros2/rcl/blob/jazzy/rcl/src/rcl/init.c)
confirms that `0` emits warnings but still uses `ROS_AUTOMATIC_DISCOVERY_RANGE` and
`ROS_STATIC_PEERS`. An explicit `1` forces localhost discovery and ignores both modern settings.
The running Jazzy/Cyclone DDS stack uses `0`, `SUBNET`, and no static peers, so its current setting
does not change discovery behavior.

Compose now leaves the legacy variable empty by default and still forwards explicit values.
This avoids Jazzy warnings while preserving localhost-only deployments. The upstream Jazzy parser
treats empty as its default; Humble's parser treats empty as disabled, preserving its prior default.
The overlay guide documents both distributions and the precedence/static-peer migration caveat.
No entrypoint translation, middleware settings, ROS services, or live containers change.

Validation passes seven rendered Compose cases: defaults, explicit legacy `0`/`1`, modern localhost,
modern static peers, and Humble default/localhost build pairs. Fourteen isolated Jazzy node
initialization/create/destroy/shutdown cases pass across Fast DDS and Cyclone DDS. Debug output
confirms the discovery range, static-peer count, warning removal, legacy `1` precedence over `OFF`
and peers, and preservation of explicit modern `LOCALHOST`, `SUBNET`, and `OFF` settings. Containers
use `--network none --read-only --tmpfs /tmp`; no live stack is restarted. Humble runtime and actual
cross-host discovery are not exercised. These focused checks cover the configuration-only follow-up;
the earlier full frontend/native validation is unchanged.

## Retained risks and follow-up coverage

- RustSec still reports `RUSTSEC-2024-0429` for glib 0.18.5 and nine unmaintained crates
  (`proc-macro-error`, five `unic-*` crates, `zbus_names`, `zvariant`, and `zvariant_derive`).
  GTK3/WebKitGTK uses glib 0.18; the fix requires glib 0.20 or newer. Adding a second glib version
  would not fix the affected dependency. A compatible upstream desktop-stack migration is needed;
  this cleanup does not force one or suppress its warnings.
- Ten existing unit skips remain: eight application-shell scenarios and two PointCloud mobile/color
  scenarios. Browser lifecycle coverage is retained, but it does not establish every skipped case.
  Real robot control, reconnects under hardware/network failure, actual camera decode, physical
  controllers, GPU drivers, iOS/Android devices, and native installers still need platform checks.
- Future PointCloud fixtures should cover big-endian payloads, organized row padding, and nonstandard
  field offsets. The live parser reads little-endian and can fall back to default XYZ offsets;
  this audit adds common-encoding coverage without changing those existing semantics.

Repository-wide discovery and targeted manual checks support these removals; this is not an
exhaustive correctness proof for every feature. Uncertain exports, compatibility paths, and assets
are retained. No feature is removed because its tests are absent or skipped.
