# Development Guide

## Prerequisites

- Node.js 20 or newer
- npm
- Docker with Docker Compose for the complete ROS and proxy stack
- mkcert for trusted local HTTPS

## Frontend Only

Install dependencies and start Vite:

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`. The frontend can load without Docker, but ROS, video, and mesh proxy routes require compatible services or test mocks.

## Complete Development Stack

Generate the certificate as described in the root README, select a Compose configuration, and start the stack:

```bash
cp config/env/no-overlay.env.example .env
docker compose up -d --build
```

The stack starts:

- `app`: Vite development server with source mounted for hot reload.
- `ros-stack`: ROS 2, rosapi, rosbridge, and `web_video_server` on the host network.
- `caddy`: HTTP/HTTPS entry point and reverse proxy.

Changes under `src/` should hot reload. Rebuild after changing files under `infra/`, Compose files, or ROS dependencies:

```bash
docker compose up -d --build --force-recreate
```

## Useful Commands

```bash
npm run build
npm run lint
npm run format:check
npm run test:run
npm run test:coverage
npm run e2e
```

`npm run e2e` starts its own Vite server. To test an already-running Docker/Caddy stack, use:

```bash
npm run e2e:stack
```

## Logs And Shutdown

```bash
docker compose logs -f app
docker compose logs -f caddy
docker compose logs -f ros-stack
docker compose down
```

Use `docker compose down -v` only when the Caddy data and configuration volumes should also be removed.

## Testing Strategy

- Vitest and Testing Library cover components, hooks, storage, message conversion, behavior-tree logic, and ROS/3D adapters with mocks.
- Playwright covers browser navigation and complete user flows.
- Tests live beside source files unless they exercise the complete application, in which case they belong in `e2e/`.
- Add focused tests with behavior changes. Use end-to-end coverage when a change crosses the application shell, browser APIs, proxy paths, or several feature modules.

## Before Opening A Change

Run the checks relevant to the modified area. For broad changes, use:

```bash
npm run lint
npm run test:run
npm run build
npm run e2e
```

## Releases

Feature pull requests target `dev`. The only development promotion into `main` should be a pull request from `dev`; feature branches should not target `main` directly.

Official releases are created from `main` only. After `dev` is promoted into `main`, the Release Please workflow scans the commits on `main` and creates or updates a release pull request.

Do not create official releases directly from `dev`.

Release Please uses Conventional Commits to choose the next SemVer version:

| Commit message | Release type |
| -------------- | ------------ |
| `fix: correct login redirect` | Patch |
| `feat: add export endpoint` | Minor |
| `feat!: change public API response format` | Major |

Breaking changes can also be marked with a `BREAKING CHANGE:` footer in the commit body. Commits such as `docs:`, `test:`, `chore:`, and `refactor:` can appear in history, but they do not create a release by themselves unless they include a breaking-change marker.

When the Release Please pull request is merged into `main`, the workflow creates the Git tag and GitHub Release, and updates the package version and `CHANGELOG.md` as part of the release pull request.

Every push to `main`, including a development promotion or merged Release Please pull request, runs the `Sync main to dev` workflow. It merges `main` back into `dev` so release versions and changelog updates remain in both branches. If that workflow reports a merge conflict, reconcile `main` into a branch based on the latest `dev` and merge that fix before the next promotion.
