/** @jsxImportSource react */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Topic } from 'roslib';
import ROSLIB from 'roslib';
import { Joystick } from 'react-joystick-component';
import type { IJoystickUpdateEvent } from '../../../types/joystick';
import { throttle } from 'lodash-es';
import './DroneGamepadLayout.css';
import { GamepadProps } from '../GamepadInterface';

// SpeedMode enum
enum SpeedMode { Slow, Normal, Fast }

// SCALING FACTORS
const SPEED_FACTORS = {
  [SpeedMode.Slow]: 0.5,
  [SpeedMode.Normal]: 1.0,
  [SpeedMode.Fast]: 1.5,
};

// --- SVG Icons for Speed Controls ---
const IconTurtle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2C7.58 2 4 5.58 4 10c0 2.05.78 3.92 2.08 5.34L4 18h16l-2.08-2.66A7.932 7.932 0 0 0 20 10c0-4.42-3.58-8-8-8z" />
    <path d="M2.5 9.5c-.67 0-1.28.17-1.78.45" />
    <path d="M21.5 9.5c.67 0 1.28.17 1.78.45" />
    <path d="M4.22 18.78L3 20l1.34-1.34" />
    <path d="M19.78 18.78L21 20l-1.34-1.34" />
    <path d="M9 10v-.5A2.5 2.5 0 0 1 11.5 7h1A2.5 2.5 0 0 1 15 9.5V10" />
  </svg>
);

const IconNormalSpeed = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
  </svg>
);

const IconTurbo = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 19.5L11 14.5L6.5 12.5L8 7.5L12 2.5L16 7.5L17.5 12.5L13 14.5L14.5 19.5Z" />
    <line x1="12" y1="2.5" x2="12" y2="6.5" />
    <path d="M7.5 16.5 C7.5 18.5 10 20.5 12 21.5 C14 20.5 16.5 18.5 16.5 16.5" />
  </svg>
);
// --- End SVG Speed Icons ---

// Constants for sensor_msgs/Joy
const JOY_TOPIC = '/joy';
const JOY_MSG_TYPE = 'sensor_msgs/Joy';
const THROTTLE_INTERVAL = 100; // Milliseconds 
const MAX_JOYSTICK_VALUE = 255.0; // Max output value (0-255 range)
const NUM_AXES = 4; // Number of axes
const _NUM_BUTTONS = 2; // Two buttons: takeoff and landing
const JOYSTICK_DEADZONE = 0.01; // Small deadzone to filter noise

// --- SVG Icons for Takeoff/Land Buttons ---
const IconArrowUp = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const IconArrowDown = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  </svg>
);
// --- End SVG Takeoff/Land Icons ---

const DroneGamepadLayout: React.FC<GamepadProps> = ({ ros }) => {
  const joyTopic = useRef<Topic | null>(null);
  const [axes, setAxes] = useState<number[]>(Array(NUM_AXES).fill(0.0));
  const [buttons, setButtons] = useState<number[]>([0, 0]);
  const lastSentAxes = useRef<number[]>([...axes]);
  const lastSentButtons = useRef<number[]>([...buttons]);
  const [currentSpeedMode, setCurrentSpeedMode] = useState<SpeedMode>(SpeedMode.Normal);
  // --- Add state for joystick colors ---
  const [baseJoystickColor, setBaseJoystickColor] = useState<string>('#6c757d');
  const [stickJoystickColor, setStickJoystickColor] = useState<string>('#32CD32');

  const getThemeColor = (variableName: string) => {
    return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  };

  // --- Make joystick colors reactive to theme changes ---
  useEffect(() => {
    const updateJoystickColors = () => {
      const baseColor = getThemeColor('--secondary-color') || '#6c757d';
      const stickColor = getThemeColor('--primary-color') || '#32CD32';
      setBaseJoystickColor(baseColor);
      setStickJoystickColor(stickColor);
    };

    // Update colors initially
    updateJoystickColors();

    // Watch for theme changes by observing data-theme attribute changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          updateJoystickColors();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    return () => observer.disconnect();
  }, []);
  // --- End of reactive joystick colors ---

  const handleSetSpeedMode = (mode: SpeedMode) => {
    setCurrentSpeedMode(mode);
  };

  const mapJoystickToOutput = useCallback((value: number): number => {
    if (Math.abs(value) < JOYSTICK_DEADZONE) return 0;
    const adjustedValue = Math.sign(value) * (Math.abs(value) - JOYSTICK_DEADZONE) / (1.0 - JOYSTICK_DEADZONE);
    const baseOutput = Math.sign(adjustedValue) * Math.abs(adjustedValue) * MAX_JOYSTICK_VALUE;
    return baseOutput * SPEED_FACTORS[currentSpeedMode]; // Apply speed scaling
  }, [currentSpeedMode]);

  const publishJoy = useCallback((currentAxes: number[], currentButtons: number[]) => {
    if (!joyTopic.current) return;
    if (currentAxes.some(v => v !== 0) || currentButtons.some(b => b !== 0)) {
      // console.log('Publishing joy message:', { axes: currentAxes, buttons: currentButtons, speed: SpeedMode[currentSpeedMode] });
    }
    const joyMsg = new ROSLIB.Message({
      header: { stamp: { secs: 0, nsecs: 0 }, frame_id: '' },
      axes: currentAxes,
      buttons: currentButtons
    });
    joyTopic.current.publish(joyMsg);
    lastSentAxes.current = [...currentAxes];
    lastSentButtons.current = [...currentButtons];
  }, []);

  const publishJoyThrottled = useCallback(
    throttle(publishJoy, THROTTLE_INTERVAL, { leading: true, trailing: true }),
    [publishJoy]
  );

  useEffect(() => {
    joyTopic.current = new ROSLIB.Topic({ ros: ros, name: JOY_TOPIC, messageType: JOY_MSG_TYPE });
    joyTopic.current.advertise();
    // console.log(`Advertised ${JOY_TOPIC} for DroneGamepadLayout`);
    return () => {
      if (lastSentAxes.current.some((a: number) => a !== 0) || lastSentButtons.current.some((b: number) => b !== 0)) {
        publishJoyThrottled.cancel();
        publishJoy(Array(NUM_AXES).fill(0.0), [0, 0]);
      }
      joyTopic.current?.unadvertise();
      // console.log(`Unadvertised ${JOY_TOPIC} for DroneGamepadLayout`);
      joyTopic.current = null;
    };
  }, [ros, publishJoyThrottled, publishJoy]);

  const handleMoveLeft = useCallback((event: IJoystickUpdateEvent) => {
    if (event.x === null || event.y === null) return;
    const rawX = (event.x / 50);
    const rawY = (event.y / 50);
    const newAxes = [...lastSentAxes.current];
    newAxes[0] = mapJoystickToOutput(rawX);
    newAxes[1] = mapJoystickToOutput(rawY);
    setAxes(newAxes);
    publishJoyThrottled(newAxes, buttons);
  }, [publishJoyThrottled, buttons, mapJoystickToOutput]);

  const handleStopLeft = useCallback(() => {
    publishJoyThrottled.cancel();
    const newAxes = [...lastSentAxes.current];
    newAxes[0] = 0;
    newAxes[1] = 0;
    setAxes(newAxes);
    publishJoy(newAxes, buttons);
  }, [publishJoy, publishJoyThrottled, buttons]);

  const handleMoveRight = useCallback((event: IJoystickUpdateEvent) => {
    if (event.x === null || event.y === null) return;
    const rawX = (event.x / 50);
    const rawY = (event.y / 50);
    const newAxes = [...lastSentAxes.current];
    newAxes[2] = mapJoystickToOutput(rawX);
    newAxes[3] = mapJoystickToOutput(rawY);
    setAxes(newAxes);
    publishJoyThrottled(newAxes, buttons);
  }, [publishJoyThrottled, buttons, mapJoystickToOutput]);

  const handleStopRight = useCallback(() => {
    publishJoyThrottled.cancel();
    const newAxes = [...lastSentAxes.current];
    newAxes[2] = 0;
    newAxes[3] = 0;
    setAxes(newAxes);
    publishJoy(newAxes, buttons);
  }, [publishJoy, publishJoyThrottled, buttons]);

  const handleTakeOffPress = useCallback(() => {
    const newButtons = [1, 0];
    setButtons(newButtons);
    publishJoy(lastSentAxes.current, newButtons);
  }, [publishJoy]);

  const handleLandPress = useCallback(() => {
    const newButtons = [0, 1];
    setButtons(newButtons);
    publishJoy(lastSentAxes.current, newButtons);
  }, [publishJoy]);

  const handleButtonRelease = useCallback(() => {
    const newButtons = [0, 0];
    setButtons(newButtons);
    publishJoy(lastSentAxes.current, newButtons);
  }, [publishJoy]);

  const getAxisDisplay = useCallback((axisIndex: number) => {
    return axes[axisIndex].toFixed(0);
  }, [axes]);

  return (
    <div className="drone-pad-layout">
      <div className="speed-controls-container">
        <button
          onClick={() => handleSetSpeedMode(SpeedMode.Slow)}
          className={`speed-button ${currentSpeedMode === SpeedMode.Slow ? 'active' : ''}`}
          title="Slow Mode"
          aria-label="Slow Mode"
        >
          <IconTurtle />
        </button>
        <button
          onClick={() => handleSetSpeedMode(SpeedMode.Normal)}
          className={`speed-button ${currentSpeedMode === SpeedMode.Normal ? 'active' : ''}`}
          title="Normal Mode"
          aria-label="Normal Mode"
        >
          <IconNormalSpeed />
        </button>
        <button
          onClick={() => handleSetSpeedMode(SpeedMode.Fast)}
          className={`speed-button ${currentSpeedMode === SpeedMode.Fast ? 'active' : ''}`}
          title="Fast Mode"
          aria-label="Fast Mode"
        >
          <IconTurbo />
        </button>
      </div>

      <div className="drone-pad-interactive-area">
        <button
          title="Take Off"
          aria-label="Take Off"
          className={`drone-button takeoff-button ${buttons[0] === 1 ? 'active' : ''}`}
          onMouseDown={handleTakeOffPress}
          onMouseUp={handleButtonRelease}
          onMouseLeave={handleButtonRelease}
          onTouchStart={handleTakeOffPress}
          onTouchEnd={handleButtonRelease}
        >
          <IconArrowUp />
        </button>

        <div className="joysticks-container">
          <div className="joystick-wrapper">
            <div className="joystick-label">Altitude</div>
            <Joystick
              size={100}
              stickSize={60}
              baseColor={baseJoystickColor}
              stickColor={stickJoystickColor}
              move={handleMoveLeft}
              stop={handleStopLeft}
              throttle={THROTTLE_INTERVAL / 2}
            />
            <div className="joystick-values">
              L/R: {getAxisDisplay(0)} / F/B: {getAxisDisplay(1)}
            </div>
          </div>
          <div className="joystick-wrapper">
            <div className="joystick-label">Rotation</div>
            <Joystick
              size={100}
              stickSize={60}
              baseColor={baseJoystickColor}
              stickColor={stickJoystickColor}
              move={handleMoveRight}
              stop={handleStopRight}
              throttle={THROTTLE_INTERVAL / 2}
            />
            <div className="joystick-values">
              Yaw: {getAxisDisplay(2)} / Thr: {getAxisDisplay(3)}
            </div>
          </div>
        </div>

        <button
          title="Land"
          aria-label="Land"
          className={`drone-button land-button ${buttons[1] === 1 ? 'active' : ''}`}
          onMouseDown={handleLandPress}
          onMouseUp={handleButtonRelease}
          onMouseLeave={handleButtonRelease}
          onTouchStart={handleLandPress}
          onTouchEnd={handleButtonRelease}
        >
          <IconArrowDown />
        </button>
      </div>
    </div>
  );
};

export default DroneGamepadLayout; 