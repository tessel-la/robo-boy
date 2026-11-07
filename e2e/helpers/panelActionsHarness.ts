import { ControlSession } from '../../src/features/robotControl/ControlSession';
import { connectPanelCapabilityBroker } from '../../src/panels/capabilityBroker';

// A local, deterministic transport: this harness never opens a robot WebSocket.
const listeners = new Map<string, Set<(message: unknown) => void>>();
const socket = new EventTarget();
const sent: any[] = [];
const received: any[] = [];
let owned = false;
const ros: any = {
  isConnected: true,
  socket,
  on(name: string, listener: (message: unknown) => void) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(listener);
  },
  off(name: string, listener: (message: unknown) => void) {
    listeners.get(name)?.delete(listener);
  },
  callOnConnection(message: any) {
    sent.push(message);
    if (message.op === 'roboboy_control' && message.action === 'acquire') {
      owned = true;
      status();
    }
  },
};
const status = () =>
  listeners.get('/roboboy/control/status')?.forEach(listener =>
    listener({
      data: JSON.stringify({
        version: 1,
        selfId: 'browser',
        owner: owned ? 'browser' : null,
        token: owned ? 'host-secret-token' : null,
        state: owned ? 'owned' : 'available',
        ready: true,
        pending: 0,
        managing: false,
        adoptable: false,
        leaseMs: 10000,
        reason: '',
        error: '',
        clients: [{ id: 'browser', label: 'Browser' }],
      }),
    })
  );
new ControlSession(ros);
status();

const bundleSource = `export default {
  id: 'com.example.actions', apiVersion: '2.0.0',
  activate(context) {
    let root, goal;
    return {
      mount(element) {
        root = element;
        root.innerHTML = '<button id="control">Request control</button><button id="move">Move</button><button id="stop">Stop</button><output id="auto"></output><output id="state">idle</output><output id="progress"></output>';
        const state = text => root.querySelector('#state').textContent = text;
        context.ros.control.request().then(() => root.querySelector('#auto').textContent = 'unexpected acquisition', () => root.querySelector('#auto').textContent = 'automatic acquisition blocked');
        root.querySelector('#control').onclick = async () => {
          try { state((await context.ros.control.request()).state); } catch (error) { state(error.message); }
        };
        root.querySelector('#move').onclick = async () => {
          try {
            goal = await context.ros.sendActionGoal({ action: '/robot/move', actionType: 'example_msgs/action/Move', goal: { target: 1 } }, feedback => root.querySelector('#progress').textContent = String(feedback.progress));
            state('moving');
            goal.result.then(outcome => state('terminal ' + outcome.status), error => state(error.message));
          } catch (error) { state(error.message); }
        };
        root.querySelector('#stop').onclick = async () => {
          try { await context.ros.cancelActionGoal(goal.goalId); state('cancelling'); } catch (error) { state(error.message); }
        };
      }, unmount() { root.replaceChildren(); }
    };
  }
};`;

const host = document.getElementById('host')!;
const iframe = document.createElement('iframe');
iframe.title = 'Action test panel';
iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-downloads');
let dispose: () => void;
iframe.onload = () => {
  const channel = new MessageChannel();
  dispose = connectPanelCapabilityBroker(
    channel.port1,
    {
      ros,
      hostElement: host,
      runtime: { target: 'web' },
      runtimeEndpoints: {},
      logger: console,
      manifest: {
        schemaVersion: 1,
        id: 'com.example.actions',
        name: 'Actions',
        description: 'Test',
        version: '1.0.0',
        entryPoint: '/actions/1.0.0/index.js',
        registryUrl: '/panels/installed.json',
        integrity: `sha256-${'A'.repeat(43)}=`,
        compatibility: { panelApi: '^2.0.0', roboboy: '*' },
        author: { name: 'Test' },
        repository: 'https://example.com',
        capabilities: ['ros'],
        permissions: {
          ros: { actions: location.search.includes('denyActions') ? [] : ['/robot/move'], control: true },
        },
      },
    },
    message => received.push(message)
  );
  iframe.contentWindow!.postMessage({ type: 'roboboy-panel-port' }, '*', [channel.port2]);
  channel.port1.postMessage({
    type: 'initialize',
    value: {
      panelId: 'com.example.actions',
      instanceId: 'test',
      apiVersion: '2.0.0',
      bundleSource,
      capabilities: ['ros'],
      runtime: { target: 'web' },
      endpoints: {},
      connection: { status: 'connected', generation: 1 },
      viewport: { width: 800, height: 500, isActive: true, isIntersecting: true, isDocumentVisible: true },
      theme: { colorScheme: 'light', tokens: {} },
      storage: { enabled: false, values: {} },
    },
  });
};
iframe.src = `/panel-action-sandbox?parentOrigin=${encodeURIComponent(location.origin)}`;
host.append(iframe);
const wire = (message: unknown) => socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
(window as any).panelActionsHarness = {
  sent,
  received,
  goals: () => sent.filter(message => message.message?.op === 'send_action_goal'),
  cancels: () => sent.filter(message => message.message?.op === 'cancel_action_goal'),
  feedback: () => {
    const id = sent.find(message => message.message?.op === 'send_action_goal').message.id;
    wire({ op: 'action_feedback', id, values: { progress: 0.5 } });
  },
  finish: (status: number) => {
    const id = sent.find(message => message.message?.op === 'send_action_goal').message.id;
    wire({ op: 'action_result', id, status, result: true, values: { success: status === 4 } });
  },
  dispose: () => dispose(),
};
