import { beforeEach, describe, expect, it, vi } from 'vitest';

const rosMock = vi.hoisted(() => {
  const topics: MockTopic[] = [];
  class MockTopic {
    options: Record<string, unknown>;
    callback?: (message: unknown) => void;
    published: Array<{ data: string }> = [];
    unsubscribe = vi.fn();
    unadvertise = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      topics.push(this);
    }

    subscribe(callback: (message: unknown) => void) {
      this.callback = callback;
    }
    publish(message: { data: string }) {
      this.published.push(message);
    }
  }
  class MockMessage {
    data: string;
    constructor(values: { data: string }) {
      this.data = values.data;
    }
  }
  return { topics, MockTopic, MockMessage };
});

vi.mock('roslib', () => ({
  default: { Topic: rosMock.MockTopic, Message: rosMock.MockMessage },
  Topic: rosMock.MockTopic,
  Message: rosMock.MockMessage,
}));

import {
  BT_COMMAND_TOPIC,
  BT_STATUS_TOPIC,
  PersistentBehaviorTreeExecutor,
  loadPersistentExecutionPreference,
  savePersistentExecutionPreference,
} from './persistentExecutor';

describe('PersistentBehaviorTreeExecutor', () => {
  beforeEach(() => {
    rosMock.topics.length = 0;
    localStorage.clear();
  });

  it('sends versioned commands and relays valid runner status', () => {
    const client = new PersistentBehaviorTreeExecutor({} as any);
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    const commandTopic = rosMock.topics.find(topic => topic.options.name === BT_COMMAND_TOPIC)!;
    const statusTopic = rosMock.topics.find(topic => topic.options.name === BT_STATUS_TOPIC)!;

    expect(JSON.parse(commandTopic.published[0].data)).toMatchObject({ protocolVersion: 1, command: 'status' });
    const sessionId = client.start({ id: 'tree-1', name: 'Patrol', nodes: [], edges: [], createdAt: 1, updatedAt: 1 });
    expect(JSON.parse(commandTopic.published[1].data)).toMatchObject({
      protocolVersion: 1,
      command: 'start',
      sessionId,
      tree: { id: 'tree-1', name: 'Patrol' },
    });

    statusTopic.callback?.({ data: JSON.stringify({ protocolVersion: 1, state: 'running', sessionId }) });
    statusTopic.callback?.({ data: '{broken' });
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    expect(statusTopic.unsubscribe).toHaveBeenCalledOnce();
  });

  it('persists the opt-in preference defensively', () => {
    expect(loadPersistentExecutionPreference()).toBe(false);
    savePersistentExecutionPreference(true);
    expect(loadPersistentExecutionPreference()).toBe(true);
  });
});
