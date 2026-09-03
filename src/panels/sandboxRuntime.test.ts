import { describe, expect, it, vi } from 'vitest';
import { createPanelSandboxDocument, panelSandboxBootstrap } from './sandboxRuntime';

// Mirrors what scripts/build-panel-sandbox.mjs bundles into the generated document.
const bootstrapSource = `(${panelSandboxBootstrap.toString()})(new URLSearchParams(location.search).get('parentOrigin') ?? '');`;

describe('panel sandbox document', () => {
  it('loads panel modules without leaking Vite runtime helpers into the iframe', () => {
    const document = createPanelSandboxDocument(bootstrapSource);

    expect(document).not.toContain('__vite__injectQuery');
    expect(document).toContain('__roboboyPanelModuleBridge_');
    expect(document).toContain('Panel bundle module loader failed.');
    expect(document).toContain("script-src 'unsafe-inline' blob:");
  });

  it('uses secure randomness and binds window messages to the parent origin', () => {
    const document = createPanelSandboxDocument(bootstrapSource);

    expect(document).toContain('crypto.getRandomValues(bytes)');
    expect(document).not.toContain('Math.random()');
    expect(document).toContain('event.source !== window.parent');
    expect(document).toContain('event.origin !== parentOrigin');
    expect(document).toMatch(/window\.parent\.postMessage\([^;]+,\s*parentOrigin\);/);
    // The document is a static build artifact, so the trusted origin arrives at runtime.
    expect(document).toContain("new URLSearchParams(location.search).get('parentOrigin')");
  });

  it('injects its base stylesheet at runtime rather than shipping an inline <style>', () => {
    // Tauri nonces every <style> element of an HTML asset, and a nonce in style-src makes
    // 'unsafe-inline' inert -- which would block every style a panel injects at runtime.
    expect(createPanelSandboxDocument(bootstrapSource)).not.toContain('<style');

    document.head.innerHTML = '';
    // Keep this bootstrap's window listener out of the other tests in this file.
    const addEventListener = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    panelSandboxBootstrap('https://roboboy.test');
    addEventListener.mockRestore();

    expect(document.head.querySelector('style')?.textContent).toContain('#panel-root');
  });

  it('provides the capability-scoped iframe runtime contract', async () => {
    document.body.innerHTML = '<div id="panel-root"><span>stale</span></div>';
    const createObjectURL = vi.fn(() => `blob:panel-${createObjectURL.mock.calls.length}`);
    const revokeObjectURL = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });

    let context: any;
    const instance = {
      mount: vi.fn((root: HTMLElement) => {
        root.textContent = 'mounted';
      }),
      setActive: vi.fn(),
      unmount: vi.fn(),
    };
    const definition = {
      id: 'com.example.panel',
      apiVersion: '2.0.0',
      activate: vi.fn((nextContext: unknown) => {
        context = nextContext;
        return instance;
      }),
    };
    const append = vi.spyOn(document.head, 'append').mockImplementation((...nodes: unknown[]) => {
      // The bootstrap also appends its base stylesheet; only the module loader carries the bridge.
      if (!nodes.some(node => node instanceof HTMLScriptElement)) return;
      const bridgeKey = Object.getOwnPropertyNames(globalThis).find(name =>
        name.startsWith('__roboboyPanelModuleBridge_')
      );
      expect(bridgeKey).toBeDefined();
      queueMicrotask(() => (globalThis as any)[bridgeKey!].resolve({ default: definition }));
    });

    type PortHandler = (event: { data: any }) => Promise<void>;
    const posted: any[] = [];
    const port: {
      onmessage: PortHandler | null;
      postMessage: ReturnType<typeof vi.fn>;
      start: ReturnType<typeof vi.fn>;
    } = {
      onmessage: null,
      start: vi.fn(),
      postMessage: vi.fn(message => {
        posted.push(message);
        if (message.type !== 'request' || message.params?.url === 'https://camera.test/slow') return;
        const values: Record<string, unknown> = {
          'ros.getTopics': [{ name: '/joint_states', messageType: 'sensor_msgs/msg/JointState' }],
          'ros.selectTopic': { name: '/joint_states', messageType: 'sensor_msgs/msg/JointState' },
          'ros.subscribe': { subscriptionId: 'subscription-1' },
          'network.fetch': {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            body: '{"stream":"ready"}',
          },
        };
        queueMicrotask(() =>
          port.onmessage?.({
            data:
              message.method === 'ros.callService'
                ? { type: 'response', requestId: message.requestId, error: 'service unavailable' }
                : { type: 'response', requestId: message.requestId, value: values[message.method] },
          })
        );
      }),
    };

    const parentPostMessage = vi.spyOn(window.parent, 'postMessage');
    panelSandboxBootstrap('https://roboboy.test');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'roboboy-panel-sandbox-probe' },
        origin: 'https://roboboy.test',
        source: window.parent,
      })
    );
    expect(parentPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'roboboy-panel-sandbox-ready' }),
      'https://roboboy.test'
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'roboboy-panel-port' },
        origin: 'https://roboboy.test',
        source: window.parent,
        ports: [port as unknown as MessagePort],
      })
    );
    expect(port.start).toHaveBeenCalledOnce();
    expect(port.onmessage).not.toBeNull();

    await port.onmessage!({
      data: {
        type: 'initialize',
        value: {
          panelId: 'com.example.panel',
          instanceId: 'panel-1',
          apiVersion: '2.0.0',
          bundleSource: 'export default panel;',
          capabilities: ['ros', 'network', 'storage'],
          endpoints: { camera: 'https://camera.test/whep' },
          runtime: { platform: 'web' },
          connection: { status: 'connected', generation: 1 },
          viewport: {
            width: 640,
            height: 480,
            isIntersecting: true,
            isDocumentVisible: true,
            isActive: true,
          },
          theme: {
            colorScheme: 'dark',
            tokens: { '--primary-color': '#00cc66', unsafe: 'discarded' },
          },
          storage: { enabled: true, schemaVersion: 1, quotaBytes: 128, values: { count: 1 } },
        },
      },
    });

    expect(definition.activate).toHaveBeenCalledOnce();
    expect(instance.mount).toHaveBeenCalledWith(document.getElementById('panel-root'));
    expect(instance.setActive).toHaveBeenCalledWith(true);
    expect(posted).toContainEqual({ type: 'ready' });
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--primary-color')).toBe('#00cc66');
    expect(document.documentElement.style.getPropertyValue('unsafe')).toBe('');
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    // One module loader; the other append is the bootstrap's base stylesheet.
    expect(append.mock.calls.filter(([node]) => node instanceof HTMLScriptElement)).toHaveLength(1);

    expect(context.storage.get('count', 0)).toBe(1);
    expect(context.storage.get('missing', 'fallback')).toBe('fallback');
    context.storage.set('mode', { enabled: true });
    expect(posted).toContainEqual({ type: 'storage', values: { count: 1, mode: { enabled: true } } });
    expect(() => context.storage.set('invalid key', true)).toThrow('Invalid panel storage key.');
    expect(() => context.storage.set('large', 'x'.repeat(256))).toThrow('Panel storage quota exceeded.');
    context.storage.remove('count');
    expect(context.storage.sizeBytes()).toBeGreaterThan(0);

    const circular: any = {};
    circular.self = circular;
    context.logger.error('panel log', new Error('failure'), circular, 'detail');
    expect(posted).toContainEqual(expect.objectContaining({ type: 'log', level: 'error', message: 'panel log' }));

    const connectionListener = vi.fn();
    const unsubscribeConnection = context.connection.subscribe(connectionListener);
    await port.onmessage!({ data: { type: 'connection', value: { status: 'disconnected', generation: 2 } } });
    expect(connectionListener).toHaveBeenCalledWith({ status: 'disconnected', generation: 2 });
    expect(context.connection.getSnapshot()).toEqual({ status: 'disconnected', generation: 2 });
    unsubscribeConnection();

    const viewportListener = vi.fn();
    context.viewport.subscribe(viewportListener);
    await port.onmessage!({
      data: {
        type: 'viewport',
        value: {
          width: 320,
          height: 240,
          isIntersecting: false,
          isDocumentVisible: true,
          isActive: false,
        },
      },
    });
    expect(viewportListener).toHaveBeenCalled();
    expect(context.viewport.getSnapshot().isActive).toBe(false);
    expect(instance.setActive).toHaveBeenLastCalledWith(false);
    await context.viewport.requestFullscreen();

    const themeListener = vi.fn();
    context.theme.subscribe(themeListener);
    await port.onmessage!({
      data: { type: 'theme', value: { colorScheme: 'light', tokens: { '--text-color': '#111' } } },
    });
    expect(themeListener).toHaveBeenCalledWith({ colorScheme: 'light', tokens: { '--text-color': '#111' } });
    expect(context.theme.getSnapshot().colorScheme).toBe('light');

    await expect(context.ros.getTopics()).resolves.toEqual([
      { name: '/joint_states', messageType: 'sensor_msgs/msg/JointState' },
    ]);
    await expect(context.ros.selectTopic({ currentTopic: '/joint_states' })).resolves.toEqual({
      name: '/joint_states',
      messageType: 'sensor_msgs/msg/JointState',
    });
    const rosListener = vi.fn();
    const subscription = await context.ros.subscribe({ topic: '/joint_states' }, rosListener);
    await port.onmessage!({
      data: { type: 'ros-message', subscriptionId: 'subscription-1', value: { position: [1] } },
    });
    expect(rosListener).toHaveBeenCalledWith({ position: [1] });
    await subscription.unsubscribe();
    await context.ros.publish({ topic: '/commands', message: { enabled: true } });
    await expect(context.ros.callService({ service: '/reset' })).rejects.toThrow('service unavailable');

    expect(context.network.endpoints).toEqual({ camera: 'https://camera.test/whep' });
    const response = await context.network.fetch('https://camera.test/status');
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.statusText).toBe('OK');
    expect(response.headers.get('Content-Type')).toBe('application/json');
    await expect(response.text()).resolves.toBe('{"stream":"ready"}');
    await expect(response.json()).resolves.toEqual({ stream: 'ready' });

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(
      context.network.fetch('https://camera.test/aborted', { signal: alreadyAborted.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    const activeAbort = new AbortController();
    const abortedRequest = context.network.fetch('https://camera.test/slow', { signal: activeAbort.signal });
    activeAbort.abort();
    await expect(abortedRequest).rejects.toMatchObject({ name: 'AbortError' });
    expect(posted).toContainEqual(expect.objectContaining({ type: 'cancel' }));

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('iframe error'), message: 'iframe error' }));
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: 'rejected value' });
    window.dispatchEvent(rejection);
    expect(posted).toContainEqual({ type: 'error', message: 'iframe error' });
    expect(posted).toContainEqual({ type: 'error', message: 'rejected value' });

    await port.onmessage!({ data: { type: 'dispose' } });
    expect(instance.unmount).toHaveBeenCalledOnce();
    expect(document.getElementById('panel-root')).toBeEmptyDOMElement();
  });
});
