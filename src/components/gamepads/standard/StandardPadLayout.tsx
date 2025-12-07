import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Topic } from 'roslib';
import ROSLIB from 'roslib';
import { Joystick } from 'react-joystick-component';
import type { IJoystickUpdateEvent } from '../../../types/joystick'; // Use the correct type import
import { throttle } from 'lodash-es'; // Import throttle
import './StandardPadLayout.css'; // Renamed CSS import
import { GamepadProps } from '../GamepadInterface';

// Constants - Updated for sensor_msgs/Joy
const JOY_TOPIC = '/joy'; // Standard topic for joystick data
const JOY_MSG_TYPE = 'sensor_msgs/Joy';
const THROTTLE_INTERVAL = 100; // Milliseconds 
const JOYSTICK_MAX_VALUE = 1.0; // Max absolute value for axes
const NUM_AXES = 4; // Define the number of axes we are using (adjust if needed)

const StandardPadLayout: React.FC<GamepadProps> = ({ ros }) => { // Now using GamepadProps
  const joyTopic = useRef<Topic | null>(null); // Renamed ref
  // State to hold axes values - Initialize with zeros
  const [axes, setAxes] = useState<number[]>(Array(NUM_AXES).fill(0.0));
  const lastSentAxes = useRef<number[]>([...axes]);
  // --- Add state for joystick colors ---
  const [baseJoystickColor, setBaseJoystickColor] = useState<string>('#6c757d');
  const [stickJoystickColor, setStickJoystickColor] = useState<string>('#32CD32');

  // Get current theme colors dynamically (this assumes theme variables are set on :root or body)
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

  // Note: This might cause a flicker on initial load if CSS isn't fully loaded.
  // Consider passing theme state down or using context for a more robust solution if needed.

  // Function to publish Joy message (define first)
  const publishJoy = useCallback((currentAxes: number[]) => {
    if (!joyTopic.current) return;

    const joyMsg = new ROSLIB.Message({
      header: { // Add a basic header (optional but good practice)
        stamp: { secs: 0, nsecs: 0 }, // Can be populated with current time if needed
        frame_id: ''
      },
      axes: currentAxes,
      buttons: [] // No buttons implemented for now
    });
    // console.log('Publishing Joy:', joyMsg);
    joyTopic.current.publish(joyMsg);
    lastSentAxes.current = [...currentAxes]; // Update last sent state
  }, []); // No dependencies needed

  // Throttled version of the publish function (define second)
  const publishJoyThrottled = useCallback(
    throttle(publishJoy, THROTTLE_INTERVAL, { leading: true, trailing: true }),
    [publishJoy] // Depends on publishJoy now
  );

  // Initialize the topic publisher (define last)
  useEffect(() => {
    joyTopic.current = new ROSLIB.Topic({
      ros: ros,
      name: JOY_TOPIC,
      messageType: JOY_MSG_TYPE,
    });
    joyTopic.current.advertise();
    console.log(`Advertised ${JOY_TOPIC} for StandardPadLayout`); // Updated log

    return () => {
      // Send a zero axes command when component unmounts if axes are non-zero
      if (lastSentAxes.current.some((a: number) => a !== 0)) { // Add type for 'a'
        publishJoyThrottled.cancel(); // Cancel any pending throttled calls
        publishJoy(Array(NUM_AXES).fill(0.0)); // Send immediate stop
      }
      joyTopic.current?.unadvertise();
      console.log(`Unadvertised ${JOY_TOPIC} for StandardPadLayout`); // Updated log
      joyTopic.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ros, publishJoyThrottled, publishJoy]); // Keep dependencies


  // --- Left Joystick Handlers (Axes 0 & 1) ---
  const handleMoveLeft = useCallback((event: IJoystickUpdateEvent) => { // Use imported type
    if (event.x === null || event.y === null) return;
    const size = 100; // Assuming joystick component size is 100
    const halfSize = size / 2;
    // Map joystick x/y to axes 0/1, normalize to [-JOYSTICK_MAX_VALUE, +JOYSTICK_MAX_VALUE]
    const newAxis0 = (event.x / halfSize) * JOYSTICK_MAX_VALUE;
    const newAxis1 = (event.y / halfSize) * JOYSTICK_MAX_VALUE;

    const newAxes = [...lastSentAxes.current]; // Start with the last known state
    newAxes[0] = newAxis0;
    newAxes[1] = newAxis1;

    setAxes(newAxes); // Update state immediately for responsiveness
    publishJoyThrottled(newAxes);
  }, [publishJoyThrottled]); // Added dependency

  const handleStopLeft = useCallback(() => {
    publishJoyThrottled.cancel(); // Cancel pending calls
    const newAxes = [...lastSentAxes.current];
    newAxes[0] = 0.0;
    newAxes[1] = 0.0;
    setAxes(newAxes); // Update state immediately
    publishJoy(newAxes); // Publish stop immediately
  }, [publishJoy, publishJoyThrottled]); // Added dependencies

  // --- Right Joystick Handlers (Axes 2 & 3) ---
  const handleMoveRight = useCallback((event: IJoystickUpdateEvent) => { // Use imported type
    if (event.x === null || event.y === null) return;
    const size = 100; // Assuming joystick component size is 100
    const halfSize = size / 2;
    // Map joystick x/y to axes 2/3, normalize
    const newAxis2 = (event.x / halfSize) * JOYSTICK_MAX_VALUE;
    const newAxis3 = (event.y / halfSize) * JOYSTICK_MAX_VALUE;

    const newAxes = [...lastSentAxes.current]; // Start with the last known state
    newAxes[2] = newAxis2;
    newAxes[3] = newAxis3;

    setAxes(newAxes); // Update state immediately for responsiveness
    publishJoyThrottled(newAxes);
  }, [publishJoyThrottled]); // Added dependency

  const handleStopRight = useCallback(() => {
    publishJoyThrottled.cancel(); // Cancel pending calls
    const newAxes = [...lastSentAxes.current];
    newAxes[2] = 0.0;
    newAxes[3] = 0.0;
    setAxes(newAxes); // Update state immediately
    publishJoy(newAxes); // Publish stop immediately
  }, [publishJoy, publishJoyThrottled]); // Added dependencies

  return (
    <div className="standard-pad-layout"> {/* Renamed class */}
      <div className="joysticks-container">
        {/* Left Joystick */}
        <div className="joystick-wrapper">
          <Joystick
            size={100}
            stickSize={60}
            baseColor={baseJoystickColor} // Use dynamic secondary color
            stickColor={stickJoystickColor} // Use dynamic primary color
            move={handleMoveLeft}
            stop={handleStopLeft}
            throttle={THROTTLE_INTERVAL / 2} // Throttle internal updates if needed
          />
          {/* <p className="joystick-label">Axes 0 (X) / 1 (Y)</p> Optional label */}
        </div>

        {/* Right Joystick */}
        <div className="joystick-wrapper">
          <Joystick
            size={100}
            stickSize={60}
            baseColor={baseJoystickColor} // Use dynamic secondary color
            stickColor={stickJoystickColor} // Use dynamic primary color
            move={handleMoveRight}
            stop={handleStopRight}
            throttle={THROTTLE_INTERVAL / 2}
          />
          {/* <p className="joystick-label">Axes 2 (X) / 3 (Y)</p> Optional label */}
        </div>
      </div>
      {/* Speed info removed */}
    </div>
  );
};

export default StandardPadLayout; // Renamed export 