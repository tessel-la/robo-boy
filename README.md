# 🤖 Robo-Boy

[![Docker CI](https://github.com/tessel-la/robo-boy/actions/workflows/docker-ci.yml/badge.svg)](https://github.com/tessel-la/robo-boy/actions/workflows/docker-ci.yml)

<p align="center">
  <img src="images/logo.png" alt="Robo-Boy Logo" width="200">
</p>

A vibe web application for controlling ROS 2 robots, featuring a React frontend, ROS 2 integration via rosbridge, and secure local development setup with Caddy and HTTPS. Inspired by retro handheld consoles.

## ✨ Features

*   📱 Responsive design for desktop and mobile
*   🔗 ROS 2 connection (via rosbridge)
*   📷 Camera stream display (via web_video_server)
*   🦊 Foxglove WebSocket server for advanced data visualization and debugging
*   🕹️ Interchangeable control interfaces:
    * Standard gamepad with dual joysticks (`sensor_msgs/Joy`)
    * Retro GameBoy-style control layout
    * Voice control input with recording animation
    * 🚁 Drone control pad for aerial vehicles
    * 🦾 Manipulator control for robotic arms
*   🧊 3D visualization support (using ros3djs)
    * 🌈 Customizable point cloud rendering with options for:
      * Point size adjustment
      * Color selection (fixed or gradient based on x/y/z axis)
      * Maximum points setting
*   🌗 Animated Light/Dark mode toggle
*   🎨 Customizable themes with user-created color palettes
*   🛡️ Local HTTPS development setup via Caddy and mkcert

## 🎥 App Demo

[app_functions.webm](images/app_functions.webm)

## 🎮 Control Interfaces

The application provides multiple control interfaces that can be swapped during runtime:

### Standard Gamepad
A dual-joystick layout for precise control, publishing to the `/joy` topic with ROS standard `sensor_msgs/Joy` messages.

### GameBoy Layout
A nostalgic GameBoy-inspired control interface with D-pad and A/B buttons.

### Voice Control
Record voice commands that can be sent to your robot for voice-activated control.

### Drone Control Pad
Specialized control interface for aerial vehicles. For testing, use in conjunction with [aerial-sim](https://github.com/tessel-la/aerial-sim) repository.

### Manipulator Control
Interface for controlling robotic arms with precise joint movements. For testing, use in conjunction with [manipulator-sim](https://github.com/tessel-la/manipulator-sim) repository.

You can open multiple control panels and switch between them with tabs.

## Theme Customization

[theme_custom.webm](images/theme_custom.webm)

The application supports multiple themes, including user-created custom themes. Themes define the color palette for the UI elements.

1.  **Access Theme Menu:** Click the theme icon button (usually in the bottom-right corner). This opens a popup menu displaying available themes (default and custom).
2.  **Create New Theme:** Click the "Create New Theme..." button in the popup. This opens the Theme Creator modal.
3.  **Define Theme:**
    *   Enter a unique **Name** for your theme.
    *   Select the base **Colors** (Primary, Secondary, Background) using the color pickers. Optional colors (Text, Border, etc.) can also be set.
    *   Choose an **Icon** to represent your theme in the selector menu.
    *   Click **Save Theme**.
4.  **Editing/Deleting:** Custom themes will have Edit (pencil) and Delete (trash) icons next to them in the theme selector popup. Clicking Edit opens the Theme Creator pre-filled with that theme's settings. Clicking Delete prompts for confirmation before removing the theme.

### How it Works

*   Default themes (`light`, `dark`, `solarized`) have their CSS variables defined directly in `src/index.css` using `[data-theme="themename"]` selectors.
*   Custom themes are stored in the browser's `localStorage`.
*   When a custom theme is selected, JavaScript dynamically generates a `<style>` tag containing CSS variable overrides based on the saved colors and injects it into the document head. The `<body>` element also gets a `data-theme="custom-theme-id"` attribute.
*   UI components should primarily use the defined CSS variables (e.g., `var(--primary-color)`, `var(--background-color)`) for styling to ensure they adapt correctly to the selected theme. 

## 🧩 Codebase Organization

The codebase follows a component-based architecture:

- `/src/components` - Main UI components
- `/src/components/gamepads` - All gamepad control interfaces
  - `/standard` - Standard dual joystick layout
  - `/gameboy` - GameBoy-style control layout  
  - `/voice` - Voice control interface
  - `/drone` - Drone control interface
  - `/manipulator` - Robotic arm control interface
- `/src/hooks` - Custom React hooks including ROS connection
- `/src/utils` - Utility functions and helpers
- `/src/features` - Feature-specific code (e.g., theme system)
- `/src/types` - TypeScript type definitions

### Adding Custom Gamepad Layouts

See the dedicated README in the `/src/components/gamepads` directory for instructions on creating custom control interfaces.

## 🚀 Getting Started

### Prerequisites

*   [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed.
*   [Node.js](https://nodejs.org/) (v18 LTS or later recommended) and npm. (*Note: Node/npm are technically only needed if modifying dependencies locally before a Docker build, but good to have.*)
*   [mkcert](https://github.com/FiloSottile/mkcert#installation) for local HTTPS setup.

### Local Development Setup

1.  **Clone the Repository:**
    ```bash
    git clone <your-repository-url>
    cd robo-boy # Or your actual directory name
    ```

2.  **Setup Local HTTPS with mkcert:**
    *   **Install mkcert's CA:** Run this once per machine to make browsers trust local certificates.
        ```bash
        mkcert -install 
        ```
        *(You might need `sudo` or administrator privileges)*
    *   **Create Certificates Directory:**
        ```bash
        mkdir certs
        ```
    *   **Generate Certificate:** Replace `YOUR_HOST_IP` with your computer's actual local network IP address (e.g., `192.168.1.67`). This certificate will be valid for `localhost` and your IP.
        ```bash
        mkcert -key-file certs/local-key.pem -cert-file certs/local-cert.pem localhost 127.0.0.1 ::1 YOUR_HOST_IP
        ```

3.  **Build and Run Services:** This command builds the Docker images (if they don't exist or need updating) and starts the `app` (React Vite dev server), `ros-stack` (rosbridge, web_video_server), and `caddy` (reverse proxy) containers.
    ```bash
    docker compose up -d --build
    ```

4.  **Access the Application:**
    *   On your development machine: `https://localhost`
    *   From another device on the same network (e.g., mobile): `https://YOUR_HOST_IP` (using the same IP you used for `mkcert`)

### Stopping the Services

```bash
# Stop and remove containers
docker compose down

# Stop, remove containers, AND remove Caddy's data volumes (useful for a clean restart)
docker compose down -v 
```

## 🐳 Services Overview

*   **`app`**: Runs the Vite development server for the React frontend with hot-reloading.
    *   Accessible *internally* at `http://app:5173`.
*   **`ros-stack`**: Runs ROS 2 components.
    *   `rosbridge_server`: Provides WebSocket connection at `ws://ros-stack:9090`.
    *   `web_video_server`: Streams video topics over HTTP at `http://ros-stack:8080`.
    *   `foxglove_bridge`: Provides WebSocket connection for Foxglove Studio at `ws://ros-stack:8765`.
*   **`caddy`**: Acts as a reverse proxy.
    *   Listens on host ports `80` and `443`.
    *   Provides HTTPS using the generated `mkcert` certificates.
    *   Routes `/websocket` requests to `ros-stack:9090`.
    *   Routes `/foxglove` requests to `ros-stack:8765`.
    *   Routes all other requests to the Vite dev server (`app:5173`).

## 🦊 Foxglove Studio Integration

The application includes a Foxglove WebSocket server that allows you to connect and visualize your ROS data using [Foxglove Studio](https://foxglove.dev/studio). This provides advanced data visualization, plotting, and debugging capabilities.

### Connecting to Foxglove Studio

1. Launch Foxglove Studio (web or desktop version)
2. Click "Open Connection" and select "WebSocket"
3. Enter one of the following URLs:
   - Local machine: `ws://localhost:8765` (direct connection to the port)
   - Local machine via Caddy proxy: `wss://localhost/foxglove`
   - From another device on the same network: `wss://YOUR_HOST_IP/foxglove`
4. Click "Open"

You should now be connected to the ROS environment and can use all of Foxglove Studio's features to visualize and analyze your robot's data.

## 🛠️ Development Notes

*   Changes to frontend code (in `/src`) should trigger hot-reloading in the browser.
*   If you modify `Dockerfile`, `docker-compose.yml`, or `Caddyfile`, you'll need to rebuild and restart the services (`docker compose up -d --build --force-recreate`).
*   Caddy logs can be viewed with `docker compose logs caddy`.
*   ROS stack logs can be viewed with `docker compose logs ros-stack`.

## 🚀 CI/CD Workflow

The project uses GitHub Actions for continuous integration:

### Docker CI Workflow

The Docker CI workflow runs automatically on every push to the `main` branch and on every pull request. It tests the container build process:

1. **Docker Setup**: Sets up Docker Buildx for multi-platform builds
2. **App Container**: Builds the React application container from `Dockerfile.dev`
3. **ROS Stack Container**: Builds the ROS 2 stack container from `Dockerfile.ros`
4. **Docker Compose**: Tests the full stack build with docker-compose

This approach ensures that all Docker containers and the full stack can be built successfully.

### Testing Locally

#### Testing Docker Builds Locally

You can test the Docker builds locally using the provided scripts:

**Linux/macOS:**
```bash
# Make the script executable
chmod +x scripts/test-docker-build.sh

# Run the Docker build tests
./scripts/test-docker-build.sh
```

> **Note for WSL users**: If you encounter errors like `bash\r: No such file or directory`, you need to convert the file to Unix line endings. Install dos2unix (`sudo apt install dos2unix`) and run `dos2unix scripts/test-docker-build.sh` to fix the line endings.

**Windows:**
```cmd
scripts\test-docker-build.bat
```

These scripts will build all Docker containers and test the full docker-compose setup, ensuring everything builds correctly.


## 🚢 Production Deployment

### Manual Deployment

To deploy the application:

```bash
# Install dependencies
npm ci

# Build for production
npm run build

# The 'dist' directory now contains the deployable files
```

The built files in the `dist` directory can be deployed to any static hosting service like GitHub Pages, Netlify, Vercel, or a traditional web server.

