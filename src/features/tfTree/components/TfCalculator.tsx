import React, { useMemo } from 'react';
import { FaCrosshairs, FaExchangeAlt, FaTimes } from 'react-icons/fa';

import TreePanelSearch, { type TreePanelSearchResult } from '../../treePanel/components/TreePanelSearch';
import { calculateTfBetweenFrames, quaternionToRotationMatrix } from '../tfTreeCalculator';
import { normalizeFrameId, quaternionToEulerRpy, type TfTreeState } from '../tfTreeModel';

type CalculatorFrame = 'source' | 'target';

interface TfCalculatorProps {
  state: TfTreeState;
  sourceFrame: string;
  targetFrame: string;
  onSourceFrameChange: (frame: string) => void;
  onTargetFrameChange: (frame: string) => void;
  onPickFrame: (frame: CalculatorFrame) => void;
  onClose: () => void;
}

const formatVector = (values: number[], digits = 4) => values.map(value => value.toFixed(digits)).join(', ');

const TfCalculator: React.FC<TfCalculatorProps> = ({
  state,
  sourceFrame,
  targetFrame,
  onSourceFrameChange,
  onTargetFrameChange,
  onPickFrame,
  onClose,
}) => {
  const frames = useMemo(() => [...state.knownFrames].sort(), [state.knownFrames]);
  const makeResults = (query: string): TreePanelSearchResult<string>[] => {
    const match = query.trim().toLowerCase();
    return frames
      .filter(frame => !match || frame.toLowerCase().includes(match))
      .slice(0, 30)
      .map(frame => ({ id: frame, label: frame, value: frame }));
  };
  const normalizedSource = normalizeFrameId(sourceFrame);
  const normalizedTarget = normalizeFrameId(targetFrame);
  const sourceValid = Boolean(normalizedSource && state.knownFrames.has(normalizedSource));
  const targetValid = Boolean(normalizedTarget && state.knownFrames.has(normalizedTarget));
  const result = useMemo(
    () => calculateTfBetweenFrames(state, sourceFrame, targetFrame),
    [sourceFrame, state, targetFrame]
  );
  const euler = quaternionToEulerRpy(result?.rotation ?? null);
  const rotationMatrix = result ? quaternionToRotationMatrix(result.rotation) : null;
  const hasBothFrames = sourceFrame.trim().length > 0 && targetFrame.trim().length > 0;

  return (
    <aside className="tf-calculator" aria-label="TF calculator" data-testid="tf-calculator">
      <header className="tf-calculator-heading">
        <div>
          <span>Frame transform</span>
          <h2>TF Calculator</h2>
        </div>
        <button type="button" onClick={onClose} title="Close calculator" aria-label="Close TF calculator">
          <FaTimes aria-hidden="true" />
        </button>
      </header>

      <div className="tf-calculator-fields">
        <div className="tf-calculator-field">
          <label htmlFor="tf-calculator-source">Source frame</label>
          <div className="tf-calculator-input-row">
            <TreePanelSearch
              className="tf-calculator-combobox"
              query={sourceFrame}
              onQueryChange={onSourceFrameChange}
              results={makeResults(sourceFrame)}
              onSelect={onSourceFrameChange}
              placeholder="Select source frame"
              ariaLabel="TF calculator source frame"
              emptyText="No matching frames"
              disabled={frames.length === 0}
              listboxId="tf-calculator-source-results"
              inputId="tf-calculator-source"
              testId="tf-calculator-source"
            />
            <button
              type="button"
              className="tf-calculator-pick"
              onClick={() => onPickFrame('source')}
              title="Pick source frame from tree"
              aria-label="Pick source frame from tree"
            >
              <FaCrosshairs aria-hidden="true" />
            </button>
          </div>
        </div>

        <button
          type="button"
          className="tf-calculator-swap"
          onClick={() => {
            onSourceFrameChange(targetFrame);
            onTargetFrameChange(sourceFrame);
          }}
          title="Swap source and target frames"
          aria-label="Swap source and target frames"
        >
          <FaExchangeAlt aria-hidden="true" />
        </button>

        <div className="tf-calculator-field">
          <label htmlFor="tf-calculator-target">Target frame</label>
          <div className="tf-calculator-input-row">
            <TreePanelSearch
              className="tf-calculator-combobox"
              query={targetFrame}
              onQueryChange={onTargetFrameChange}
              results={makeResults(targetFrame)}
              onSelect={onTargetFrameChange}
              placeholder="Select target frame"
              ariaLabel="TF calculator target frame"
              emptyText="No matching frames"
              disabled={frames.length === 0}
              listboxId="tf-calculator-target-results"
              inputId="tf-calculator-target"
              testId="tf-calculator-target"
            />
            <button
              type="button"
              className="tf-calculator-pick"
              onClick={() => onPickFrame('target')}
              title="Pick target frame from tree"
              aria-label="Pick target frame from tree"
            >
              <FaCrosshairs aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className="tf-calculator-result" aria-live="polite">
        {!hasBothFrames && <p className="tf-calculator-empty">Choose two frames to calculate their transform.</p>}
        {hasBothFrames && (!sourceValid || !targetValid) && (
          <p className="tf-calculator-empty">Select valid frames from the current TF tree.</p>
        )}
        {sourceValid && targetValid && !result && (
          <p className="tf-calculator-empty">No connected TF path exists between these frames.</p>
        )}
        {result && euler && rotationMatrix && (
          <>
            <div className="tf-calculator-result-title">
              <strong>{result.targetFrame}</strong>
              <span>relative to {result.sourceFrame}</span>
            </div>
            <dl>
              <dt>Translation XYZ (m)</dt>
              <dd>{formatVector([result.translation.x, result.translation.y, result.translation.z])}</dd>
              <dt>Distance (m)</dt>
              <dd>{Math.hypot(result.translation.x, result.translation.y, result.translation.z).toFixed(4)}</dd>
              <dt>Quaternion XYZW</dt>
              <dd>{formatVector([result.rotation.x, result.rotation.y, result.rotation.z, result.rotation.w])}</dd>
              <dt>Euler RPY (rad)</dt>
              <dd>{formatVector([euler.roll, euler.pitch, euler.yaw])}</dd>
              <dt>Euler RPY (deg)</dt>
              <dd>
                {formatVector(
                  [euler.roll, euler.pitch, euler.yaw].map(value => (value * 180) / Math.PI),
                  2
                )}
              </dd>
              <dt>Rotation matrix</dt>
              <dd className="tf-calculator-matrix">
                {rotationMatrix.map((row, index) => (
                  <span key={index}>{formatVector(row)}</span>
                ))}
              </dd>
              <dt>TF path</dt>
              <dd>{result.path.join(' - ')}</dd>
            </dl>
          </>
        )}
      </div>
    </aside>
  );
};

export default TfCalculator;
