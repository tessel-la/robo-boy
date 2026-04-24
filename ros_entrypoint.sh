#!/bin/bash
set -e

echo "--- Sourcing ROS Humble ---"
source /opt/ros/humble/setup.bash

# Source republisher workspace if built
if [ -f /republisher_ws/install/setup.bash ]; then
    echo "--- Sourcing republisher workspace ---"
    source /republisher_ws/install/setup.bash
fi

# Source optional robot overlay workspace for custom message types.
# To enable: mount your robot's workspace install dir to /overlay_ws in
# docker-compose.yml, e.g.:
#   volumes:
#     - /path/to/robot_ws/install:/overlay_ws:ro
#
# The workspace's setup.bash may have "not found" warnings because local_setup.bash
# paths reference the original build container. We therefore add the Python
# dist-packages directories directly to PYTHONPATH as a reliable fallback.
if [ -d /overlay_ws ]; then
    echo "--- Activating overlay workspace (/overlay_ws) ---"
    # Attempt standard setup (best-effort; warnings are harmless)
    source /overlay_ws/setup.bash 2>/dev/null || true
    # Directly prepend all dist-packages dirs so Python imports always work
    for py_dir in /overlay_ws/*/local/lib/python*/dist-packages; do
        if [ -d "$py_dir" ]; then
            export PYTHONPATH="${py_dir}:${PYTHONPATH}"
        fi
    done
    # Add lib dirs to LD_LIBRARY_PATH so C type-support .so files can be loaded
    for lib_dir in /overlay_ws/*/lib; do
        if [ -d "$lib_dir" ]; then
            export LD_LIBRARY_PATH="${lib_dir}:${LD_LIBRARY_PATH}"
        fi
    done
    # Add overlay package prefixes to AMENT_PREFIX_PATH so C type support can find them
    for pkg_dir in /overlay_ws/*/; do
        if [ -d "${pkg_dir}share/ament_index" ]; then
            export AMENT_PREFIX_PATH="${pkg_dir%/}:${AMENT_PREFIX_PATH}"
        fi
    done
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
