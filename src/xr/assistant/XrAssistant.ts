import * as THREE from 'three';
import { getAssistantPresentation, type AssistantPresentation } from '../../features/assistant/presentation';
import type { AssistantProviderId } from '../../features/assistant/types';
import { SpatialKeyboard } from '../ui/SpatialKeyboard';
import { SpatialSurface, type SurfaceItem } from '../ui/SpatialSurface';
import { XR_THEME, drawText, fillRoundRect, strokeRoundRect } from '../ui/canvasKit';

const PROVIDERS: AssistantProviderId[] = ['openai', 'gemini', 'ollama', 'openai-compatible', 'anthropic'];
type AgentState = ReturnType<AssistantPresentation['read']>;

/** A native, animated view of the global conversation. No provider or command engine lives here. */
export class XrAssistant {
  readonly object = new THREE.Group();
  readonly surface = new SpatialSurface({
    width: 0.85,
    height: 0.62,
    pixelsPerMetre: 1400,
    drawBackground: (ctx, w, h) => {
      fillRoundRect(ctx, 0, 0, w, h, 28, XR_THEME.surface);
      strokeRoundRect(ctx, 2, 2, w - 4, h - 4, 27, XR_THEME.surfaceBorder, 3);
    },
  });
  readonly keyboard = new SpatialKeyboard(() => this.refresh());
  private readonly coreMaterial = new THREE.MeshBasicMaterial({ color: XR_THEME.accent, wireframe: true });
  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: XR_THEME.accent,
    transparent: true,
    opacity: 0.6,
  });
  private readonly core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 2), this.coreMaterial);
  private readonly rings = [0, 1].map(
    index => new THREE.Mesh(new THREE.TorusGeometry(0.12 + index * 0.025, 0.0025, 8, 64), this.ringMaterial)
  );
  private readonly orb = new THREE.Group();
  private signature = '';
  private lastMessages: AgentState['messages'] | null = null;
  private settingsPage = false;
  private transcriptPage: number | null = null;
  private transcriptText: string | null = null;
  private transcriptLines: string[] = [];
  private wasOpen = false;
  private disposed = false;

  constructor(
    private readonly scope: string | undefined,
    private readonly summon: (object: THREE.Object3D) => void
  ) {
    this.object.name = 'xr-assistant';
    this.object.userData = {
      xrGrabbable: true,
      allowScale: true,
      placementId: 'global-assistant',
      onGrabEnd: () => {},
      constrain: (object: THREE.Object3D) => object.scale.setScalar(THREE.MathUtils.clamp(object.scale.x, 0.5, 2)),
    };
    this.surface.mesh.name = 'xr-assistant-content';
    this.keyboard.surface.mesh.name = 'xr-assistant-keyboard';
    this.keyboard.surface.mesh.position.set(0, -0.49, 0.08);
    this.orb.position.set(0, 0.46, 0.04);
    this.orb.add(this.core, ...this.rings);
    this.orb.traverse(object => {
      object.raycast = () => {};
    });
    this.object.add(this.surface.mesh, this.orb, this.keyboard.surface.mesh);
    this.object.visible = false;
  }
  open() {
    getAssistantPresentation(this.scope)?.open();
    this.summon(this.object);
  }
  refresh() {
    this.signature = '';
  }

  update(time: number, delta: number) {
    const state = getAssistantPresentation(this.scope)?.read();
    if (!state) {
      this.object.visible = false;
      return;
    }
    this.object.visible = state.open;
    if (!state.open) {
      this.keyboard.close();
      this.wasOpen = false;
      return;
    }
    if (!this.wasOpen) {
      this.summon(this.object);
      this.wasOpen = true;
    }
    const listening = state.voice.listening;
    const colour = state.error || state.voice.error ? XR_THEME.danger : listening ? XR_THEME.success : XR_THEME.accent;
    this.coreMaterial.color.set(colour);
    this.ringMaterial.color.set(colour);
    const seconds = time / 1000;
    this.core.rotation.y += delta * (state.busy ? 1.8 : 0.25);
    this.core.rotation.z = Math.sin(seconds * 0.6) * 0.16;
    this.orb.scale.setScalar(1 + Math.sin(seconds * (listening ? 7 : 1.8)) * (listening ? 0.09 : 0.025));
    this.rings[0].rotation.set(seconds * 0.35, 0.4, 0);
    this.rings[1].rotation.set(0.5, seconds * -0.3, 0.4);
    if (state.messages.length !== this.lastMessages?.length) this.transcriptPage = null;
    // Draw only when conversation/state changes, not for each animation frame.
    const signature = JSON.stringify([
      state.open,
      state.draft,
      state.busy,
      state.progress,
      state.error,
      state.tags,
      state.voice,
      state.settings,
      this.settingsPage,
      this.transcriptPage,
      this.keyboard.isOpen,
    ]);
    if (signature === this.signature && state.messages === this.lastMessages) return;
    this.signature = signature;
    this.lastMessages = state.messages;
    this.draw(state);
  }

  private draw(state: AgentState) {
    const bridge = () => getAssistantPresentation(this.scope);
    const w = this.surface.pixelWidth,
      h = this.surface.pixelHeight;
    const items: SurfaceItem[] = [];
    const label = (
      id: string,
      text: string,
      x: number,
      y: number,
      width: number,
      colour: string = XR_THEME.text,
      size = 27
    ) => {
      items.push({
        id,
        x,
        y,
        w: width,
        h: 40,
        draw: ctx => drawText(ctx, text, x, y + 20, width, { size, color: colour }),
      });
    };
    const button = (
      id: string,
      text: string,
      x: number,
      y: number,
      width: number,
      action: () => void,
      disabled = false
    ) => {
      items.push({
        id,
        x,
        y,
        w: width,
        h: 58,
        disabled,
        draw: (ctx, item, hover) => {
          fillRoundRect(
            ctx,
            item.x,
            item.y,
            item.w,
            item.h,
            12,
            disabled ? XR_THEME.itemDisabled : hover.hover ? XR_THEME.itemHover : XR_THEME.item
          );
          drawText(ctx, text, x + width / 2, y + 29, width - 12, {
            size: 25,
            align: 'center',
            color: disabled ? XR_THEME.textDisabled : XR_THEME.text,
          });
        },
        onPress: () => {
          action();
          this.refresh();
        },
      });
    };
    const voiceBusy = state.voice.pending || state.voice.transcribing;
    const status = state.voice.pending
      ? 'Waiting for microphone…'
      : state.voice.transcribing
        ? 'Transcribing…'
        : state.voice.listening
          ? 'Listening · finish speaking to send'
          : state.busy
            ? state.progress[state.progress.length - 1] || 'Thinking…'
            : 'Speak or type · I can manage your workspace';
    label('heading', 'Robo Boy · AI', 28, 15, w - 345, XR_THEME.text, 34);
    button('settings', this.settingsPage ? 'Chat' : 'Settings', w - 292, 12, 170, () => {
      this.settingsPage = !this.settingsPage;
      this.keyboard.close();
    });
    button('close', 'Close', w - 110, 12, 90, () => {
      this.keyboard.close();
      bridge()?.close();
    });
    label('status', status, 28, 77, w - 56, state.voice.listening ? XR_THEME.success : XR_THEME.textMuted, 25);
    if (this.settingsPage) {
      const edit = (key: 'model' | 'baseUrl' | 'voiceLanguage' | 'apiKey', title: string, text: string) => {
        this.keyboard.open(title, text, value => bridge()?.configure({ [key]: value.trim() }), key === 'apiKey');
      };
      label('provider-label', 'Provider', 30, 160, 170, XR_THEME.textMuted);
      button(
        'provider',
        state.settings.provider,
        220,
        155,
        w - 250,
        () => {
          const index = PROVIDERS.indexOf(state.settings.provider);
          bridge()?.configure({ provider: PROVIDERS[(index + 1) % PROVIDERS.length] });
        },
        state.busy || state.voice.listening || voiceBusy
      );
      (['model', 'baseUrl', 'voiceLanguage', 'apiKey'] as const).forEach((key, i) => {
        const title = { model: 'Model', baseUrl: 'Base URL', voiceLanguage: 'Voice language', apiKey: 'API key' }[key];
        const value =
          key === 'apiKey'
            ? state.settings.hasApiKey
              ? 'Configured · replace'
              : 'Set key'
            : state.settings[key] || (key === 'voiceLanguage' ? 'Device language' : 'Set value');
        label(`label-${key}`, title, 30, 238 + i * 81, 180, XR_THEME.textMuted);
        button(
          `edit-${key}`,
          value,
          220,
          233 + i * 81,
          w - 250,
          () => edit(key, title, key === 'apiKey' ? '' : state.settings[key]),
          state.busy || state.voice.listening || voiceBusy
        );
      });
      button(
        'new-chat',
        'New conversation',
        28,
        570,
        w - 56,
        () => {
          this.keyboard.close();
          bridge()?.newConversation();
          this.transcriptPage = null;
          this.settingsPage = false;
        },
        state.busy || state.voice.listening || voiceBusy
      );
      label(
        'settings-note',
        'Uses your existing assistant settings. Mic starts only when pressed.',
        28,
        618,
        w - 56,
        XR_THEME.textMuted,
        23
      );
    } else {
      const text =
        state.messages
          .flatMap(message => {
            const lines = [`${message.role === 'user' ? 'You' : 'Robo Boy'}: ${message.content}`];
            if (message.contextTags?.length)
              lines.push(`Tags: ${message.contextTags.map(tag => tag.label).join(' · ')}`);
            if (message.response?.kind === 'workspaceEdit') {
              lines.push(
                ...(message.response.results ?? []).map(result => `${result.ok ? '✓' : '✗'} ${result.message}`),
                ...message.response.rejected
              );
            }
            if (message.response?.kind === 'rosAction')
              lines.push(`Review-only robot proposal: ${JSON.stringify(message.response.operation)}`);
            return [...lines, ''];
          })
          .join('\n') ||
        'Ask me to open a camera, close a panel, bring the Pad closer, or arrange the room.\n\nPress Speak, talk naturally, then finish speaking. In recording-only browsers, press Finish voice.\n\nRobot commands stay as proposals for review.';
      items.push({
        id: 'transcript',
        x: 28,
        y: 155,
        w: w - 56,
        h: 385,
        draw: ctx => {
          ctx.font = `25px ${XR_THEME.font}`;
          // Hover redraws reuse the measured transcript instead of wrapping the whole chat again.
          if (text !== this.transcriptText) {
            const lines: string[] = [];
            for (const paragraph of text.split('\n')) {
              let line = '';
              // Break long identifiers/JSON as well as words so every response is reachable.
              for (const char of paragraph) {
                if (ctx.measureText(line + char).width > w - 66) {
                  lines.push(line);
                  line = '';
                }
                line += char;
              }
              lines.push(line);
            }
            this.transcriptText = text;
            this.transcriptLines = lines;
          }
          const lines = this.transcriptLines;
          const count = Math.max(1, Math.ceil(lines.length / 11));
          const page = Math.min(count - 1, this.transcriptPage ?? count - 1);
          lines
            .slice(page * 11, page * 11 + 11)
            .forEach((line, i) => drawText(ctx, line, 28, 170 + i * 32, w - 56, { size: 25 }));
          drawText(ctx, `${page + 1} / ${count}`, w / 2, 552, 160, {
            size: 23,
            align: 'center',
            color: XR_THEME.textMuted,
          });
          this.surface.mesh.userData.transcriptPages = count;
        },
      });
      button('previous', 'Earlier', 28, 528, 160, () => {
        const last = (this.surface.mesh.userData.transcriptPages as number) - 1;
        this.transcriptPage = Math.max(0, (this.transcriptPage ?? last) - 1);
      });
      button('latest', 'Latest', w - 188, 528, 160, () => {
        this.transcriptPage = null;
      });
      label(
        'tags',
        state.tags.length ? `Context: ${state.tags.join(' · ')}` : 'Resources named clearly are tagged automatically.',
        28,
        592,
        w - 246,
        XR_THEME.textMuted,
        23
      );
      button(
        'clear-context',
        'Clear tags',
        w - 210,
        586,
        182,
        () => bridge()?.clearContext(),
        !state.tags.length || state.busy
      );
      button(
        'type',
        state.draft ? state.draft.slice(-80) : 'Type a message…',
        28,
        638,
        w - 56,
        () => {
          this.keyboard.open('Message', state.draft, text => bridge()?.setDraft(text));
        },
        state.busy || state.voice.listening || voiceBusy
      );
    }
    label('error', state.error || state.voice.error || '', 28, h - 146, w - 56, XR_THEME.danger, 24);
    button(
      'voice',
      state.voice.listening ? 'Finish voice' : 'Speak',
      28,
      h - 80,
      275,
      () => {
        if (state.voice.listening) bridge()?.stopVoice();
        else bridge()?.startVoice();
      },
      state.busy || voiceBusy || this.keyboard.isOpen
    );
    button(
      'cancel-voice',
      'Cancel voice',
      320,
      h - 80,
      260,
      () => bridge()?.cancelVoice(),
      !state.voice.listening && !voiceBusy
    );
    button(
      'send',
      state.busy ? 'Stop' : 'Send',
      w - 303,
      h - 80,
      275,
      () => {
        if (state.busy) bridge()?.stop();
        else {
          this.transcriptPage = null;
          bridge()?.send();
        }
      },
      !state.busy && (!state.draft.trim() || state.voice.listening || voiceBusy || this.keyboard.isOpen)
    );
    this.surface.setItems(items);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    getAssistantPresentation(this.scope)?.close();
    this.keyboard.dispose();
    this.surface.dispose();
    this.core.geometry.dispose();
    this.coreMaterial.dispose();
    this.ringMaterial.dispose();
    this.rings.forEach(ring => ring.geometry.dispose());
    this.object.removeFromParent();
  }
}
