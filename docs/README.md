# Robo-Boy Documentation

The root [README](../README.md) contains only the shortest path to running Robo-Boy. The guides here cover operation and development in more detail.

## Guides

- [Agent guide](agent-guide.md): task-specific reading routes, source-of-truth rules, architecture boundaries,
  extension-path decisions, SDK stability, and verification expectations for coding agents.
- [User guide](user-guide.md): connect to ROS, use cameras and 3D views, build control pads, edit behavior trees, and manage themes.
- [Development guide](development.md): run the frontend locally, test changes, inspect services, work with the Docker stack, and follow the release process.
- [Desktop application](desktop.md): run and package the Tauri frontend against a separately installed ROS stack.
- [iOS application](ios.md): build the Tauri iOS shell on a hosted Mac or your own, sideload the unsigned app, and connect it to a ROS stack on the network.
- [Robot workspace overlays](robot-overlays.md): expose custom ROS 2 messages, services, and actions from simulation workspaces.
- [Custom gamepads](custom-gamepads.md): understand layouts, supported components, persistence, and extension points.
- [Application architecture](architecture.md): system boundaries, runtime data flow, code ownership, persistence, and development rules.
- [Adding a custom panel](custom-panels.md): get a panel you wrote into the web app and into a desktop build,
  the four kinds of panel, enable/disable, and what an update changes.
- [External panels](external-panels.md): panel SDK, installed-registry discovery, lazy loading, capabilities, standalone authoring, and inventory registration.

## Source Map

| Area                             | Location                                      |
| -------------------------------- | --------------------------------------------- |
| Agent instructions and routes    | `docs/agent-guide.md`                         |
| Application shell and shared UI  | `src/App.tsx`, `src/components/`              |
| ROS and visualization hooks      | `src/hooks/`                                  |
| Feature modules                  | `src/features/`                               |
| ROS 3D implementation            | `src/utils/ros3d/`                            |
| Shared utilities and persistence | `src/utils/`                                  |
| Unit tests                       | Co-located `*.test.ts` and `*.test.tsx` files |
| End-to-end tests                 | `e2e/`                                        |
| Build and test configuration     | `config/`                                     |
| Runtime infrastructure           | `docker-compose.yml`, `infra/`                |
| Native shells and runtime URLs   | `src-tauri/`, `src/runtime/`                  |
| Panel catalog, SDK, and loader   | `src/panels/`, `panel-sdk/`, `public/panels/` |
