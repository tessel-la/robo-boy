import { expect, test, type Page } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';
import { installXrEmulator, observeXrScene, pressXrControl, saveXrPanelPreview } from './helpers/xrEmulator';

declare global {
  interface Window {
    __agentSpeech: { continuous: boolean; onresult: ((event: unknown) => void) | null; onend: (() => void) | null };
    __agentMicStarts: number;
  }
}
async function pressSurface(page: Page, meshName: string, id: string) {
  await page.evaluate(
    async ({ meshName, id }) => {
      const mesh = window.__xrScene.uiGroup.getObjectByName(meshName)!;
      const surface = mesh.userData.xrSurface,
        item = surface.getItem(id);
      if (!item || item.disabled) throw new Error(`Unavailable control ${id}`);
      const path = '/src/xr/ui/SurfaceInteraction.ts';
      const { SurfaceInteraction } = await import(/* @vite-ignore */ path);
      new SurfaceInteraction().activate({
        object: mesh,
        uv: { x: (item.x + item.w / 2) / surface.pixelWidth, y: 1 - (item.y + item.h / 2) / surface.pixelHeight },
      });
    },
    { meshName, id }
  );
}
const speak = async (page: Page, text: string) => {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__xrScene.uiGroup.getObjectByName('xr-assistant-content')!.userData.xrSurface.getItem('voice').disabled
      )
    )
    .toBe(false);
  const previousStarts = await page.evaluate(() => window.__agentMicStarts);
  await pressXrControl(page, 'global-assistant', 'voice');
  await expect.poll(() => page.evaluate(() => window.__agentMicStarts)).toBe(previousStarts + 1);
  await page.evaluate(text => {
    window.__agentSpeech.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
    window.__agentSpeech.onend?.();
  }, text);
};
async function typeMessage(page: Page, text: string) {
  await pressXrControl(page, 'global-assistant', 'type');
  for (const char of text) await pressSurface(page, 'xr-assistant-keyboard', char === ' ' ? 'space' : `key-${char}`);
  await pressSurface(page, 'xr-assistant-keyboard', 'apply-input');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__xrScene.uiGroup.getObjectByName('xr-assistant-content')!.userData.xrSurface.getItem('send').disabled
      )
    )
    .toBe(false);
  await pressXrControl(page, 'global-assistant', 'send');
}

for (const mode of ['VR', 'AR'] as const) {
  test(`AI agent in ${mode} shares voice/text conversation and manages immersive panels`, async ({ page }) => {
    const errors: string[] = [],
      requests: Record<string, unknown>[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await installXrEmulator(page);
    await installRosMock(page);
    await page.addInitScript(() => {
      localStorage.setItem('robo-boy-desktop-workspace-panels-v1', '[]');
      localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', '[]');
      localStorage.setItem(
        'robo-boy-assistant-settings',
        JSON.stringify({
          provider: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:1234/v1',
          model: 'xr-test',
          apiKey: '',
          voiceLanguage: 'en-US',
        })
      );
      window.__agentMicStarts = 0;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
      });
      class Speech {
        continuous = true;
        interimResults = false;
        lang = '';
        onstart: (() => void) | null = null;
        onend: (() => void) | null = null;
        onresult: ((event: unknown) => void) | null = null;
        constructor() {
          window.__agentSpeech = this;
        }
        start() {
          window.__agentMicStarts++;
          this.onstart?.();
        }
        stop() {
          this.onend?.();
        }
        abort() {
          this.onend?.();
        }
      }
      Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Speech });
    });
    await page.route('**/chat/completions', async route => {
      const body = route.request().postDataJSON();
      requests.push(body);
      const prompt = body.messages[body.messages.length - 1].content.toLowerCase();
      const panelId = (await page.locator('[data-workspace-card-id]').count())
        ? await page.locator('[data-workspace-card-id]').first().getAttribute('data-workspace-card-id')
        : null;
      let response: Record<string, unknown>;
      if (prompt.includes('open'))
        response = {
          kind: 'workspaceEdit',
          summary: 'Opened Camera.',
          operations: [{ op: 'addPanel', panelType: 'camera' }],
        };
      else if (prompt.includes('move'))
        response = {
          kind: 'workspaceEdit',
          summary: 'Moved Camera.',
          operations: [{ op: 'movePanel', panelId, direction: 'left' }],
        };
      else if (prompt.includes('arrange'))
        response = {
          kind: 'workspaceEdit',
          summary: 'Arranged the room.',
          operations: [{ op: 'arrangePanels', layout: 'grid' }],
        };
      else
        response = { kind: 'workspaceEdit', summary: 'Closed Camera.', operations: [{ op: 'removePanel', panelId }] };
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(response) } }] })}\n\ndata: [DONE]\n\n`,
      });
    });
    await page.goto('/');
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await observeXrScene(page);
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
    await expect.poll(() => page.evaluate(() => window.__xrScene.renderer.xr.isPresenting)).toBe(true);
    await page.evaluate(() => {
      window.__xrDevice.controllers.left!.position.set(-0.2, 1.4, -0.4);
      window.__xrDevice.controllers.left!.updateButtonValue('x-button', 1);
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.__xrScene.uiGroup.getObjectByName('xr-wrist-menu-content')!.parent!.visible)
      )
      .toBe(true);
    await pressSurface(page, 'xr-wrist-menu-content', 'tab-ai');
    await expect
      .poll(() => page.evaluate(() => window.__xrScene.uiGroup.getObjectByName('xr-assistant')!.visible))
      .toBe(true);
    expect(await page.evaluate(() => window.__agentMicStarts)).toBe(0);
    await speak(page, 'open camera');
    await expect(page.locator('[data-workspace-card-id]')).toHaveCount(1);
    const panelId = (await page.locator('[data-workspace-card-id]').getAttribute('data-workspace-card-id'))!;
    await expect
      .poll(() =>
        page.evaluate(
          panelId => !!window.__xrScene.uiGroup.children.find(o => o.userData.placementId === panelId),
          panelId
        )
      )
      .toBe(true);
    const position = () =>
      page.evaluate(
        panelId => window.__xrScene.uiGroup.children.find(o => o.userData.placementId === panelId)!.position.toArray(),
        panelId
      );
    const before = await position();
    await typeMessage(page, 'move camera left');
    await expect.poll(async () => (await position())[0]).toBeLessThan(before[0] - 0.3);
    expect(JSON.stringify(requests[1])).toContain('Panel: Camera');
    expect(JSON.stringify(requests[1])).toContain('movePanel');
    await speak(page, 'arrange panels in a grid');
    await expect.poll(async () => (await position())[2]).toBeLessThan(-1.5);
    if (mode === 'VR') await saveXrPanelPreview(page, 'global-assistant', '/tmp/robo-boy-xr-agent.png');
    await speak(page, 'close camera');
    await expect.poll(() => requests.length).toBe(4);
    expect((requests[3].messages as Array<{ content: string }>).slice(-1)[0].content).toBe('close camera');
    await expect(page.locator('[data-workspace-card-id]')).toHaveCount(0);
    // Closing discards late recogniser output and never executes it.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__xrScene.uiGroup.getObjectByName('xr-assistant-content')!.userData.xrSurface.getItem('voice')
              .disabled
        )
      )
      .toBe(false);
    await pressXrControl(page, 'global-assistant', 'voice');
    await pressXrControl(page, 'global-assistant', 'close');
    await page.evaluate(() => {
      window.__agentSpeech.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: 'open camera' } }] });
      window.__agentSpeech.onend?.();
    });
    await page.waitForTimeout(150);
    expect(requests).toHaveLength(4);
    await page.evaluate(() => window.__xrSession.end());
    await page.getByLabel('Open Robo-Boy assistant').click();
    await expect(page.getByText('Opened Camera.', { exact: true })).toBeVisible();
    await expect(page.getByText('Moved Camera.', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
