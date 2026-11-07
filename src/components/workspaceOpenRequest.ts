import type { CameraImageOptions } from '../utils/images/cameraImageOptions';

/** Cross-panel navigation data only; consumers retain their own live resources. */
export interface WorkspaceOpenRequest {
  panel: 'timeSeries' | 'camera' | '3d' | 'tfTree' | 'recordReplay' | 'dataExplorer';
  topic: string;
  topics?: string[];
  messageType: string;
  fieldPath?: string;
  visualizationType?: string;
  cameraOptions?: CameraImageOptions;
}
