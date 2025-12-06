import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { Topic } from 'roslib';
import ROSLIB from 'roslib';
import { throttle } from 'lodash-es';
import './GameBoyLayout.css';
import { GamepadProps } from '../GamepadInterface';

// Constants for ROS messages
const JOY_TOPIC = '/joy'; // Standard topic for joystick data
const JOY_MSG_TYPE = 'sensor_msgs/Joy'; // Using standard Joy message
const THROTTLE_INTERVAL = 100; // Milliseconds

// Button mapping (follows joy message conventions)
// For a standard joy message with axes and buttons
const BUTTON_MAP = {
  UP: 0,
  RIGHT: 1,
  DOWN: 2,
  LEFT: 3,
  A: 4,
  B: 5,
  SELECT: 6,
  START: 7
};

// For reference: NUM_BUTTONS = Object.keys(BUTTON_MAP).length;
const NUM_BUTTONS = 8; // Updated for SELECT and START buttons
const NUM_AXES = 0; // Our implementation doesn't use axes, only buttons

const GameBoyLayout: React.FC<GamepadProps> = ({ ros }) => {
  // Topic reference
  const joyTopic = useRef<Topic | null>(null);

  // Track button states - Array of 0/1 for released/pressed
  const [buttonStates, setButtonStates] = useState<number[]>(Array(NUM_BUTTONS).fill(0));

  // Keep track of last sent state to avoid unnecessary messages
  const lastSentState = useRef<number[]>([...buttonStates]);

  // Function to publish Joy message
  const publishJoy = useCallback((buttons: number[]) => {
    if (!joyTopic.current) return;

    const joyMsg = new ROSLIB.Message({
      header: {
        stamp: { secs: 0, nsecs: 0 },
        frame_id: ''
      },
      axes: Array(NUM_AXES).fill(0.0), // No axes used
      buttons: buttons
    });

    // console.log('Publishing GameBoy Joy:', joyMsg);
    joyTopic.current.publish(joyMsg);
    lastSentState.current = [...buttons]; // Update last sent state
  }, []);

  // Throttled version of the publish function
  const publishJoyThrottled = useCallback(
    throttle(publishJoy, THROTTLE_INTERVAL, { leading: true, trailing: true }),
    [publishJoy]
  );

  // Initialize the topic publisher
  useEffect(() => {
    joyTopic.current = new ROSLIB.Topic({
      ros: ros,
      name: JOY_TOPIC,
      messageType: JOY_MSG_TYPE,
    });
    joyTopic.current.advertise();
    console.log(`Advertised ${JOY_TOPIC} for GameBoyLayout`);

    return () => {
      // If any buttons are pressed, send a message with all released
      if (lastSentState.current.some(b => b !== 0)) {
        publishJoyThrottled.cancel(); // Cancel any pending throttled calls
        publishJoy(Array(NUM_BUTTONS).fill(0)); // Send immediate "all released" message
      }

      joyTopic.current?.unadvertise();
      console.log(`Unadvertised ${JOY_TOPIC} for GameBoyLayout`);
      joyTopic.current = null;
    };
  }, [ros, publishJoy, publishJoyThrottled]);

  // Handler for button press/release
  const handleButtonAction = (buttonIndex: number, isPressed: boolean) => {
    setButtonStates(prevStates => {
      const newStates = [...prevStates];
      newStates[buttonIndex] = isPressed ? 1 : 0;
      // Only publish if state actually changed
      if (newStates[buttonIndex] !== lastSentState.current[buttonIndex]) {
        publishJoyThrottled(newStates);
      }
      return newStates;
    });
  };

  // Individual button press handlers
  const handleUp = (isPressed: boolean) => handleButtonAction(BUTTON_MAP.UP, isPressed);
  const handleRight = (isPressed: boolean) => handleButtonAction(BUTTON_MAP.RIGHT, isPressed);
  const handleDown = (isPressed: boolean) => handleButtonAction(BUTTON_MAP.DOWN, isPressed);
  const handleLeft = (isPressed: boolean) => handleButtonAction(BUTTON_MAP.LEFT, isPressed);
  const handleA = (isPressed: boolean) => handleButtonAction(BUTTON_MAP.A, isPressed);
  const handleB = (isPressed: boolean) => handleButtonAction(BUTTON_MAP.B, isPressed);

  // Add handlers for START and SELECT (kept for potential future use)
  const _handleSelect = (isPressed: boolean) => handleButtonAction(BUTTON_MAP.SELECT, isPressed);
  const _handleStart = (isPressed: boolean) => handleButtonAction(BUTTON_MAP.START, isPressed);

  return (
    <div className="gameboy-layout">
      <div className="gameboy-outer">
        <div className="gameboy-controls">
          {/* D-pad */}
          <div className="dpad">
            <button
              className={`dpad-up ${buttonStates[BUTTON_MAP.UP] ? 'active' : ''}`}
              onPointerDown={() => handleUp(true)}
              onPointerUp={() => handleUp(false)}
              onPointerLeave={() => handleUp(false)}
            />
            <button
              className={`dpad-right ${buttonStates[BUTTON_MAP.RIGHT] ? 'active' : ''}`}
              onPointerDown={() => handleRight(true)}
              onPointerUp={() => handleRight(false)}
              onPointerLeave={() => handleRight(false)}
            />
            <button
              className={`dpad-down ${buttonStates[BUTTON_MAP.DOWN] ? 'active' : ''}`}
              onPointerDown={() => handleDown(true)}
              onPointerUp={() => handleDown(false)}
              onPointerLeave={() => handleDown(false)}
            />
            <button
              className={`dpad-left ${buttonStates[BUTTON_MAP.LEFT] ? 'active' : ''}`}
              onPointerDown={() => handleLeft(true)}
              onPointerUp={() => handleLeft(false)}
              onPointerLeave={() => handleLeft(false)}
            />
            <div className="dpad-center" />
          </div>

          {/* A/B buttons */}
          <div className="action-buttons">
            <button
              className={`button b ${buttonStates[BUTTON_MAP.B] ? 'active' : ''}`}
              onPointerDown={() => handleB(true)}
              onPointerUp={() => handleB(false)}
              onPointerLeave={() => handleB(false)}
            >
              B
            </button>
            <button
              className={`button a ${buttonStates[BUTTON_MAP.A] ? 'active' : ''}`}
              onPointerDown={() => handleA(true)}
              onPointerUp={() => handleA(false)}
              onPointerLeave={() => handleA(false)}
            >
              A
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GameBoyLayout; 