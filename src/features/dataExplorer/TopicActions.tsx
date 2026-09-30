import { FiBox, FiCamera, FiDisc, FiEye, FiGitBranch, FiHeart } from 'react-icons/fi';
import type { ExplorerOpenRequest } from './DataExplorerPanel';
import type { Resource } from './types';

const VISUAL_TYPES: Record<string, string> = {
  PointCloud2: 'pointcloud',
  LaserScan: 'laserscan',
  CameraInfo: 'camerainfo',
  // PoseStamped is left out for now: its 3D arrow does not show the pose correctly yet.
  MarkerArray: 'markerarray',
};

/** Which panel a topic's type opens in, if any: images in Camera, TF in the TF tree, supported types in 3D. */
export function viewFor(type: string): { panel: ExplorerOpenRequest['panel']; visualizationType?: string } | null {
  if (/\/(CompressedImage|Image)$/.test(type)) return { panel: 'camera' };
  if (type.endsWith('/TFMessage')) return { panel: 'tfTree' };
  const visualizationType = VISUAL_TYPES[type.split('/').pop() ?? ''];
  return visualizationType ? { panel: '3d', visualizationType } : null;
}

const VIEW_LABELS: Partial<Record<ExplorerOpenRequest['panel'], string>> = {
  camera: 'Open in Camera',
  tfTree: 'Open in TF tree',
  '3d': 'Open in 3D',
};

interface Props {
  resource: Resource;
  /** Inspecting a recording: only opening a view makes sense (no live probes, recording or rules). */
  replay: boolean;
  /** Visualizations follow an open recording while the Explorer inspects the live robot. */
  viewsDisabled: boolean;
  watched: boolean;
  hasRule: boolean;
  onWatch: () => void;
  onOpen: (panel: ExplorerOpenRequest['panel'], visualizationType?: string) => void;
  onRule: () => void;
}

/**
 * Per-topic actions as icons: watch, record, rule, then open-in-a-view last when the type has one.
 * The list centres them under the Actions heading.
 */
export default function TopicActions({
  resource,
  replay,
  viewsDisabled,
  watched,
  hasRule,
  onWatch,
  onOpen,
  onRule,
}: Props) {
  const name = resource.name;
  const view = resource.types.length === 1 ? viewFor(resource.types[0]) : null;
  const viewLabel = view && VIEW_LABELS[view.panel];
  const ViewIcon = view?.panel === 'camera' ? FiCamera : view?.panel === 'tfTree' ? FiGitBranch : FiBox;
  return (
    <div className="de-topic-actions">
      {!replay && (
        <button
          aria-pressed={watched}
          aria-label={`${watched ? 'Stop watching' : 'Watch traffic of'} ${name}`}
          title={watched ? 'Stop watching traffic' : 'Watch traffic'}
          onClick={onWatch}
        >
          <FiEye />
        </button>
      )}
      {!replay && (
        <>
          <button
            aria-label={`Record ${name}`}
            title="Record this topic (opens recording settings)"
            onClick={() => onOpen('recordReplay')}
          >
            <FiDisc />
          </button>
          <button
            aria-pressed={hasRule}
            aria-label={`${hasRule ? 'Show health rule for' : 'Add health rule for'} ${name}`}
            title={hasRule ? 'Health rule set: show it' : 'Add health rule'}
            onClick={onRule}
          >
            <FiHeart />
          </button>
        </>
      )}
      {view && viewLabel && (
        <button
          aria-label={`${viewLabel}: ${name}`}
          title={viewsDisabled ? 'Visualizations follow the open recording' : viewLabel}
          disabled={viewsDisabled}
          onClick={() => onOpen(view.panel, view.visualizationType)}
        >
          <ViewIcon />
        </button>
      )}
    </div>
  );
}
