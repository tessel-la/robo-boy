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
cp .env.no-overlay.example .env
docker compose up -d --build
```

The stack starts:

- `app`: Vite development server with source mounted for hot reload.
- `ros-stack`: ROS 2, rosapi, rosbridge, and `web_video_server` on the host network.
- `caddy`: HTTP/HTTPS entry point and reverse proxy.

Changes under `src/` should hot reload. Rebuild after changing Dockerfiles, Compose files, ROS dependencies, or the Caddy configuration:

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
