# Robot Workspace Overlays

The `ros-stack` service uses host networking so ROS 2 DDS discovery works with host-networked robot and simulation containers. Custom message, service, and action definitions must also be available inside `ros-stack`; Compose overrides mount their built install workspaces under `/overlay_ws`.

Select an overlay by copying one example to `.env`. Docker Compose reads `COMPOSE_FILE` from that file on subsequent commands.

```bash
# No robot-specific workspace
cp config/env/no-overlay.env.example .env

# Aerostack workspace
cp config/env/aerostack.env.example .env

# Manipulator simulation workspace
cp config/env/manipulator.env.example .env
```

After changing overlays, recreate the ROS service:

```bash
docker compose up -d --build --force-recreate ros-stack
```

## Aerostack

The Aerostack override mounts `~/.aerostack2_install` at `/overlay_ws/aerostack2` by default.

```bash
docker cp aerial_sim_cont:/root/aerostack2_ws/install ~/.aerostack2_install
cp config/env/aerostack.env.example .env
docker compose up -d --build
```

Set `AEROSTACK2_INSTALL_DIR` in `.env` if the install workspace lives elsewhere.

## Manipulator Simulation

Start or build the manipulator simulation first, then start Robo-Boy:

```bash
cd /path/to/manipulator-sim
docker compose up -d --build

cd /path/to/robo-boy
cp config/env/manipulator.env.example .env
docker compose up -d --build
```

The override expects the simulation at `../manipulator-sim` and external Docker volumes named:

- `manipulator-sim_colcon_install_jazzy`
- `manipulator-sim_colcon_build_jazzy`

Override those defaults in `.env` when necessary:

```dotenv
MANIPULATOR_SIM_DIR=/path/to/manipulator-sim
MANIPULATOR_SIM_INSTALL_VOLUME=custom_install_volume
MANIPULATOR_SIM_BUILD_VOLUME=custom_build_volume
```

The build and source mounts are required because this workspace uses `colcon --symlink-install`.

## Custom Workspace

Create a Compose override and mount a built install directory under a unique `/overlay_ws/<name>` path:

```yaml
services:
  ros-stack:
    volumes:
      - /path/to/custom_ws/install:/overlay_ws/custom:ro
```

For a workspace stored in a Docker volume:

```yaml
services:
  ros-stack:
    volumes:
      - custom_ws_install:/overlay_ws/custom:ro

volumes:
  custom_ws_install:
    external: true
```

Start with both Compose files:

```bash
COMPOSE_FILE=docker-compose.yml:infra/compose/custom.yml docker compose up -d --build
```

If generated hooks require the original build path, mount the referenced build/source directories too or set `ROBOT_WORKSPACE_SETUP` to an accessible `setup.bash` path.

## Compatibility And Diagnosis

The simulation and `ros-stack` must use compatible `ROS_DISTRO` and `ROS_DOMAIN_ID` values. The workspace must be built before it is mounted.

Confirm activation and inspect errors with:

```bash
docker compose logs ros-stack
```

The entrypoint prints an activation line for every discovered workspace under `/overlay_ws`.
