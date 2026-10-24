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

## Initial findings and proposed actions

| Finding | Impact | Confidence | Proposed action |
| --- | --- | --- | --- |
| `Navbar`, the standalone standard/Game Boy/voice pads, and `useThreePanelLayout` have only test callers. `App` retains a commented Navbar import. The shell uses configurable pads and the recursive workspace layout instead. | Duplicate UI and lifecycle code; tests exercise unreachable implementations. The voice prototype sends placeholder data. | High: imports, runtime dispatch, stored panel types, SDK, and guides checked. | Remove these components, private styles/types, and their obsolete tests. Keep the live configurable joystick/physical-pad implementations and their dependencies. |
| `src/utils/ros3d/index.ts` and its Viewer, URDF, PointCloud2, Grid, and Axes implementations form a shadow graph. Imports of `utils/ros3d` resolve to `src/utils/ros3d.ts`. | Competing 3D implementations and misleading tests. | High: TypeScript resolution, import graph, build entry points, hooks, and architecture guide agree. | Remove the shadow graph. Keep `visualizers/LaserScan.ts`, imported by the live entry point. Move primitive coverage onto the live exports; retain live viewer, URDF, point-cloud, TF, disposal, and browser regressions. |
| `vite-plugin-mkcert` is commented out; `@types/uuid` duplicates uuid's own declarations; coverage uses Istanbul; the React Refresh ESLint rule is explicitly disabled. | Unnecessary direct tooling dependencies and lockfile entries. | High for direct usage; transitive retention must be checked. | Remove these four direct dependencies and stale configuration comments/disabled registration. Do not upgrade other packages. |
| Entry/workspace code contains unused local helpers and abandoned handlers. Several imports are unused. | Maintenance noise and unnecessary render-time work. | High only for compiler-confirmed local references. | Remove pure, unused computations/helpers and imports; preserve initializers, side effects, state order, and lifecycle behavior. |
| Navigation E2E assertions can pass without checking anything; the old Viewer tests mostly check Three.js itself. | False confidence in application coverage. | High: assertions inspected. | Replace vacuous navigation/manifest assertions with application expectations. Keep meaningful live 3D lifecycle checks. |
| Native HTTP/window/Tauri stubs have no relative import callers. | A naive dead-file scan would break web/Electron builds. | High: Vite and TypeScript aliases select them. | Retain. |
| Workspace migration, old Time Series IDs, ROS discovery fallbacks, and desktop/mobile branches remain runtime inputs. | Removing them can lose saved state or break older robot stacks and deployment modes. | High. | Retain compatibility and tests. |
| Icons, manifests, launch images, Android/iOS assets, example branding, and README media have indirect/platform or documentation consumers. | Static import scans cannot establish safe deletion. | Medium for apparently unreferenced variants. | Retain assets; do not break published asset URLs or native packaging. |
| `TfClient` and other exported 3D members look lightly used but remain on the live entry point. | Potential internal/indirect API use. | Insufficient for removal. | Retain the live export surface. |

## Baseline

Before source edits: web build (including TypeScript), lint, Electron typecheck, and Tauri frontend
build pass. Unit tests: 214 files, 1,771 passed and 10 skipped. Node tests for installer, notices,
and enterprise: 75 passed. Coverage: 76.51% statements, 67.98% branches, 76.56% functions,
78.80% lines. Formatting fails in 335 existing files; wholesale formatting is outside this cleanup.

Restricted-sandbox runs cannot open test sockets or launch required subprocesses; reruns with the
required access pass. Python host-service tests initially lack `tornado`; three native ROS tests
require a ROS installation. Browser, profiling, packaging, and final results are recorded below
when validation completes.

## Validation and limitations

Pending implementation and final validation. No claim of exhaustive dead-code detection or zero
regressions can be established from static analysis and automated tests alone. Hardware ROS,
real camera/network streaming, native installers, and physical mobile devices need their own
runtime validation.
