import React, { useEffect, useState } from 'react';
import { GamepadProps } from '../GamepadInterface';
import CustomGamepadLayout from '../../../features/customGamepad/components/CustomGamepadLayout';
import { getGamepadLayout, GAMEPAD_STORAGE_EVENT } from '../../../features/customGamepad/gamepadStorage';

interface CustomGamepadWrapperProps extends GamepadProps {
  layoutId: string;
}

const CustomGamepadWrapper: React.FC<CustomGamepadWrapperProps> = ({ ros, layoutId }) => {
  // Authoring changes must never rebind a held physical/virtual control on a rerender.
  // Only the operator's explicit activation swaps the immutable running layout.
  const [gamepadItem, setGamepadItem] = useState(() => getGamepadLayout(layoutId));
  const [pending, setPending] = useState<ReturnType<typeof getGamepadLayout>>();
  const [activation, setActivation] = useState(0);
  useEffect(() => { setGamepadItem(getGamepadLayout(layoutId)); setPending(undefined); }, [layoutId]);
  useEffect(() => {
    const changed = () => {
      const next = getGamepadLayout(layoutId);
      if (JSON.stringify(next?.layout) !== JSON.stringify(gamepadItem?.layout)) setPending(next);
    };
    window.addEventListener(GAMEPAD_STORAGE_EVENT, changed);
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener(GAMEPAD_STORAGE_EVENT, changed); window.removeEventListener('storage', changed); };
  }, [layoutId, gamepadItem]);

  if (!gamepadItem) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--error-color, #dc3545)',
        textAlign: 'center'
      }}>
        <div>
          <h3>Layout Not Found</h3>
          <p>The gamepad layout "{layoutId}" could not be loaded.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
    {pending && <div role="status" style={{ padding: 8, fontSize: 12 }}><span>Pad authoring updated. Current control bindings are unchanged.</span><button type="button" style={{ minHeight: 44 }} onClick={() => { setGamepadItem(pending); setActivation(value => value + 1); setPending(undefined); }}>Activate updated controls</button></div>}
    <CustomGamepadLayout
      key={`${layoutId}:${activation}`}
      layout={gamepadItem.layout}
      ros={ros}
      isEditing={false}
    />
    </div>
  );
};

export default CustomGamepadWrapper;
