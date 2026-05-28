#!/bin/bash
set -e

ROS_DISTRO="${ROS_DISTRO:-jazzy}"

echo "--- Sourcing ROS ${ROS_DISTRO} ---"
source "/opt/ros/${ROS_DISTRO}/setup.bash"

# Source republisher workspace if built
if [ -f /republisher_ws/install/setup.bash ]; then
    echo "--- Sourcing republisher workspace ---"
    source /republisher_ws/install/setup.bash
fi

# Source optional robot overlay workspaces for custom message types.
# Supported mounts:
#   /overlay_ws                         legacy single install workspace
#   /overlay_ws/<name>                  one or more install workspaces
#
# Some setup.bash files contain paths from the original build container, so we
# also add Python, library, and ament paths directly as a reliable fallback.
activate_overlay_workspace() {
    local overlay_dir="$1"

    if [ ! -f "${overlay_dir}/setup.bash" ]; then
        return
    fi

    echo "--- Activating overlay workspace (${overlay_dir}) ---"
    source "${overlay_dir}/setup.bash" 2>/dev/null || true

    # Directly prepend all Python package dirs so imports work even when a
    # relocated setup.bash cannot source every generated hook cleanly.
    for py_dir in "${overlay_dir}"/*/local/lib/python*/dist-packages "${overlay_dir}"/*/lib/python*/site-packages; do
        if [ -d "$py_dir" ]; then
            export PYTHONPATH="${py_dir}:${PYTHONPATH}"
        fi
    done

    # Add lib dirs to LD_LIBRARY_PATH so C type-support .so files can be loaded.
    for lib_dir in "${overlay_dir}"/*/lib; do
        if [ -d "$lib_dir" ]; then
            export LD_LIBRARY_PATH="${lib_dir}:${LD_LIBRARY_PATH}"
        fi
    done

    # Add overlay package prefixes to AMENT_PREFIX_PATH so C type support can find them.
    for pkg_dir in "${overlay_dir}"/*/; do
        if [ -d "${pkg_dir}share/ament_index" ]; then
            export AMENT_PREFIX_PATH="${pkg_dir%/}:${AMENT_PREFIX_PATH}"
        fi
    done
}

if [ -d /overlay_ws ]; then
    activate_overlay_workspace /overlay_ws

    for overlay_dir in /overlay_ws/*; do
        if [ -d "$overlay_dir" ]; then
            activate_overlay_workspace "$overlay_dir"
        fi
    done
fi

# Optional exact-path workspace setup. This helps when an external workspace was
# built with symlink-install or generated hooks that still reference its original
if [ -n "${ROBOT_WORKSPACE_SETUP:-}" ] && [ -f "${ROBOT_WORKSPACE_SETUP}" ]; then
    echo "--- Sourcing robot workspace setup (${ROBOT_WORKSPACE_SETUP}) ---"
    source "${ROBOT_WORKSPACE_SETUP}" 2>/dev/null || true
fi

echo "--- Launching ROS Components ---"

# Launch rosapi with respawn loop (the Node subclass has a bug; it may crash on first
# graph query, so we respawn it automatically)
(while true; do
    ros2 run rosapi rosapi_node --ros-args -r __ns:=/
    echo "[rosapi] exited, restarting in 2s..."
    sleep 2
done) &

# Launch rosbridge WebSocket server.
# call_services_in_new_thread=true prevents service calls from blocking
# rosbridge's WebSocket event loop (which would freeze the connection).
# send_action_goals_in_new_thread=true does the same for action goals.
# default_call_service_timeout=5.0 ensures calls never block indefinitely.
ros2 launch rosbridge_server rosbridge_websocket_launch.xml \
    address:=0.0.0.0 \
    call_services_in_new_thread:=true \
    send_action_goals_in_new_thread:=true \
    default_call_service_timeout:=5.0 &

# Launch web_video_server
ros2 run web_video_server web_video_server --ros-args -p address:=0.0.0.0 -p port:=8080 &

# Launch Foxglove Bridge
ros2 launch foxglove_bridge foxglove_bridge_launch.xml address:=0.0.0.0 port:=8765 &

echo "--- Waiting for processes to exit ---"
wait -n
echo "--- Exiting entrypoint ---"
exit $?
