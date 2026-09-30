#!/usr/bin/env node
// A Robo-Boy-shaped rosbridge client for load tests: the shared TF stream, the
// behavior-tree panel's discovery, and a steady probe service call that shows how
// responsive the connection stays. Prints one JSON report.
//
//   node client.mjs --url ws://127.0.0.1:9290 --seconds 30 \
//     [--tf-topic /tf] [--tf-throttle 0] [--tf-queue 0] [--tf-compression cbor] \
//     [--discovery legacy|graph|none] [--link-kbps 0 --rtt-ms 0] [--clients 1]
import net from 'node:net';
import { parseArgs } from 'node:util';
import ROSLIB from 'roslib';

const { values: options } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://127.0.0.1:9290' },
    seconds: { type: 'string', default: '30' },
    'tf-topic': { type: 'string', default: '/tf' },
    'tf-type': { type: 'string', default: 'tf2_msgs/TFMessage' },
    'tf-throttle': { type: 'string', default: '0' },
    'tf-queue': { type: 'string', default: '0' },
    'tf-compression': { type: 'string', default: 'cbor' },
    discovery: { type: 'string', default: 'legacy' },
    'discovery-delay': { type: 'string', default: '3' },
    'call-timeout': { type: 'string', default: '10' },
    'link-kbps': { type: 'string', default: '0' },
    'rtt-ms': { type: 'string', default: '0' },
    clients: { type: 'string', default: '1' },
    goals: { type: 'string', default: '0' },
    'cloud-topic': { type: 'string', default: '' },
    'tf-frames': { type: 'string', default: '15' },
    timeline: { type: 'boolean', default: false },
  },
});
const seconds = Number(options.seconds);
const callTimeout = Number(options['call-timeout']) * 1000;

// Emulates a remote link: bounded bandwidth and latency with TCP-like backpressure, so a
// slow reader fills rosbridge's own write queue instead of an unbounded proxy buffer.
const traffic = { down: 0 };
function startLinkProxy(target, kbps, rttMs) {
  const [host, port] = new URL(target).host.split(':');
  const bytesPerMs = (kbps * 1024) / 8 / 1000;
  const inFlightLimit = Math.max(64 * 1024, bytesPerMs * rttMs * 2);
  const server = net.createServer(client => {
    const upstream = net.connect(Number(port), host);
    // rosbridge disables Nagle on its side; so does the browser for WebSockets.
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    // One in-order release queue per direction. (A timer per chunk reorders chunks, because
    // Node truncates fractional delays, and a reordered byte stream breaks WebSocket framing.)
    const shape = (from, to, limited) => {
      const queue = [];
      let queued = 0;
      let nextRelease = 0;
      let timer = null;
      const pump = () => {
        timer = null;
        const now = performance.now();
        while (queue.length && queue[0].at <= now) {
          const { chunk } = queue.shift();
          to.write(chunk);
          queued -= chunk.length;
        }
        if (queued <= inFlightLimit / 2) from.resume();
        if (queue.length) timer = setTimeout(pump, Math.max(0, queue[0].at - now));
      };
      from.on('data', chunk => {
        if (limited) traffic.down += chunk.length;
        const now = performance.now();
        const transfer = limited && bytesPerMs > 0 ? chunk.length / bytesPerMs : 0;
        nextRelease = Math.max(now, nextRelease) + transfer;
        queue.push({ chunk, at: nextRelease + rttMs / 2 });
        queued += chunk.length;
        if (queued > inFlightLimit) from.pause();
        if (!timer) timer = setTimeout(pump, Math.max(0, queue[0].at - now));
      });
      from.on('close', () => to.destroy());
      from.on('error', () => to.destroy());
    };
    shape(client, upstream, false);
    shape(upstream, client, true);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    server, url: `ws://127.0.0.1:${server.address().port}`,
  })));
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};

function call(ros, name, serviceType, request) {
  return new Promise(resolve => {
    const started = performance.now();
    const timer = setTimeout(() => resolve({ ok: false, timeout: true, ms: callTimeout }), callTimeout);
    new ROSLIB.Service({ ros, name, serviceType }).callService(
      request,
      response => { clearTimeout(timer); resolve({ ok: true, response, ms: performance.now() - started }); },
      error => { clearTimeout(timer); resolve({ ok: false, error: String(error), ms: performance.now() - started }); },
    );
  });
}

// The behavior-tree panel's current discovery sequence (rosDiscovery.ts on dev).
async function legacyDiscovery(ros, stats) {
  const record = result => {
    stats.calls += 1;
    if (result.timeout) stats.timeouts += 1;
    stats.latencies.push(result.ms);
    return result;
  };
  const [services, topics] = await Promise.all([
    call(ros, '/rosapi/services', 'rosapi_msgs/srv/Services', {}).then(record),
    call(ros, '/rosapi/topics', 'rosapi_msgs/srv/Topics', {}).then(record),
  ]);
  const servers = record(await call(ros, '/rosapi/action_servers', 'rosapi_msgs/srv/GetActionServers', {}));
  for (const action of servers.response?.action_servers ?? []) {
    record(await call(ros, '/rosapi/action_type', 'rosapi_msgs/srv/ActionType', { action }));
  }
  const names = (services.response?.services ?? []).filter(service => !service.startsWith('/rosout') &&
    !service.startsWith('/_') && !service.startsWith('/rosapi/') && !service.includes('/_action/') &&
    !/\/(get_loggers|set_logger_level|describe_parameters|get_parameter|set_parameter|list_parameters)/.test(service));
  for (const service of names) {
    record(await call(ros, '/rosapi/service_type', 'rosapi_msgs/srv/ServiceType', { service }));
  }
  record(await call(ros, '/rosapi/topics', 'rosapi_msgs/srv/Topics', {}));
  stats.services = names.length;
  stats.actions = servers.response?.action_servers?.length ?? 0;
  stats.topics = topics.response?.topics?.length ?? 0;
}

// One graph snapshot from the inspection runner, the Data Explorer's source.
function graphDiscovery(ros, stats) {
  return new Promise(resolve => {
    const client = `bench-${Math.random().toString(36).slice(2)}`;
    const graph = new ROSLIB.Topic({ ros, name: '/roboboy/inspection/graph', messageType: 'std_msgs/msg/String' });
    const request = new ROSLIB.Topic({ ros, name: '/roboboy/inspection/request', messageType: 'std_msgs/msg/String' });
    // Like InspectionSession, keep leasing until the graph arrives: the first request can go
    // out before rosbridge's publisher has matched the inspector's subscription.
    const lease = () => request.publish({ data: JSON.stringify({ version: 1, client, watch: [], details: [], refresh: true }) });
    const leasing = setInterval(lease, 1000);
    const timer = setTimeout(() => { clearInterval(leasing); stats.timeouts += 1; graph.unsubscribe(); resolve(); }, callTimeout);
    graph.subscribe(message => {
      clearInterval(leasing);
      const resources = JSON.parse(message.data).graph?.resources ?? JSON.parse(message.data).resources ?? [];
      const count = kind => resources.filter(resource => resource.kind === kind).length;
      Object.assign(stats, { services: count('service'), actions: count('action'), topics: count('topic') });
      stats.calls += 1;
      clearTimeout(timer);
      graph.unsubscribe();
      resolve();
    });
    lease();
  });
}

// Sequential goals over rosbridge's raw action protocol, as the behavior-tree executor sends them.
async function sendGoals(ros, count, stats) {
  const results = new Map();
  ros.socket.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data);
    if (message.op === 'action_result') results.get(message.id)?.(message);
  });
  for (let index = 0; index < count; index += 1) {
    const id = `bench_goal_${index}`;
    const started = performance.now();
    const result = await new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), callTimeout);
      results.set(id, message => { clearTimeout(timer); resolve(message); });
      ros.callOnConnection({ op: 'send_action_goal', id, action: '/cell/unit_0/move',
        action_type: 'tf2_msgs/action/LookupTransform', args: { target_frame: 'a', source_frame: 'b' }, feedback: true });
    });
    results.delete(id);
    if (result?.status === 4) stats.succeeded += 1;
    else stats.failed += 1;
    stats.latencies.push(performance.now() - started);
  }
}

async function runClient(url, index) {
  const ros = new ROSLIB.Ros({ url });
  await new Promise((resolve, reject) => { ros.on('connection', resolve); ros.on('error', reject); });
  const report = {
    tf: { messages: 0, transforms: 0, staleness: [] },
    probe: { sent: 0, lost: 0, latencies: [] },
    discovery: { mode: options.discovery, calls: 0, timeouts: 0, latencies: [], ms: null },
    goals: { succeeded: 0, failed: 0, latencies: [] },
    // Per-second TF messages and lost probes, to see when a run degrades.
    timeline: { tf: [], lost: [] },
  };
  let started = performance.now();
  const tfOptions = {
    ros, name: options['tf-topic'], messageType: options['tf-type'],
    throttle_rate: Number(options['tf-throttle']), queue_length: Number(options['tf-queue']),
  };
  if (options['tf-compression'] !== 'none') tfOptions.compression = options['tf-compression'];
  const tf = new ROSLIB.Topic(tfOptions);
  let measuring = false;
  const framesSeen = new Set();
  tf.subscribe(message => {
    for (const transform of message.transforms ?? []) framesSeen.add(transform.child_frame_id);
    if (!measuring) return;
    report.tf.messages += 1;
    report.timeline.tf[Math.floor((performance.now() - started) / 1000)] =
      (report.timeline.tf[Math.floor((performance.now() - started) / 1000)] ?? 0) + 1;
    for (const transform of message.transforms ?? []) {
      report.tf.transforms += 1;
      const stamp = transform.header?.stamp;
      if (stamp) report.tf.staleness.push(Date.now() - (stamp.sec * 1000 + stamp.nanosec / 1e6));
    }
  });
  new ROSLIB.Topic({ ros, name: '/tf_static', messageType: 'tf2_msgs/TFMessage', compression: 'cbor' }).subscribe(() => {});
  // As usePointCloudClient subscribes: CBOR, ~30 Hz throttle, latest only.
  report.cloud = { messages: 0 };
  if (options['cloud-topic']) {
    new ROSLIB.Topic({ ros, name: options['cloud-topic'], messageType: 'sensor_msgs/msg/PointCloud2',
      throttle_rate: 33, queue_length: 1, compression: 'cbor' }).subscribe(() => { if (measuring) report.cloud.messages += 1; });
  }

  // Measure the steady state: a freshly started bridge can take many seconds to match a large
  // graph over DDS, which would otherwise read as lost calls and missing TF.
  const warmupStarted = performance.now();
  const wanted = Number(options['tf-frames']);
  while (performance.now() - warmupStarted < 60_000) {
    const answered = (await call(ros, '/rosapi/get_time', 'rosapi_msgs/srv/GetTime', {})).ok;
    if (answered && framesSeen.size >= wanted) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  report.warmupMs = Math.round(performance.now() - warmupStarted);
  report.warmFrames = framesSeen.size;
  await new Promise(resolve => setTimeout(resolve, 1000));
  measuring = true;
  started = performance.now();
  const probe = setInterval(async () => {
    report.probe.sent += 1;
    const result = await call(ros, '/rosapi/get_time', 'rosapi_msgs/srv/GetTime', {});
    if (result.ok) report.probe.latencies.push(result.ms);
    else {
      report.probe.lost += 1;
      const second = Math.floor((performance.now() - started) / 1000);
      report.timeline.lost[second] = (report.timeline.lost[second] ?? 0) + 1;
    }
  }, 250);

  let discovery = Promise.resolve();
  if (index === 0 && options.discovery !== 'none') {
    discovery = new Promise(resolve => setTimeout(resolve, Number(options['discovery-delay']) * 1000)).then(async () => {
      const began = performance.now();
      await (options.discovery === 'graph' ? graphDiscovery : legacyDiscovery)(ros, report.discovery);
      report.discovery.ms = Math.round(performance.now() - began);
      await sendGoals(ros, Number(options.goals), report.goals);
    });
  }
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  const elapsed = (performance.now() - started) / 1000;
  const timedOut = await Promise.race([discovery.then(() => false), new Promise(r => setTimeout(() => r(true), 100))]);
  clearInterval(probe);
  measuring = false;
  ros.close();
  const { staleness } = report.tf;
  const { latencies } = report.probe;
  return {
    warmupMs: report.warmupMs,
    ...(options.timeline ? { timeline: { tf: Array.from(report.timeline.tf, v => v ?? 0),
      lost: Array.from(report.timeline.lost, v => v ?? 0) } } : {}),
    warmFrames: report.warmFrames,
    tfHz: Math.round(report.tf.messages / elapsed),
    ...(options['cloud-topic'] ? { cloudHz: Math.round((report.cloud.messages / elapsed) * 10) / 10 } : {}),
    transformsHz: Math.round(report.tf.transforms / elapsed),
    tfStalenessMs: { p50: percentile(staleness, 50), p99: percentile(staleness, 99), max: percentile(staleness, 100) },
    probe: { sent: report.probe.sent, lost: report.probe.lost, p50: percentile(latencies, 50), p99: percentile(latencies, 99) },
    goals: Number(options.goals) ? { ...report.goals, latencies: undefined,
      p50: percentile(report.goals.latencies, 50), p99: percentile(report.goals.latencies, 99) } : undefined,
    discovery: report.discovery.mode === 'none' ? null : {
      mode: report.discovery.mode,
      finished: !timedOut && report.discovery.ms !== null,
      ms: report.discovery.ms,
      calls: report.discovery.calls,
      timeouts: report.discovery.timeouts,
      callP50: percentile(report.discovery.latencies, 50),
      callP99: percentile(report.discovery.latencies, 99),
      found: { services: report.discovery.services, actions: report.discovery.actions, topics: report.discovery.topics },
    },
  };
}

// Every client goes through the proxy, unshaped by default, so traffic is always measured.
const proxy = await startLinkProxy(options.url, Number(options['link-kbps']), Number(options['rtt-ms']));
const began = performance.now();
const results = await Promise.all(Array.from({ length: Number(options.clients) }, (_, index) => runClient(proxy.url, index)));
const downKbps = Math.round((traffic.down * 8) / 1024 / ((performance.now() - began) / 1000));
proxy.server.close();
console.log(JSON.stringify({ downKbps, ...(results.length === 1 ? results[0] : { clients: results }) }));
process.exit(0);
