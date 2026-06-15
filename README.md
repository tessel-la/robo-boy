# Robo-Boy

[![Tests](https://github.com/tessel-la/robo-boy/actions/workflows/test.yml/badge.svg)](https://github.com/tessel-la/robo-boy/actions/workflows/test.yml)
[![Docker Build](https://github.com/tessel-la/robo-boy/actions/workflows/docker-ci.yml/badge.svg)](https://github.com/tessel-la/robo-boy/actions/workflows/docker-ci.yml)

<p align="center">
  <img src="images/logo.png" alt="Robo-Boy Logo" width="200">
</p>

Robo-Boy is a web interface for controlling and visualizing ROS 2 robots. It includes camera streaming, configurable control pads, 3D visualization, behavior-tree editing, and custom themes.

## Start With Docker

### Prerequisites

- Docker with Docker Compose
- [mkcert](https://github.com/FiloSottile/mkcert#installation)

### Run

```bash
git clone git@github.com:tessel-la/robo-boy.git
cd robo-boy
mkcert -install
mkdir -p infra/caddy/certs
mkcert -key-file infra/caddy/certs/local-key.pem -cert-file infra/caddy/certs/local-cert.pem localhost 127.0.0.1 ::1 YOUR_HOST_IP
cp config/env/no-overlay.env.example .env
docker compose up -d --build
```

Replace `YOUR_HOST_IP` with the computer's local network IP if Robo-Boy will be opened from another device.

Open `https://localhost`, or `https://YOUR_HOST_IP` from a device on the same network.

### Stop

```bash
docker compose down
```

## Documentation

See the [documentation index](docs/README.md) for application usage, development commands, ROS workspace overlays, custom gamepads, and architecture.

## License

See [LICENSE](LICENSE).
