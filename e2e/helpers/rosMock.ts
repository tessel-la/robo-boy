import type { Page } from '@playwright/test';

type MockRosResources = {
  topics?: Array<{ name: string; type: string }>;
  services?: Array<{ name: string; type: string }>;
  actionServers?: Array<{ name: string; type: string }>;
};

const defaultResources: Required<MockRosResources> = {
  topics: [{ name: '/cmd_vel', type: 'geometry_msgs/msg/Twist' }],
  services: [{ name: '/set_bool', type: 'std_srvs/srv/SetBool' }],
  actionServers: [{ name: '/navigate_to_pose', type: 'nav2_msgs/action/NavigateToPose' }],
};

export async function installRosMock(page: Page, resources: MockRosResources = {}): Promise<void> {
  const mockResources = {
    topics: resources.topics ?? defaultResources.topics,
    services: resources.services ?? defaultResources.services,
    actionServers: resources.actionServers ?? defaultResources.actionServers,
  };

  await page.addInitScript(initResources => {
    type Listener = (event?: unknown) => void;

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      static instances = new Set<MockWebSocket>();

      url: string;
      readyState = MockWebSocket.CONNECTING;
      binaryType = 'blob';
      onopen: Listener | null = null;
      onclose: Listener | null = null;
      onerror: Listener | null = null;
      onmessage: Listener | null = null;
      private listeners = new Map<string, Set<Listener>>();

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
        if (message.op !== 'call_service') return;

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

      static publish(topic: string, msg: unknown) {
        const event = {
          data: JSON.stringify({ op: 'publish', topic, msg }),
        };
        MockWebSocket.instances.forEach(socket => {
          if (socket.readyState === MockWebSocket.OPEN) socket.emit('message', event);
        });
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
          case '/rosapi/message_details':
          case '/rosapi/service_request_details':
            return { typedefs: [] };
          default:
            return {};
        }
      }
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    (
      window as unknown as {
        __publishRosTopic: (topic: string, message: unknown) => void;
      }
    ).__publishRosTopic = (topic, message) => MockWebSocket.publish(topic, message);
  }, mockResources);
}
