#!/bin/bash
set -eo pipefail
source /opt/ros/${ROS_DISTRO}/setup.bash
source /genesis_ws/install/setup.bash
# Source ROS but retain the executor venv's pinned Python package precedence.
export PYTHONPATH="/opt/bt-venv/lib/python3.12/site-packages:${PYTHONPATH}"
setsid python3 -m genesis_manipulator_sim serve --backend mock --config /opt/genesis/config/default.toml --host 0.0.0.0 &
API_PID=$!
setsid python3 /opt/genesis/genesis_ros_bridge.py &
BRIDGE_PID=$!
setsid python3 /ros_ws/native_behavior_tree_runner.py &
BT_PID=$!
setsid ros2 launch /ros_ws/rosbridge_launch.xml port:=9090 &
ROSBRIDGE_PID=$!
cleanup() {
    # Background children can inherit ignored SIGINT. TERM invokes the runner's
    # orderly halt, and process groups also include ros2 launch's descendants.
    kill -TERM -- "-$BT_PID" 2>/dev/null || true
    for _ in {1..20}; do
        kill -0 "$BT_PID" 2>/dev/null || break
        sleep 1
    done
    kill -TERM -- "-$BRIDGE_PID" "-$API_PID" "-$ROSBRIDGE_PID" 2>/dev/null || true
    for _ in {1..5}; do
        if ! kill -0 "$BRIDGE_PID" "$API_PID" "$ROSBRIDGE_PID" 2>/dev/null; then break; fi
        sleep 1
    done
    kill -KILL -- "-$BT_PID" "-$BRIDGE_PID" "-$API_PID" "-$ROSBRIDGE_PID" 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM
if [ "$#" -gt 0 ]; then
    "$@"
else
    cd /ros_ws
    GENESIS_BT_E2E=1 REQUIRE_BT_RUNTIMES=1 python3 -m unittest test_native_bt_runtime test_bt_ros_bridge test_genesis_bt_e2e test_external_bt -v
fi
