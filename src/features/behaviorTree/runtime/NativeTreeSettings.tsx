import React from 'react';
import ContainedSelect from '../components/ContainedSelect';
import type { NativeTreeController } from './useNativeTreeController';
import type { RuntimeState } from './types';
import { treeFormats } from './xml';
import './NativeTreeSettings.css';

export function NativeTreeStatus({ controller, state }: { controller: NativeTreeController; state: RuntimeState }) {
  const format = treeFormats.find(format => format.id === controller.document?.runtime);
  const descriptor = state.runtimes.find(runtime => runtime.id === format?.id);
  let label = 'Ready';
  let explanation = 'Run sends this tree to the ROS host and starts execution.';
  if (!state.connected) {
    label = 'Disconnected';
    explanation = 'Connect to ROS to run this tree.';
  } else if (descriptor?.enabled === false) {
    label = 'Engine off';
    explanation = `Enable ${format?.label || 'this engine'} in the tree menu to run this tree.`;
  } else if (!descriptor?.available) {
    label = 'Unavailable';
    explanation = descriptor?.reason || 'Check engine availability in the tree menu.';
  } else if (!controller.compatible) {
    label = 'Select engine';
    explanation = `Select ${format?.label || 'an engine'} for this tree.`;
  } else if (state.session?.state === 'running' && !controller.session) {
    label = 'Host busy';
    explanation = 'A different tree is running on ROS. Open host tree from the menu to inspect or control it.';
  } else if (controller.preview.error) {
    label = 'Incomplete';
    explanation = controller.preview.error;
  } else if (controller.busy) {
    label = 'Working…';
    explanation = 'Waiting for the ROS host.';
  } else if (controller.session) {
    const session = controller.session;
    label =
      session.state === 'completed'
        ? session.result === 'success'
          ? 'Succeeded'
          : 'Failed'
        : { loaded: 'Ready', running: 'Running', stopped: 'Stopped', cancelled: 'Cancelled', error: 'Error' }[
            session.state
          ];
    if (session.state !== 'loaded') explanation = session.error || `${format?.label}: ${label}.`;
  }
  return (
    <span
      className="bt-runtime-chip"
      role="status"
      title={`${explanation}${descriptor?.version ? ` ${format?.label} ${descriptor.version}.` : ''}`}
      data-testid="bt-runtime-state"
      data-state={controller.session?.state}
      data-result={controller.session?.result || undefined}
    >
      {label}
    </span>
  );
}

export default function NativeTreeSettings({ controller }: { controller: NativeTreeController }) {
  return (
    <div className="bt-menu-section bt-native-tree-settings">
      <div className="bt-main-tree-field" role="group" aria-label="Execution tree">
        <span className="bt-menu-label">Tree to run</span>
        <ContainedSelect
          ariaLabel="Main XML tree"
          value={controller.document?.mainTreeId || controller.preview.mainTreeId || ''}
          options={[
            { value: '', label: 'Choose a tree', disabled: true },
            ...controller.preview.trees.map(tree => ({
              value: tree.getAttribute('ID')!,
              label: tree.getAttribute('ID')!,
            })),
          ]}
          disabled={controller.locked || !controller.preview.trees.length}
          onChange={mainTreeId => controller.changeDocument({ mainTreeId })}
        />
      </div>
      <p className="bt-menu-hint">Run loads and starts this tree on ROS. Browsing subtrees keeps this choice.</p>
      <button
        className="bt-menu-action-btn"
        disabled={controller.locked || !controller.ready || !!controller.preview.error}
        onClick={controller.validate}
      >
        Check tree
      </button>
      <p className="bt-menu-hint">Validate on ROS without running.</p>
      {controller.notice && (
        <p className="bt-menu-hint" role="status">
          {controller.notice}
        </p>
      )}
      {controller.differentHostTree && (
        <div className="bt-host-tree">
          <p className="bt-menu-hint">
            A different tree is on the ROS host. Open it to inspect or control it. Your current tree will be replaced.
          </p>
          <button className="bt-menu-action-btn" disabled={controller.busy} onClick={controller.showHost}>
            Open host tree
          </button>
        </div>
      )}
    </div>
  );
}
