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
| `vite-plugin-mkcert` is commented out; `@types/uuid` duplicates uuid's own declarations; coverage uses Istanbul; the React Refresh ESLint rule is explicitly disabled.                                                         | Unnecessary direct tooling dependencies and lockfile entries.                                                            | High for direct usage; transitive retention must be checked.                                        | Remove these four direct dependencies and stale configuration comments/disabled registration. Do not upgrade other packages.                                                                                             |
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
`@types/uuid`, `@vitest/coverage-v8`, and `eslint-plugin-react-refresh`. The V8 provider remains
locked as an optional Vitest peer. Seven lockfile package entries disappear (1,009 → 1,002),
with no version changes among retained packages. An isolated `npm ci --ignore-scripts` succeeds;
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

## Validation

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

## Retained risks and follow-up coverage

- `npm audit` reports the same eight affected packages in both lockfiles: two high, five moderate,
  and one low. High entries are Electron 44.4.3 and transitive Undici. Electron is a shipped runtime,
  despite its development-dependency classification. Vitest/mocker, fast-uri, and serialize-javascript
  account for the other entries. Track a separate tested security update; this cleanup does not fix
  or suppress advisories. See the companion measurements for advisory URLs and dependency paths.
- `cargo audit --file src-tauri/Cargo.lock` cannot run because `cargo-audit` is not installed.
  The Rust lockfile is unchanged. The earlier security guide's zero-vulnerability statement is
  historical and does not describe this audit's current npm result.
- Native Electron integration (`test:robot-resources`, `test:embed-proxy`, `test:electron-tls`)
  times out during Playwright's Electron debugger attachment. A temporary Xvfb display does not
  resolve the baseline robot-resource timeout. Renderer/shell builds and mocked native tests pass;
  actual desktop integration remains unverified. No native runtime code changes in this branch.
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
