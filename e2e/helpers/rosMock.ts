import type { Page } from '@playwright/test';

/** One scripted goal: feedback messages, then a result (or nothing, for a goal that never ends). */
export type ScriptedActionGoal = {
  feedback?: unknown[];
  feedbackIntervalMs?: number;
  /** When the result comes, after the feedback. */
  delayMs?: number;
  status?: number;
  /** false: rosbridge could not run the goal (values is its reason). */
  result?: boolean;
  values?: unknown;
  hang?: boolean;
};

/** One scripted service call's answer. */
export type ScriptedServiceCall = {
  delayMs?: number;
  /** false: the call failed (values is the error). */
  result?: boolean;
  values?: unknown;
};

type MockRosResources = {
  /** Answers per action name, one per goal in turn; the last one repeats. */
  actionGoals?: Record<string, ScriptedActionGoal[]>;
  /** Answers per service name, one per call in turn; the last one repeats. */
  serviceCalls?: Record<string, ScriptedServiceCall[]>;
  topics?: Array<{ name: string; type: string }>;
  services?: Array<{ name: string; type: string }>;
  actionServers?: Array<{ name: string; type: string }>;
  nodes?: Array<{ name: string; subscribing?: string[]; publishing?: string[]; services?: string[] }>;
  parameters?: Record<string, unknown>;
};

const defaultResources: Required<MockRosResources> = {
  topics: [{ name: '/cmd_vel', type: 'geometry_msgs/msg/Twist' }],
  services: [{ name: '/set_bool', type: 'std_srvs/srv/SetBool' }],
  actionServers: [{ name: '/navigate_to_pose', type: 'nav2_msgs/action/NavigateToPose' }],
  nodes: [{ name: '/controller', subscribing: [], publishing: ['/cmd_vel'], services: ['/set_bool'] }],
  parameters: { '/controller/max_velocity': 1.5 },
};

export async function installRosMock(page: Page, resources: MockRosResources = {}): Promise<void> {
  const mockResources = {
    topics: resources.topics ?? defaultResources.topics,
    services: resources.services ?? defaultResources.services,
    actionServers: resources.actionServers ?? defaultResources.actionServers,
    nodes: resources.nodes ?? defaultResources.nodes,
    parameters: resources.parameters ?? defaultResources.parameters,
    actionGoals: resources.actionGoals ?? {},
    serviceCalls: resources.serviceCalls ?? {},
  };

  await page.addInitScript(initResources => {
    type Listener = (event?: unknown) => void;

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      static instances = new Set<MockWebSocket>();
      static subscriptionCounts = new Map<string, number>();
      static published = new Map<string, unknown[]>();
      static scriptedUses = new Map<string, number>();

      /** The next scripted answer for a name, the last one repeating. */
      static nextScripted<T>(kind: string, name: string, scripts: Record<string, T[]>): T | undefined {
        const list = scripts[name];
        if (!list?.length) return undefined;
        const key = `${kind}:${name}`;
        const used = MockWebSocket.scriptedUses.get(key) ?? 0;
        MockWebSocket.scriptedUses.set(key, used + 1);
        return list[Math.min(used, list.length - 1)];
      }

      url: string;
      readyState = MockWebSocket.CONNECTING;
      binaryType = 'blob';
      onopen: Listener | null = null;
      onclose: Listener | null = null;
      onerror: Listener | null = null;
      onmessage: Listener | null = null;
      private listeners = new Map<string, Set<Listener>>();
      private subscriptions = new Map<string, string>();

      constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.add(this);
        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.emit('open', { type: 'open' });
        }, 0);
      }

      addEventListener(type: string, listener: Listener) {
        const listeners = this.listeners.get(type) ?? new Set<Listener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      removeEventListener(type: string, listener: Listener) {
        this.listeners.get(type)?.delete(listener);
      }

      send(payload: string) {
        const message = JSON.parse(payload);
        if (message.op === 'subscribe' && typeof message.topic === 'string') {
          this.subscriptions.set(message.id ?? message.topic, message.topic);
          MockWebSocket.subscriptionCounts.set(
            message.topic,
            (MockWebSocket.subscriptionCounts.get(message.topic) ?? 0) + 1
          );
          // Latched topics are re-sent to a new subscriber, as rosbridge does for transient-local
          // publishers such as /tf_static.
          const latched = MockWebSocket.latched.get(message.topic);
          if (latched) {
            setTimeout(() => {
              if (this.readyState === MockWebSocket.OPEN) {
                this.emit('message', { data: JSON.stringify({ op: 'publish', topic: message.topic, msg: latched }) });
              }
            }, 0);
          }
          return;
        }
        // What the app publishes, so a test can check the messages a control sent.
        if (message.op === 'publish' && typeof message.topic === 'string') {
          MockWebSocket.published.set(message.topic, [...(MockWebSocket.published.get(message.topic) ?? []), message.msg]);
          return;
        }
        if (message.op === 'unsubscribe') {
          if (typeof message.id === 'string') this.subscriptions.delete(message.id);
          else if (typeof message.topic === 'string') {
            this.subscriptions.forEach((topic, id) => {
              if (topic === message.topic) this.subscriptions.delete(id);
            });
          }
          return;
        }
        if (message.op === 'send_action_goal') {
          const goal = MockWebSocket.nextScripted('action', message.action, initResources.actionGoals);
          if (!goal) return;
          const reply = (payload: Record<string, unknown>, delay: number) => setTimeout(() => {
            if (this.readyState === MockWebSocket.OPEN) {
              this.emit('message', { data: JSON.stringify({ id: message.id, action: message.action, ...payload }) });
            }
          }, delay);
          const interval = goal.feedbackIntervalMs ?? 50;
          (goal.feedback ?? []).forEach((values, index) => reply({ op: 'action_feedback', values }, interval * (index + 1)));
          if (goal.hang) return;
          reply(
            {
              op: 'action_result',
              values: goal.values ?? {},
              result: goal.result ?? true,
              ...(goal.result === false ? {} : { status: goal.status ?? 4 }),
            },
            interval * (goal.feedback?.length ?? 0) + (goal.delayMs ?? 20)
          );
          return;
        }
        if (message.op !== 'call_service') return;

        const scripted = MockWebSocket.nextScripted('service', message.service, initResources.serviceCalls);
        if (scripted) {
          setTimeout(() => {
            this.emit('message', {
              data: JSON.stringify({
                op: 'service_response',
                service: message.service,
                id: message.id,
                result: scripted.result ?? true,
                values: scripted.values ?? {},
              }),
            });
          }, scripted.delayMs ?? 20);
          return;
        }

        const values = this.getServiceValues(message.service, message.args ?? {});
        const response = {
          op: 'service_response',
          service: message.service,
          id: message.id,
          result: true,
          values,
        };

        setTimeout(() => {
          this.emit('message', { data: JSON.stringify(response) });
        }, 0);
      }

      close() {
        if (this.readyState === MockWebSocket.CLOSED) return;
        this.readyState = MockWebSocket.CLOSED;
        MockWebSocket.instances.delete(this);
        this.emit('close', { type: 'close' });
      }

      static latched = new Map<string, unknown>();

      static publish(topic: string, msg: unknown) {
        if (topic === '/tf_static') MockWebSocket.latched.set(topic, msg);
        const event = {
          data: JSON.stringify({ op: 'publish', topic, msg }),
        };
        MockWebSocket.instances.forEach(socket => {
          if (socket.readyState === MockWebSocket.OPEN && [...socket.subscriptions.values()].includes(topic)) {
            socket.emit('message', event);
          }
        });
      }

      static hasSubscription(topic: string) {
        return [...MockWebSocket.instances].some(socket => [...socket.subscriptions.values()].includes(topic));
      }

      static activeSubscriptionCount(topic: string) {
        return [...MockWebSocket.instances].reduce(
          (count, socket) => count + [...socket.subscriptions.values()].filter(value => value === topic).length,
          0
        );
      }

      private emit(type: string, event: unknown) {
        if (type === 'open') this.onopen?.(event);
        if (type === 'close') this.onclose?.(event);
        if (type === 'error') this.onerror?.(event);
        if (type === 'message') this.onmessage?.(event);
        this.listeners.get(type)?.forEach(listener => listener(event));
      }

      private getServiceValues(service: string, args: Record<string, string>) {
        const topics = initResources.topics.map(topic => topic.name);
        const topicTypes = initResources.topics.map(topic => topic.type);
        const services = initResources.services.map(item => item.name);
        const actionServers = initResources.actionServers.map(item => item.name);
        const action = initResources.actionServers.find(item => item.name === args.action);
        const serviceInfo = initResources.services.find(item => item.name === args.service);
        const topicInfo = initResources.topics.find(item => item.name === args.topic);
        const nodeInfo = initResources.nodes.find(item => item.name === args.node);

        switch (service) {
          case '/rosapi/topics':
            return { topics, types: topicTypes };
          case '/rosapi/services':
            return { services };
          case '/rosapi/action_servers':
            return { action_servers: actionServers };
          case '/rosapi/action_type':
            return { type: action?.type ?? '' };
          case '/rosapi/service_type':
            return { type: serviceInfo?.type ?? '' };
          case '/rosapi/topic_type':
            return { type: topicInfo?.type ?? '' };
          case '/rosapi/topics_for_type':
            return { topics: initResources.topics.filter(item => item.type === args.type).map(item => item.name) };
          case '/rosapi/message_details':
          case '/rosapi/service_request_details':
            return { typedefs: [] };
          case '/rosapi/nodes':
            return { nodes: initResources.nodes.map(item => item.name) };
          case '/rosapi/node_details':
            return {
              subscribing: nodeInfo?.subscribing ?? [],
              publishing: nodeInfo?.publishing ?? [],
              services: nodeInfo?.services ?? [],
            };
          case '/rosapi/get_param_names':
            return { names: Object.keys(initResources.parameters) };
          case '/rosapi/get_param':
            return { value: JSON.stringify(initResources.parameters[args.name]) };
          default:
            return {};
        }
      }
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    const mockWindow = window as unknown as {
      __getRosSubscriptionCount: (topic: string) => number;
      __getActiveRosSubscriptionCount: (topic: string) => number;
      __hasRosSubscription: (topic: string) => boolean;
      __publishRosTopic: (topic: string, message: unknown) => void;
      __getPublishedRosMessages: (topic: string) => unknown[];
    };
    mockWindow.__getRosSubscriptionCount = topic => MockWebSocket.subscriptionCounts.get(topic) ?? 0;
    mockWindow.__getActiveRosSubscriptionCount = topic => MockWebSocket.activeSubscriptionCount(topic);
    mockWindow.__hasRosSubscription = topic => MockWebSocket.hasSubscription(topic);
    mockWindow.__publishRosTopic = (topic, message) => MockWebSocket.publish(topic, message);
    mockWindow.__getPublishedRosMessages = topic => MockWebSocket.published.get(topic) ?? [];
  }, mockResources);
}

export async function getRosSubscriptionCount(page: Page, topic: string): Promise<number> {
  return page.evaluate(
    topicName =>
      (
        window as unknown as {
          __getRosSubscriptionCount: (topic: string) => number;
        }
      ).__getRosSubscriptionCount(topicName),
    topic
  );
}

export async function getActiveRosSubscriptionCount(page: Page, topic: string): Promise<number> {
  return page.evaluate(
    topicName =>
      (
        window as unknown as {
          __getActiveRosSubscriptionCount: (topic: string) => number;
        }
      ).__getActiveRosSubscriptionCount(topicName),
    topic
  );
}

export async function waitForRosSubscription(page: Page, topic: string, previousCount = 0): Promise<void> {
  await page.waitForFunction(
    ({ topicName, count }) => {
      const mockWindow = window as unknown as {
        __getRosSubscriptionCount: (topic: string) => number;
        __hasRosSubscription: (topic: string) => boolean;
      };
      return mockWindow.__hasRosSubscription(topicName) && mockWindow.__getRosSubscriptionCount(topicName) > count;
    },
    { topicName: topic, count: previousCount }
  );
}

export async function publishRosMessage(page: Page, topic: string, message: unknown): Promise<void> {
  await page.evaluate(
    ({ topic, message }) => (window as unknown as { __publishRosTopic: (t: string, m: unknown) => void }).__publishRosTopic(topic, message),
    { topic, message }
  );
}

/** The messages the app has published to a topic, oldest first. */
export async function getPublishedRosMessages(page: Page, topic: string): Promise<unknown[]> {
  return page.evaluate(
    name => (window as unknown as { __getPublishedRosMessages: (t: string) => unknown[] }).__getPublishedRosMessages(name),
    topic
  );
}
