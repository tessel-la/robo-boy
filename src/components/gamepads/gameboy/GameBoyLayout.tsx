import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Ros, Topic } from 'roslib';
import ROSLIB from 'roslib';
import './GameBoyLayout.css'; // Import the renamed CSS file

interface GameBoyLayoutProps {
  ros: Ros;
}

// Constants
const JOY_TOPIC = '/joy';
const JOY_MSG_TYPE = 'sensor_msgs/Joy';
const NUM_BUTTONS = 6; // D-pad (4) + B (1) + A (1)

// Button index mapping
const BUTTON_MAP = {
  UP: 0,
  DOWN: 1,
  LEFT: 2,
  RIGHT: 3,
  B: 4,
  A: 5,
};

const GameBoyLayout: React.FC<GameBoyLayoutProps> = ({ ros }) => {
  const joyTopic = useRef<Topic | null>(null);
  const [buttons, setButtons] = useState<number[]>(Array(NUM_BUTTONS).fill(0));

  // Function to publish Joy message - Define before useEffect that depends on it
  const publishJoy = useCallback((currentButtons: number[]) => {
    if (!joyTopic.current) return;
    const joyMsg = new ROSLIB.Message({
      header: { stamp: { secs: 0, nsecs: 0 }, frame_id: '' },
      axes: [], // No axes for this panel
      buttons: currentButtons,
    });
    // console.log('Publishing GameBoy Joy:', joyMsg);
    joyTopic.current.publish(joyMsg);
  }, []); // Empty dependency array because it doesn't depend on external state/props

  // Initialize publisher
  useEffect(() => {
    joyTopic.current = new ROSLIB.Topic({
      ros: ros,
      name: JOY_TOPIC,
      messageType: JOY_MSG_TYPE,
    });
    joyTopic.current.advertise();
    console.log(`Advertised ${JOY_TOPIC} for GameBoyLayout`); // Updated log

    return () => {
      // Ensure all buttons are released on unmount
      publishJoy(Array(NUM_BUTTONS).fill(0));
      joyTopic.current?.unadvertise();
      console.log(`Unadvertised ${JOY_TOPIC} for GameBoyLayout`); // Updated log
      joyTopic.current = null;
    };
  }, [ros, publishJoy]); // publishJoy is stable due to useCallback

  // Handlers using Pointer Events for touch/mouse compatibility
  const handleButtonDown = useCallback((buttonIndex: number) => {
    setButtons((prev: number[]) => { // Explicit type for prev
      // Check if already pressed to avoid redundant updates/publishes
      if (prev[buttonIndex] === 1) return prev;
      const newButtons = [...prev];
      newButtons[buttonIndex] = 1;
      publishJoy(newButtons); // Publish immediately on press
      return newButtons;
    });
  }, [publishJoy]); // Added dependency

  const handleButtonUp = useCallback((buttonIndex: number) => {
    setButtons((prev: number[]) => { // Explicit type for prev
      // Check if already released
      if (prev[buttonIndex] === 0) return prev;
      const newButtons = [...prev];
      newButtons[buttonIndex] = 0;
      publishJoy(newButtons); // Publish immediately on release
      return newButtons;
    });
  }, [publishJoy]); // Added dependency

  // Handle pointer leaving the button area while pressed
  const handlePointerLeave = useCallback((buttonIndex: number) => {
     setButtons((prev: number[]) => { // Explicit type for prev
       // Only publish release if the button was actually pressed
       if (prev[buttonIndex] === 1) {
         const newButtons = [...prev];
         newButtons[buttonIndex] = 0;
         publishJoy(newButtons);
         return newButtons;
       }
       return prev;
     });
  }, [publishJoy]); // Added dependency

  return (
    <div className="gameboy-layout"> {/* Renamed class */}
      <div className="d-pad">
        <button
          className="d-pad-button up"
          onPointerDown={() => handleButtonDown(BUTTON_MAP.UP)}
          onPointerUp={() => handleButtonUp(BUTTON_MAP.UP)}
          onPointerLeave={() => handlePointerLeave(BUTTON_MAP.UP)} // Release if pointer leaves while pressed
        >
          ▲
        </button>
        <button
          className="d-pad-button left"
          onPointerDown={() => handleButtonDown(BUTTON_MAP.LEFT)}
          onPointerUp={() => handleButtonUp(BUTTON_MAP.LEFT)}
          onPointerLeave={() => handlePointerLeave(BUTTON_MAP.LEFT)}
        >
          ◀︎
        </button>
        {/* Placeholder for center (optional) */}
        <div className="d-pad-center"></div> 
        <button
          className="d-pad-button right"
          onPointerDown={() => handleButtonDown(BUTTON_MAP.RIGHT)}
          onPointerUp={() => handleButtonUp(BUTTON_MAP.RIGHT)}
          onPointerLeave={() => handlePointerLeave(BUTTON_MAP.RIGHT)}
        >
          ▶︎
        </button>
        <button
          className="d-pad-button down"
          onPointerDown={() => handleButtonDown(BUTTON_MAP.DOWN)}
          onPointerUp={() => handleButtonUp(BUTTON_MAP.DOWN)}
          onPointerLeave={() => handlePointerLeave(BUTTON_MAP.DOWN)}
        >
          ▼
        </button>
      </div>

      <div className="ab-buttons">
        <button
          className="ab-button b"
          onPointerDown={() => handleButtonDown(BUTTON_MAP.B)}
          onPointerUp={() => handleButtonUp(BUTTON_MAP.B)}
          onPointerLeave={() => handlePointerLeave(BUTTON_MAP.B)}
        >
          B
        </button>
        <button
          className="ab-button a"
          onPointerDown={() => handleButtonDown(BUTTON_MAP.A)}
          onPointerUp={() => handleButtonUp(BUTTON_MAP.A)}
          onPointerLeave={() => handlePointerLeave(BUTTON_MAP.A)}
        >
          A
        </button>
      </div>
    </div>
  );
};

export default GameBoyLayout; // Renamed export 