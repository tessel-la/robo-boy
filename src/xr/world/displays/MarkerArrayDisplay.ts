import { MarkerArrayClient } from '../../../utils/markerArrayClient';
import type { XrDisplay, XrDisplayEnv, XrLayer } from './types';

export class MarkerArrayDisplay implements XrDisplay {
  private client: MarkerArrayClient | null;

  constructor(env: XrDisplayEnv, layer: XrLayer) {
    this.client = new MarkerArrayClient({
      ros: env.ros,
      topic: layer.topic,
      tfClient: env.provider,
      rootObject: env.root,
      path: env.meshResourcesBaseUrl,
      requestRender: () => undefined,
    });
  }

  dispose(): void {
    this.client?.dispose();
    this.client = null;
  }
}
