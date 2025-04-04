# 🤖 Robo-Boy

```ascii
 ____   __  ____   __       ____   __  _  _ 
(  _ \ /  \(  _ \ /  \  ___(  _ \ /  \( \/ )
 )   /(  O )) _ ((  O )(___)) _ ((  O ))  / 
(__\_) \__/(____/ \__/     (____/ \__/(__/  
```

A vibe web application for controlling ROS 2 robots, featuring a React frontend, ROS 2 integration via rosbridge, and secure local development setup with Caddy and HTTPS. Inspired by retro handheld consoles.

## ✨ Features

*   📱 Responsive design for desktop and mobile.
*   🔗 ROS 2 connection (via rosbridge).
*   📷 Camera stream display (via web_video_server).
*   🕹️ Gamepad-style joystick control (publishing `sensor_msgs/Joy`).
*   🗣️ Voice control input with recording animation.
*   🧊 3D visualization support (using ros3djs).
*   🌗 Animated Light/Dark mode toggle.
*   🛡️ Local HTTPS development setup via Caddy and mkcert.

## 🖼️ Screenshot

<!-- Replace with actual paths if different -->
<p align="center">
  <img src="images/landing.png" alt="Landing Page" width="30%">
  <img src="images/pad.png" alt="Pad Control" width="30%">
  <img src="images/voice.png" alt="Voice Control" width="30%">
</p>

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

```