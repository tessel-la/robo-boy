# 🤖 Robo-Boy

[![Docker CI](https://github.com/tessel-la/robo-boy/actions/workflows/docker-ci.yml/badge.svg)](https://github.com/tessel-la/robo-boy/actions/workflows/docker-ci.yml)

<p align="center">
  <img src="images/logo.PNG" alt="Robo-Boy Logo" width="200">
</p>

A web application for controlling ROS 2 robots, featuring a React frontend, ROS 2 integration via rosbridge, and secure local development setup with Caddy and HTTPS. Inspired by retro handheld consoles.

## ✨ Features

*   📱 Responsive design for desktop and mobile
*   🔗 ROS 2 connection (via rosbridge)
*   📷 Camera stream display (via web_video_server)
*   🕹️ Interchangeable control interfaces:
    * 🚁 Drone control pad for aerial vehicles
    * 🦾 Manipulator control for robotic arms
    * And many more than you can create! 
*   🧊 3D visualization support 
*   🎨 Customizable themes with user-created color palettes

## 🎥 App Demo
<div align="center">
  <video src="https://github.com/user-attachments/assets/68b4192f-49fa-411a-8889-c40ec561d526" width="30%" controls></video>
</div>

## 🚀 Getting Started

<details>
<summary><strong>📋 Prerequisites</strong></summary>

*   [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed.
*   [mkcert](https://github.com/FiloSottile/mkcert#installation) for local HTTPS setup.
</details>

<details>
<summary><strong>⚙️ Local Development Setup</strong></summary>

1.  **Clone the Repository:**
    ```bash
    git clone git@github.com:tessel-la/robo-boy.git
    cd robo-boy 
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
</details>

<details>
<summary><strong>🛑 Stopping the Services</strong></summary>

```bash
# Stop and remove containers
docker compose down

# Stop, remove containers, AND remove Caddy's data volumes (useful for a clean restart)
docker compose down -v 
```
</details>

## 🎮 Control Interfaces & Gamepad Creation

The application provides multiple control interfaces that can be swapped during runtime:

<details>
<summary><strong>🕹️ Pre-built Control Pads</strong></summary>

#### Drone Control Pad
Specialized control interface for aerial vehicles. For testing, use in conjunction with [aerial-sim](https://github.com/tessel-la/aerial-sim) repository.

#### Manipulator Control
Interface for controlling robotic arms with precise joint movements. For testing, use in conjunction with [manipulator-sim](https://github.com/tessel-la/manipulator-sim) repository.

#### Standard, GameBoy & Voice Layouts
Additional pre-built interfaces including standard dual-joystick, retro GameBoy-style controls, and voice command interface.
</details>

<details>
<summary><strong>🛠️ Custom Gamepad Creator</strong></summary>

**Create your own control interfaces directly in the app!** The Custom Gamepad Creator allows you to design personalized control layouts using a drag-and-drop interface.

**Features:**
- **Component Library**: Choose from joysticks, buttons, D-pads, toggles, and sliders
- **Grid-based Design**: Drag and drop components on a customizable grid
- **Real-time Preview**: Test your gamepad while designing
- **ROS Integration**: Configure each component to publish to specific ROS topics
- **Save & Share**: Store layouts locally and export/import via JSON files

**Getting Started:**
1. Click the "+" button in the control panel tabs
2. Select "Create Custom Gamepad" 
3. Drag components from the palette to design your layout
4. Configure each component's ROS topic and behavior
5. Save your custom gamepad for future use

Perfect for creating specialized control interfaces tailored to your specific robot's needs!
</details>

<details>
<summary><strong>📑 Tab Management</strong></summary>

You can open multiple control panels and switch between them with tabs. Mix and match pre-built pads with your custom creations for maximum flexibility.
</details>

## 🎨 Theme Customization

<details>
<summary><strong>🎭 Custom Theme Creator</strong></summary>

<div align="center">
  <video src="https://github.com/user-attachments/assets/3f28cc2b-b9e9-46fa-b36c-69324dec5664" width="30%" controls></video>
</div>

The application supports multiple themes, including user-created custom themes. Themes define the color palette for the UI elements.

1.  **Access Theme Menu:** Click the theme icon button (usually in the bottom-right corner). This opens a popup menu displaying available themes (default and custom).
2.  **Create New Theme:** Click the "Create New Theme..." button in the popup. This opens the Theme Creator modal.
3.  **Define Theme:**
    *   Enter a unique **Name** for your theme.
    *   Select the base **Colors** (Primary, Secondary, Background) using the color pickers. Optional colors (Text, Border, etc.) can also be set.
    *   Choose an **Icon** to represent your theme in the selector menu.
    *   Click **Save Theme**.
4.  **Editing/Deleting:** Custom themes will have Edit (pencil) and Delete (trash) icons next to them in the theme selector popup. Clicking Edit opens the Theme Creator pre-filled with that theme's settings. Clicking Delete prompts for confirmation before removing the theme.
</details>

<details>
<summary><strong>⚙️ How Theme System Works</strong></summary>

*   Default themes (`light`, `dark`, `solarized`) have their CSS variables defined directly in `src/index.css` using `[data-theme="themename"]` selectors.
*   Custom themes are stored in the browser's `localStorage`.
*   When a custom theme is selected, JavaScript dynamically generates a `<style>` tag containing CSS variable overrides based on the saved colors and injects it into the document head. The `<body>` element also gets a `data-theme="custom-theme-id"` attribute.
*   UI components should primarily use the defined CSS variables (e.g., `var(--primary-color)`, `var(--background-color)`) for styling to ensure they adapt correctly to the selected theme.
</details>

## 🛠️ Development Notes

<details>
<summary><strong>💻 Development Tips</strong></summary>

*   Changes to frontend code (in `/src`) should trigger hot-reloading in the browser.
*   If you modify `Dockerfile`, `docker-compose.yml`, or `Caddyfile`, you'll need to rebuild and restart the services (`docker compose up -d --build --force-recreate`).
*   Caddy logs can be viewed with `docker compose logs caddy`.
*   ROS stack logs can be viewed with `docker compose logs ros-stack`.
</details>

## 🧩 Codebase Organization

<details>
<summary><strong>📁 Project Structure</strong></summary>

The codebase follows a component-based architecture:

- `/src/components` - Main UI components and layouts
  - Core UI components: `MainControlView`, `Navbar`, `SettingsPopup`, etc.
  - `/gamepads` - Pre-built gamepad control interfaces
    - `/standard` - Standard dual joystick layout
    - `/gameboy` - GameBoy-style control layout  
    - `/voice` - Voice control interface
    - `/drone` - Drone control interface
    - `/manipulator` - Robotic arm control interface
    - `/custom` - Custom gamepad wrapper component
  - `/visualizers` - 3D visualization components
    - `PointCloudViz.tsx` - Point cloud visualization
    - `UrdfViz.tsx` - URDF model visualization
    - `CameraInfoViz.tsx` - Camera information display
- `/src/features` - Feature-specific code organized by functionality
  - `/theme` - Theme system with custom color palette creation
  - `/customGamepad` - **Custom Gamepad Creator System**
    - `types.ts` - TypeScript interfaces and component definitions
    - `defaultLayouts.ts` - Pre-built layouts and component library
    - `gamepadStorage.ts` - Local storage management for custom layouts
    - `/components` - Custom gamepad editor and component implementations
      - `GamepadEditor.tsx` - Main drag-and-drop editor interface
      - `CustomGamepadLayout.tsx` - Runtime layout renderer
      - `GamepadComponent.tsx` - Generic component wrapper
      - `JoystickComponent.tsx`, `ButtonComponent.tsx`, `DPadComponent.tsx`
      - `ToggleComponent.tsx`, `SliderComponent.tsx` - Input components
      - Various UI components for editor functionality
- `/src/hooks` - Custom React hooks including ROS connection and visualization
- `/src/utils` - Utility functions and helpers
- `/src/types` - TypeScript type definitions
</details>

<details>
<summary><strong>🎨 Adding Custom Gamepad Layouts</strong></summary>

#### 🎨 For End Users (In-App Creator)
Use the built-in Custom Gamepad Creator accessible through the "+" button in control panel tabs. **No coding required!**
- Drag-and-drop interface with pre-built components
- Perfect for most use cases and quick prototyping
- Supports joysticks, buttons, D-pads, toggles, and sliders
- Real-time preview and easy ROS topic configuration

#### 💻 For Developers (Code-Based Implementation)
**When the in-app system isn't enough** for your specific needs, you can implement custom gamepads via code:

- **Advanced Components**: Create custom component types not available in the drag-and-drop editor
- **Complex Logic**: Implement sophisticated control algorithms and state management
- **Performance Optimization**: Fine-tune for high-frequency or specialized operations
- **Custom ROS Integration**: Support for complex message types, actions, and services

**Implementation Paths:**
- **Hardcoded Layouts**: Create traditional gamepad components in `/src/components/gamepads`
- **Extend Custom System**: Add new component types to the custom gamepad library
- **Comprehensive Guide**: See the detailed README in `/src/features/customGamepad` for:
  - Architecture overview and component system
  - Adding new component types to the library
  - Extending ROS message support
  - Storage format and data structures
</details>
