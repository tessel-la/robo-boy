# rosbridge load bench

Reproduces a busy cell against one rosbridge configuration and reports what a remote Robo-Boy
client experiences. Results and the chosen defaults are in
[docs/performance.md](../../docs/performance.md#rosbridge-load).

- `graph.py` publishes a synthetic graph shaped like r021-bg-008:
  - `/tf` at about 1500 Hz from four publishers;
  - about 300 topics, 540 services and 10 action servers;
  - optionally, a point cloud.
- `run.sh` starts rosbridge, rosapi, the inspector and the TF relay from `infra/ros`, with the
  rosbridge parameters you pass. It runs the client and prints one JSON line, including average
  CPU per process and how often rosbridge logged `Write queue full`.
- `client.mjs` behaves like Robo-Boy:
  - subscribes to the shared TF stream;
  - runs behavior-tree discovery (`legacy`, one rosapi call per service, or `graph`, one
    inspector snapshot);
  - optionally sends action goals;
  - calls `/rosapi/get_time` every 250 ms as a responsiveness probe.

  It routes the connection through a proxy that can emulate a remote link, with bandwidth, RTT,
  and TCP-like backpressure.

## Run

```bash
docker build -f infra/docker/Dockerfile.ros -t rbbench-ros:dev .
docker network create --subnet 10.77.0.0/24 rbbench  # run.sh gives each bridge a fresh address
docker run -d --name rbbench-graph --network rbbench --ip 10.77.0.2 -e ROS_DOMAIN_ID=77 \
  -e FASTDDS_BUILTIN_TRANSPORTS=UDPv4 -v "$PWD/scripts/rosbridge-bench:/bench:ro" \
  --entrypoint bash rbbench-ros:dev -c 'source /opt/ros/jazzy/setup.bash; g=/bench/graph.py
    python3 $g graph 50 & python3 $g static &
    python3 $g tf robot_big_egm 250 6 & python3 $g tf robot_small_egm 250 6 &
    python3 $g tf joint_tf 500 2 & python3 $g tf belief_world 500 1 & wait'

# Today's defaults against direct /tf over a 6 Mbit/s, 60 ms link:
scripts/rosbridge-bench/run.sh before "use_events_executor:=false use_compression:=false" \
  --seconds 40 --discovery legacy --goals 10 --link-kbps 6000 --rtt-ms 60
# The shipped configuration:
scripts/rosbridge-bench/run.sh after "use_events_executor:=true use_compression:=true" \
  --seconds 40 --discovery graph --goals 10 --tf-topic /roboboy/tf --link-kbps 6000 --rtt-ms 60
```

Environment variables:

| Variable | Effect |
| --- | --- |
| `BENCH_CPUS` | Caps the bridge container's CPUs, to emulate a busy robot computer. |
| `BENCH_TF_RELAY_HZ` | Sets the relay rate. |
| `BENCH_LOG=<file>` | Keeps the bridge container's log. |

The bench uses its own Docker network and DDS domain (77), so it reaches neither the LAN nor a
local Robo-Boy stack. Do not switch it to `ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST`: Fast DDS
then contacts only the first few participant ports, and a long-lived graph plus restarting
bridges gradually loses publishers.

## Reading the output

| Field | Meaning |
| --- | --- |
| `tfHz`, `transformsHz` | TF messages and transforms per second that reached the client. The graph publishes 15 dynamic frames. |
| `tfStalenessMs` | Receive time minus each transform's stamp: how old the pose on screen is. |
| `probe` | `/rosapi/get_time` round trips: `lost` counts calls without an answer within 10 s. |
| `discovery` | Time to a complete behavior-tree palette, with per-call latency for `legacy`. |
| `downKbps` | Server-to-client traffic on the wire. |
| `bridgeCpu`, `relayCpu`, `rosapiCpu` | Average percent of one core over the run. |
| `dropWarnings` | Seconds in which rosbridge dropped outgoing messages. The warning is throttled to once per second. |
