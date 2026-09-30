#!/usr/bin/env bash
# Run one rosbridge configuration against the synthetic graph and print a JSON line.
#
#   scripts/rosbridge-bench/run.sh <label> "<rosbridge -p params>" [client.mjs options...]
#
# Expects the graph container from scripts/rosbridge-bench/README.md to be running.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
label="$1"; params="$2"; shift 2
image="${BENCH_IMAGE:-rbbench-ros:dev}"
port="${BENCH_PORT:-9290}"
domain="${BENCH_DOMAIN:-77}"
name="rbbench-rosbridge"
# A private bridge network: multicast discovery works as on a cell's SUBNET range,
# and nothing reaches the LAN. (Fast DDS's LOCALHOST range only probes a few
# participant ports, so a long-lived graph plus restarting bridges loses matches.)
network="${BENCH_NETWORK:-rbbench}"
# BENCH_CPUS caps the bridge container (rosbridge, rosapi, inspector) to emulate a slower,
# busier robot computer; unset means unlimited.
limits=()
[ -n "${BENCH_CPUS:-}" ] && limits=(--cpus "$BENCH_CPUS")

ros_params=""
for param in $params; do ros_params+=" -p $param"; done

docker rm -f "$name" >/dev/null 2>&1 || true
# A fresh address per run: Fast DDS derives a participant's GUID from host address and PID, and a
# container's PIDs repeat. On a reused address the new bridge would take over the GUID of the one
# just removed, and lose its matches when peers expire that participant's lease mid-run.
subnet="$(docker network inspect "$network" -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}')"
address="${subnet%.*/*}.$((RANDOM % 200 + 20))"
docker run -d --name "$name" --network "$network" --ip "$address" "${limits[@]}" \
  -e ROS_DOMAIN_ID="$domain" -e ROS_AUTOMATIC_DISCOVERY_RANGE=SUBNET \
  -e RMW_IMPLEMENTATION=rmw_fastrtps_cpp -e FASTDDS_BUILTIN_TRANSPORTS=UDPv4 \
  -e ROBOBOY_TF_RELAY_HZ="${BENCH_TF_RELAY_HZ:-60}" \
  -v "$repo/infra/ros:/bench-ros:ro" --entrypoint bash "$image" -c "
    source /opt/ros/jazzy/setup.bash
    python3 /bench-ros/inspection_runner.py &
    python3 /bench-ros/tf_relay.py &
    ros2 run rosapi rosapi_node --ros-args -r __node:=rosapi &
    exec ros2 run rosbridge_server rosbridge_websocket --ros-args -r __node:=rosbridge_websocket \
      -p port:=$port -p address:=0.0.0.0 $ros_params" >/dev/null
host="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$name")"

for _ in $(seq 60); do
  (echo > /dev/tcp/"$host"/"$port") 2>/dev/null && break
  sleep 0.5
done
sleep 3

# Host PIDs of this container's processes only; `ros2 run` wrappers idle, so match the child.
pid_of() { docker top "$name" -eo pid,args | awk -v pattern="$1" '$0 ~ pattern && !/ros2 run/ {print $1; exit}'; }
ticks() { awk '{print $14 + $15}' "/proc/$1/stat" 2>/dev/null || echo 0; }
bridge="$(pid_of "lib/rosbridge_server/rosbridge_websocket")"
rosapi="$(pid_of "lib/rosapi/rosapi_node")"
relay="$(pid_of "tf_relay.py")"
hz="$(getconf CLK_TCK)"
b0="$(ticks "$bridge")"; a0="$(ticks "$rosapi")"; r0="$(ticks "$relay")"; t0="$(date +%s.%N)"

result="$(node "$here/client.mjs" --url "ws://$host:$port" "$@")"

b1="$(ticks "$bridge")"; a1="$(ticks "$rosapi")"; r1="$(ticks "$relay")"; t1="$(date +%s.%N)"
drops="$(docker logs "$name" 2>&1 | grep -c 'Write queue full' || true)"
crashed="$(docker logs "$name" 2>&1 | grep -c -E 'Traceback|process has died' || true)"
[ -n "${BENCH_LOG:-}" ] && docker logs "$name" > "$BENCH_LOG" 2>&1
# BENCH_KEEP leaves the bridge running for inspection; the next run replaces it.
[ -z "${BENCH_KEEP:-}" ] && docker rm -f "$name" >/dev/null

node -e '
const [label, params, result, b0, b1, a0, a1, r0, r1, t0, t1, hz, drops, crashed] = process.argv.slice(1);
const cpu = (a, b) => Math.round(100 * (b - a) / hz / (t1 - t0));
console.log(JSON.stringify({ label, params, bridgeCpu: cpu(+b0, +b1), rosapiCpu: cpu(+a0, +a1), relayCpu: cpu(+r0, +r1),
  dropWarnings: +drops, crashes: +crashed, ...JSON.parse(result) }));
' "$label" "$params" "$result" "$b0" "$b1" "$a0" "$a1" "$r0" "$r1" "$t0" "$t1" "$hz" "$drops" "$crashed"
