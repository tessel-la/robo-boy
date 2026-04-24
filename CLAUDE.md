# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Robo-Boy is a React + TypeScript web application for controlling ROS 2 robots. It connects to ROS via rosbridge (WebSocket), displays camera feeds via `web_video_server`, and provides 3D visualization using Three.js. The stack runs in Docker: a Vite dev server, a Caddy reverse proxy (HTTPS), and a ROS 2 container.

## Commands

```bash
# Development (runs inside Docker; see setup below)
docker compose up -d --build

# Frontend-only dev (no Docker)
npm run dev

# Build
npm run build

# Lint (zero warnings allowed)
npm run lint

# Format
npm run format
npm run format:check

# Unit tests (watch mode)
npm run test

# Unit tests (single run, for CI)
npm run test:run

# Unit tests with coverage (must meet 20% thresholds for statements/branches/functions/lines)
npm run test:coverage

# Run a single test file
npx vitest run src/hooks/useRos.test.ts

# E2E tests
npm run e2e
npm run e2e:ui        # interactive UI mode
npm run e2e:report    # show last report
```

## Local HTTPS Setup (required for Gamepad API / WebSockets)

```bash
mkcert -install
mkdir certs
mkcert -key-file certs/local-key.pem -cert-file certs/local-cert.pem localhost 127.0.0.1 ::1 YOUR_HOST_IP
docker compose up -d --build
```

After `docker compose up`, the app is at `https://localhost`. After modifying `Dockerfile`, `docker-compose.yml`, or `Caddyfile`, run `docker compose up -d --build --force-recreate`.

## Architecture

### Application Flow

```
EntrySection (connection form)
  → App (theme management, auth state)
    → MainControlView (after ROS connect)
        ├── Top panel: CameraView | VisualizationPanel | BehaviorTreePanel
        └── Bottom panel: Gamepad tabs (resizable split via useResizablePanels)
```

`useRos` hook manages the WebSocket connection to rosbridge. It connects to `wss://<hostname>/websocket` (Caddy proxies this to the `ros-stack` container). The `ros` object (ROSLIB.Ros) flows down to all child components that publish/subscribe.

### Key Abstractions

**ROS Connection** (`src/hooks/useRos.ts`): Singleton connection hook. The `ros` instance is passed as a prop to all components that need ROS. It is also exposed as `window.ros` for browser console debugging.

**View Modes** (`src/components/MainControlView.tsx`): Three top-panel views — `camera`, `3d`, `behaviorTree` — toggled with slide animations (animejs). The bottom panel holds swappable gamepad tabs.

**Visualization** (`src/components/VisualizationPanel.tsx`, `src/hooks/useRos3dViewer.ts`, `src/utils/ros3d/`): 3D visualization uses Three.js with custom wrappers in `src/utils/ros3d/`. Visualizers (point cloud, laser scan, pose, URDF, TF) are React components in `src/components/visualizers/` backed by hooks in `src/hooks/`.

**Gamepad System**: Two subsystems:
- *Hardcoded layouts* in `src/components/gamepads/` (Drone, Manipulator, Standard, GameBoy, Voice)
- *Custom Gamepad Creator* (`src/features/customGamepad/`) — drag-and-drop editor, JSON-serialized layouts stored in `localStorage`, rendered via `CustomGamepadWrapper`

**Behavior Tree** (`src/features/behaviorTree/`): Visual editor built on React Flow (reactflow). Nodes represent ROS actions, services, topics, and control-flow constructs (Sequence, Selector, Parallel). Execution is hybrid: the browser orchestrates control flow via `BehaviorTreeExecutor`, while individual actions run on the ROS side.

**Theme System** (`src/features/theme/`): Default themes (`light`, `dark`, `solarized`) use CSS variables in `src/index.css` via `[data-theme]` selectors. Custom themes are stored in `localStorage` and injected as dynamic `<style>` tags. All components should use CSS variables (e.g., `var(--primary-color)`) rather than hardcoded colors.

### Testing Conventions

- Unit tests are co-located with source files: `foo.ts` → `foo.test.ts`
- Test setup is in `src/test/setup.ts`
- External dependencies (ROSLIB, Three.js) are mocked with `vi.mock()`
- E2E tests live in `/e2e/` (Playwright)
- Coverage thresholds are enforced at 20% across all metrics

### Docker Services

| Service | Purpose |
|---|---|
| `app` | Vite dev server (React frontend) |
| `caddy` | HTTPS reverse proxy; `/websocket` → rosbridge |
| `ros-stack` | ROS 2 + rosbridge + web_video_server |
