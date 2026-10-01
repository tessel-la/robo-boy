#!/bin/bash
# Real native runtimes, isolated DDS graph and deterministic Genesis mock backend.
set -euo pipefail
BT_PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BT_GENESIS_ROOT="${GENESIS_SIM_DIR:-${BT_PROJECT_ROOT}/../genesis-manipulator-sim}"
cd "$BT_PROJECT_ROOT"
docker build -f infra/docker/Dockerfile.ros -t robo-boy-bt-runtime:test .
docker build -f infra/docker/Dockerfile.genesis-bt-test \
  --build-context "genesis=${BT_GENESIS_ROOT}" -t robo-boy-genesis-bt:test .
docker run --rm --name robo-boy-genesis-bt-test robo-boy-genesis-bt:test
