import React from 'react';
import { FiActivity, FiAlertCircle, FiAlertTriangle, FiFileText, FiImage, FiSlash } from 'react-icons/fi';
import { useExecutionSummary } from '../../execution/executionContext';
import './ExecutionDetails.css';

/**
 * The small chip in an action or service node's header that says its latest execution has something to look at:
 * feedback, a result, an image, or what went wrong. It shows nothing otherwise, so the tree stays clean.
 */
const ExecutionChip: React.FC<{ nodeId: string; nodeLabel: string }> = ({ nodeId, nodeLabel }) => {
  const { summary, context } = useExecutionSummary(nodeId);
  if (!summary?.hasDetails || !context) return null;

  const Icon = summary.tone === 'error'
    ? FiAlertTriangle
    : summary.tone === 'warning'
      ? FiAlertCircle
      : summary.hasImage
        ? FiImage
        : summary.tone === 'running'
          ? FiActivity
          : summary.tone === 'neutral'
            ? FiSlash
            : FiFileText;
  const isOpen = context.openNodeId === nodeId;
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <button
      type="button"
      className={`bt-exec-chip nodrag nopan tone-${summary.tone} ${isOpen ? 'is-open' : ''}`}
      title={`${summary.label} · show details`}
      aria-label={`${nodeLabel}: ${summary.label}. Show execution details`}
      aria-pressed={isOpen}
      onClick={event => {
        stop(event);
        context.open(nodeId);
      }}
      onDoubleClick={stop}
      onPointerDown={stop}
      onMouseDown={stop}
    >
      <Icon aria-hidden="true" />
    </button>
  );
};

export default React.memo(ExecutionChip);
