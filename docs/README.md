# Robo-Boy Documentation

The root [README](../README.md) contains only the shortest path to running Robo-Boy. The guides here cover operation and development in more detail.

## Guides

- [User guide](user-guide.md): connect to ROS, use cameras and 3D views, build control pads, edit behavior trees, and manage themes.
- [Development guide](development.md): run the frontend locally, test changes, inspect services, and work with the Docker stack.
- [Robot workspace overlays](robot-overlays.md): expose custom ROS 2 messages, services, and actions from simulation workspaces.
- [Custom gamepads](custom-gamepads.md): understand layouts, supported components, persistence, and extension points.
- [Application architecture](architecture.md): system boundaries, runtime data flow, code ownership, persistence, and development rules.

## Source Map

| Area                             | Location                                          |
| -------------------------------- | ------------------------------------------------- |
| Application shell and shared UI  | `src/App.tsx`, `src/components/`                  |
| ROS and visualization hooks      | `src/hooks/`                                      |
| Feature modules                  | `src/features/`                                   |
| ROS 3D implementation            | `src/utils/ros3d/`                                |
| Shared utilities and persistence | `src/utils/`                                      |
| Unit tests                       | Co-located `*.test.ts` and `*.test.tsx` files     |
| End-to-end tests                 | `e2e/`                                            |
| Runtime infrastructure           | `docker-compose*.yml`, `Dockerfile*`, `Caddyfile` |
