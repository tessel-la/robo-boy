import React, { useId } from 'react';
import type { NativeTreeController } from './useNativeTreeController';
export default function NativeTreeSettings({ controller }: { controller: NativeTreeController }) {
  const mainTreeId = useId();
  return (
    <div className="bt-menu-section">
      <label className="bt-menu-label" htmlFor={mainTreeId}>
        Main tree
      </label>
      <select
        id={mainTreeId}
        aria-label="Main XML tree"
        value={controller.document?.mainTreeId || controller.preview.mainTreeId || ''}
        disabled={controller.locked}
        onChange={event => controller.changeDocument({ mainTreeId: event.target.value })}
      >
        <option value="" disabled>
          Choose main tree
        </option>
        {controller.preview.trees.map(tree => (
          <option key={tree.getAttribute('ID')} value={tree.getAttribute('ID')!}>
            {tree.getAttribute('ID')}
          </option>
        ))}
      </select>
      <div className="bt-menu-actions">
        <button
          className="bt-menu-action-btn"
          disabled={controller.locked || !controller.ready || !!controller.preview.error}
          onClick={controller.validate}
        >
          Validate
        </button>
        <button
          className="bt-menu-action-btn"
          disabled={controller.locked || !controller.ready || !!controller.preview.error}
          onClick={controller.load}
        >
          Load on host
        </button>
      </div>
    </div>
  );
}
