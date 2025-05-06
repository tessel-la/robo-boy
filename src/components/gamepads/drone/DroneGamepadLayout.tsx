/** @jsxImportSource react */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Topic } from 'roslib';
import ROSLIB from 'roslib';
import { Joystick } from 'react-joystick-component';
import type { IJoystickUpdateEvent } from 'react-joystick-component';
import { throttle } from 'lodash-es';
import './DroneGamepadLayout.css';
import { GamepadProps } from '../GamepadInterface';

// Constants for sensor_msgs/Joy
const JOY_TOPIC = '/joy';
const JOY_MSG_TYPE = 'sensor_msgs/Joy';
const THROTTLE_INTERVAL = 100; // Milliseconds 
const MAX_JOYSTICK_VALUE = 255.0; // Max output value (0-255 range)
const NUM_AXES = 4; // Number of axes
const NUM_BUTTONS = 2; // Two buttons: takeoff and landing
const JOYSTICK_DEADZONE = 0.01; // Small deadzone to filter noise

const DroneGamepadLayout: React.FC<GamepadProps> = ({ ros }) => {
  const joyTopic = useRef<Topic | null>(null);
  // State to hold axes values - Initialize with zeros
  const [axes, setAxes] = useState<number[]>(Array(NUM_AXES).fill(0.0));
  // State to track button presses - initialize with [0, 0] for takeoff and land
  const [buttons, setButtons] = useState<number[]>([0, 0]);
  const lastSentAxes = useRef<number[]>([...axes]);
  const lastSentButtons = useRef<number[]>([...buttons]);
  
  // Get current theme colors dynamically
  const getThemeColor = (variableName: string) => {
    return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  };

  const baseJoystickColor = getThemeColor('--secondary-color') || '#6c757d';
  const stickJoystickColor = getThemeColor('--primary-color') || '#32CD32';

  // Function to map joystick values (-1.0 to 1.0) to desired output range (0-255)
  const mapJoystickToOutput = useCallback((value: number): number => {
    // Apply minimal deadzone to filter only true noise
    if (Math.abs(value) < JOYSTICK_DEADZONE) {
      return 0;
    }
    
    // Scale from deadzone to full range
    const adjustedValue = Math.sign(value) * 
                        (Math.abs(value) - JOYSTICK_DEADZONE) / 
                        (1.0 - JOYSTICK_DEADZONE);
    
    // Map to 0-255 range
    const outputValue = Math.sign(adjustedValue) * 
                       Math.abs(adjustedValue) * MAX_JOYSTICK_VALUE;
    
    return outputValue;
  }, []);

  // Function to publish Joy message with both buttons
  const publishJoy = useCallback((currentAxes: number[], currentButtons: number[]) => {
    if (!joyTopic.current) return;

    // Log what we're sending - only when values are non-zero to avoid console spam
    if (currentAxes.some(v => v !== 0) || currentButtons.some(b => b !== 0)) {
      console.log('Publishing joy message:', { axes: currentAxes, buttons: currentButtons });
    }

    const joyMsg = new ROSLIB.Message({
      header: {
        stamp: { secs: 0, nsecs: 0 },
        frame_id: ''
      },
      axes: currentAxes,
      buttons: currentButtons
    });
    joyTopic.current.publish(joyMsg);
    lastSentAxes.current = [...currentAxes];
    lastSentButtons.current = [...currentButtons];
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
    console.log(`Advertised ${JOY_TOPIC} for DroneGamepadLayout`);

    return () => {
      // Send a zero axes and buttons command when component unmounts
      if (lastSentAxes.current.some((a: number) => a !== 0) || 
          lastSentButtons.current.some((b: number) => b !== 0)) {
        publishJoyThrottled.cancel();
        publishJoy(Array(NUM_AXES).fill(0.0), [0, 0]); // Reset all axes and buttons
      }
      joyTopic.current?.unadvertise();
      console.log(`Unadvertised ${JOY_TOPIC} for DroneGamepadLayout`);
      joyTopic.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ros, publishJoyThrottled, publishJoy]);

  // --- Left Joystick Handlers (Axes 0 & 1) ---
  const handleMoveLeft = useCallback((event: IJoystickUpdateEvent) => {
    if (event.x === null || event.y === null) return;
    const size = 100;
    const halfSize = size / 2;
    
    // Map joystick x/y to raw values from -1.0 to 1.0
    const rawX = (event.x / halfSize);
    const rawY = (event.y / halfSize);
    
    // Convert to output range using our mapper function
    const newAxis0 = mapJoystickToOutput(rawX);
    const newAxis1 = mapJoystickToOutput(rawY);
    
    console.log('Left joystick:', { 
      rawX, rawY, 
      mappedX: newAxis0, mappedY: newAxis1
    });

    const newAxes = [...lastSentAxes.current];
    newAxes[0] = newAxis0;
    newAxes[1] = newAxis1;

    setAxes(newAxes);
    publishJoyThrottled(newAxes, buttons);
  }, [publishJoyThrottled, buttons, mapJoystickToOutput]);

  const handleStopLeft = useCallback(() => {
    publishJoyThrottled.cancel();
    const newAxes = [...lastSentAxes.current];
    // Set to 0 when stopped
    newAxes[0] = 0;
    newAxes[1] = 0;
    setAxes(newAxes);
    publishJoy(newAxes, buttons);
  }, [publishJoy, publishJoyThrottled, buttons]);

  // --- Right Joystick Handlers (Axes 2 & 3) ---
  const handleMoveRight = useCallback((event: IJoystickUpdateEvent) => {
    if (event.x === null || event.y === null) return;
    const size = 100;
    const halfSize = size / 2;
    
    // Map joystick x/y to raw values from -1.0 to 1.0
    const rawX = (event.x / halfSize);
    const rawY = (event.y / halfSize);
    
    // Convert to output range using our mapper function
    const newAxis2 = mapJoystickToOutput(rawX);
    const newAxis3 = mapJoystickToOutput(rawY);
    
    console.log('Right joystick:', { 
      rawX, rawY, 
      mappedX: newAxis2, mappedY: newAxis3
    });

    const newAxes = [...lastSentAxes.current];
    newAxes[2] = newAxis2;
    newAxes[3] = newAxis3;

    setAxes(newAxes);
    publishJoyThrottled(newAxes, buttons);
  }, [publishJoyThrottled, buttons, mapJoystickToOutput]);

  const handleStopRight = useCallback(() => {
    publishJoyThrottled.cancel();
    const newAxes = [...lastSentAxes.current];
    // Set to 0 when stopped
    newAxes[2] = 0;
    newAxes[3] = 0;
    setAxes(newAxes);
    publishJoy(newAxes, buttons);
  }, [publishJoy, publishJoyThrottled, buttons]);

  // --- Take Off Button Handler ---
  const handleTakeOffPress = useCallback(() => {
    const newButtons = [1, 0]; // Activate takeoff button, deactivate land button
    setButtons(newButtons);
    publishJoy(lastSentAxes.current, newButtons);
  }, [publishJoy]);

  // --- Land Button Handler ---
  const handleLandPress = useCallback(() => {
    const newButtons = [0, 1]; // Deactivate takeoff button, activate land button
    setButtons(newButtons);
    publishJoy(lastSentAxes.current, newButtons);
  }, [publishJoy]);
  
  // --- Button Release Handler ---
  const handleButtonRelease = useCallback(() => {
    const newButtons = [0, 0]; // Reset both buttons when released
    setButtons(newButtons);
    publishJoy(lastSentAxes.current, newButtons);
  }, [publishJoy]);

  // Display current joystick values
  const getAxisDisplay = useCallback((axisIndex: number) => {
    const value = axes[axisIndex];
    return value.toFixed(0);
  }, [axes]);

  return (
    <div className="drone-pad-layout">
      <div className="joysticks-container">
        {/* Left Joystick */}
        <div className="joystick-wrapper">
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
            X: {getAxisDisplay(0)} / Y: {getAxisDisplay(1)}
          </div>
        </div>

        {/* Right Joystick */}
        <div className="joystick-wrapper">
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
            X: {getAxisDisplay(2)} / Y: {getAxisDisplay(3)}
          </div>
        </div>
      </div>

      {/* Drone Control Buttons */}
      <div className="drone-control-buttons">
        <button 
          className={`drone-button takeoff-button ${buttons[0] === 1 ? 'active' : ''}`}
          onMouseDown={handleTakeOffPress}
          onMouseUp={handleButtonRelease}
          onMouseLeave={handleButtonRelease}
          onTouchStart={handleTakeOffPress}
          onTouchEnd={handleButtonRelease}
        >
          Take Off
        </button>
        <button 
          className={`drone-button land-button ${buttons[1] === 1 ? 'active' : ''}`}
          onMouseDown={handleLandPress}
          onMouseUp={handleButtonRelease}
          onMouseLeave={handleButtonRelease}
          onTouchStart={handleLandPress}
          onTouchEnd={handleButtonRelease}
        >
          Land
        </button>
      </div>
    </div>
  );
};

export default DroneGamepadLayout; 