import { createPanelPresentationRegistry } from './presentationRegistry';
import type { PanelHostToSandboxMessage } from './sandboxProtocol';
import type { PanelSurfaceFrame, PanelSurfaceInput } from './surfaceProtocol';

export class ExternalPanelSurface {
  frame: PanelSurfaceFrame | null = null;
  error = '';
  private requestId = 0;
  private pending = 0;
  private deadline = 0;
  private presented = false;
  private disposed = false;
  constructor(
    private readonly post: (message: PanelHostToSandboxMessage) => void,
    private readonly onPresent: (active: boolean) => void
  ) {}

  setPresented(active: boolean): void {
    if (this.disposed || active === this.presented) return;
    this.presented = active;
    this.onPresent(active);
    if (!active) {
      this.post({ type: 'surface-stop' });
      this.pending = 0;
      this.frame?.image?.close();
      this.frame = null;
      this.error = '';
    }
  }
  request(now: number): void {
    if (this.disposed || !this.presented) return;
    if (this.pending && now < this.deadline) return;
    if (this.pending) this.error = 'Panel preview timed out';
    this.pending = ++this.requestId;
    this.deadline = now + 5000;
    this.post({ type: 'surface-capture', requestId: this.pending });
  }
  receive(frame: PanelSurfaceFrame): void {
    if (this.disposed || !this.presented || frame.requestId !== this.pending) {
      frame.image?.close();
      return;
    }
    this.pending = 0;
    this.error = frame.error ?? '';
    this.frame?.image?.close();
    this.frame = frame;
  }
  input(message: PanelSurfaceInput): void {
    if (!this.disposed && this.presented) this.post(message);
  }
  dispose(): void {
    if (this.disposed) return;
    this.setPresented(false);
    this.disposed = true;
    this.frame?.image?.close();
    this.frame = null;
  }
}
const registry = createPanelPresentationRegistry<ExternalPanelSurface>();
export const registerExternalPanelSurface = registry.register;
export const getExternalPanelSurface = registry.get;
