import { assert, test } from 'vitest';
import type { TopicSource } from './config.ts';
import { SubscriptionController, type ManagedSubscription } from './subscriptions.ts';

const source = (topic: string, throttleMs = 33): TopicSource => ({
  key: `${topic}\u0000Type`,
  topic,
  messageType: 'Type',
  throttleMs,
});

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('reconciles add, remove, toggle, reconnect, and disposal lifecycles', async () => {
  const listeners = new Map<string, (message: unknown) => void>();
  const unsubscribeCount = new Map<string, number>();
  const subscribeCalls: string[] = [];
  const controller = new SubscriptionController(
    async (item, listener): Promise<ManagedSubscription> => {
      subscribeCalls.push(item.topic);
      listeners.set(item.topic, listener);
      return {
        unsubscribe: async () => {
          unsubscribeCount.set(item.topic, (unsubscribeCount.get(item.topic) ?? 0) + 1);
          listeners.delete(item.topic);
        },
      };
    },
    () => undefined,
    (item, error) => assert.fail(`${item.topic}: ${String(error)}`)
  );

  controller.reconcile([source('/a'), source('/b')]);
  await settle();
  assert.deepEqual(subscribeCalls, ['/a', '/b']);
  assert.equal(controller.size, 2);

  controller.reconcile([source('/b')]);
  await settle();
  assert.equal(unsubscribeCount.get('/a'), 1);
  assert.equal(controller.size, 1);

  controller.restart([source('/b')]);
  await settle();
  assert.equal(unsubscribeCount.get('/b'), 1);
  assert.deepEqual(subscribeCalls, ['/a', '/b', '/b']);

  controller.reconcile([source('/b'), source('/c')]);
  await settle();
  controller.dispose();
  await settle();
  assert.equal(unsubscribeCount.get('/b'), 2);
  assert.equal(unsubscribeCount.get('/c'), 1);
  assert.equal(controller.size, 0);
});

test('unsubscribes a late async result after its series was removed', async () => {
  let resolveSubscription: ((subscription: ManagedSubscription) => void) | undefined;
  let unsubscribeCount = 0;
  const controller = new SubscriptionController(
    () =>
      new Promise(resolve => {
        resolveSubscription = resolve;
      }),
    () => undefined,
    () => undefined
  );
  controller.reconcile([source('/late')]);
  controller.reconcile([]);
  resolveSubscription?.({
    unsubscribe: async () => {
      unsubscribeCount += 1;
    },
  });
  await settle();
  assert.equal(unsubscribeCount, 1);
  assert.equal(controller.size, 0);
});

test('replaces a subscription when throttle configuration changes', async () => {
  const calls: number[] = [];
  let unsubscribeCount = 0;
  const controller = new SubscriptionController(
    async item => {
      calls.push(item.throttleMs);
      return {
        unsubscribe: async () => {
          unsubscribeCount += 1;
        },
      };
    },
    () => undefined,
    () => undefined
  );
  controller.reconcile([source('/fast', 33)]);
  await settle();
  controller.reconcile([source('/fast', 100)]);
  await settle();
  assert.deepEqual(calls, [33, 100]);
  assert.equal(unsubscribeCount, 1);
});
