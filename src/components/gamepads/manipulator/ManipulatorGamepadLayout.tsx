/** @jsxImportSource react */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Topic } from 'roslib';
import ROSLIB from 'roslib';
import { Joystick } from 'react-joystick-component';
import type { IJoystickUpdateEvent } from 'react-joystick-component';
import { throttle } from 'lodash-es';
import './ManipulatorGamepadLayout.css';
import { GamepadProps } from '../GamepadInterface';

// SpeedMode enum
enum SpeedMode { Slow, Normal, Fast }

// SCALING FACTORS
const SPEED_FACTORS = {
  [SpeedMode.Slow]: 0.3,  // Adjusted for typical -1 to 1 range
  [SpeedMode.Normal]: 0.6,
  [SpeedMode.Fast]: 1.0,
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
    <circle cx="12" cy="12" r="5"/>
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

// Constants for geometry_msgs/TwistStamped
const TWIST_TOPIC = '/servo_node/delta_twist_cmds'; // Changed
const TWIST_MSG_TYPE = 'geometry_msgs/TwistStamped'; // Changed
const FRAME_ID = 'panda_link0'; // Added
const THROTTLE_INTERVAL = 33; // Milliseconds (approx 30Hz)
const JOYSTICK_MAX_OUTPUT_NORMALIZED = 1.0; // Joystick output will be normalized to this
const JOYSTICK_DEADZONE = 0.001; // Set to a very small value
const JOYSTICK_EVENT_MAX_VAL = 1.0; // Changed from 50 to 1.0

// Frame IDs
const WORLD_FRAME = 'panda_link0';
const GRIPPER_FRAME = 'panda_hand';

// --- SVG Icons for Z-Axis Buttons (repurposed from Takeoff/Land) ---
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
// --- End SVG Z-Axis Icons ---

interface TwistState {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
}

const initialTwistState: TwistState = {
  linear: { x: 0, y: 0, z: 0 },
  angular: { x: 0, y: 0, z: 0 },
};

const ManipulatorGamepadLayout: React.FC<GamepadProps> = ({ ros }: GamepadProps) => {
  const twistTopic = useRef<Topic | null>(null);
  const [currentTwist, setCurrentTwist] = useState<TwistState>(initialTwistState);
  const [zButtonsState, setZButtonsState] = useState<[number, number]>([0, 0]); // [up, down] -> [+z, -z]
  const lastSentTwist = useRef<TwistState & { _frame_id_internal?: string } | null>(null); // Store internal frame id with last sent twist
  const [currentSpeedMode, setCurrentSpeedMode] = useState<SpeedMode>(SpeedMode.Normal);
  const [currentFrameId, setCurrentFrameId] = useState<string>(WORLD_FRAME); // New state for Frame ID
  const zIntervalRef = useRef<number | null>(null); // Changed NodeJS.Timeout to number

  // Refs for joystick intervals for continuous publishing
  const leftJoystickIntervalRef = useRef<number | null>(null);
  const rightJoystickIntervalRef = useRef<number | null>(null);
  const latestLeftJoystickCmd = useRef<{ angularX: number, angularY: number }>({ angularX: 0, angularY: 0 });
  const latestRightJoystickCmd = useRef<{ linearX: number, linearY: number }>({ linearX: 0, linearY: 0 });

  const getThemeColor = (variableName: string) => {
    if (typeof window !== 'undefined') {
      return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
    }
    return ''; // Default or SSR fallback
  };

  const baseJoystickColor = getThemeColor('--secondary-color') || '#6c757d';
  const stickJoystickColor = getThemeColor('--primary-color') || '#32CD32';

  const handleSetSpeedMode = (mode: SpeedMode) => {
    setCurrentSpeedMode(mode);
    // Potentially re-publish current joystick values with new speed, if desired
    // For now, speed change applies to next movement
  };

  const toggleFrameId = () => {
    setCurrentFrameId(prevFrameId => prevFrameId === WORLD_FRAME ? GRIPPER_FRAME : WORLD_FRAME);
    // Publish current twist with new frame ID if joystick is active? For now, new frame applies on next publish.
  };

  const mapJoystickToOutput = useCallback((rawValue: number | null): number => {
    if (rawValue === null) return 0;
    // Normalize rawValue assuming it's in range -JOYSTICK_EVENT_MAX_VAL to +JOYSTICK_EVENT_MAX_VAL
    let normalizedValue = rawValue / JOYSTICK_EVENT_MAX_VAL;
    
    // Apply deadzone minimally, effectively only for true zero crossing
    if (Math.abs(normalizedValue) < JOYSTICK_DEADZONE) return 0;

    // Clamp normalizedValue to -1 to 1 just in case, though joystick component should handle this range with size prop.
    normalizedValue = Math.max(-1, Math.min(1, normalizedValue));

    return normalizedValue * JOYSTICK_MAX_OUTPUT_NORMALIZED * SPEED_FACTORS[currentSpeedMode as SpeedMode];
  }, [currentSpeedMode]);

  const publishTwist = useCallback((twist: TwistState) => {
    if (!twistTopic.current) {
      // console.log('publishTwist: No twist topic');
      return;
    }

    const isTwistNonZero = 
        twist.linear.x !== 0 || twist.linear.y !== 0 || twist.linear.z !== 0 ||
        twist.angular.x !== 0 || twist.angular.y !== 0 || twist.angular.z !== 0;

    const hasTwistDataChanged = !lastSentTwist.current || 
        JSON.stringify(twist) !== JSON.stringify({linear: lastSentTwist.current.linear, angular: lastSentTwist.current.angular });
    
    // Also consider frame ID change as a reason to publish, even if twist is zero (to update frame)
    const hasFrameChanged = !lastSentTwist.current || lastSentTwist.current._frame_id_internal !== currentFrameId;

    if (isTwistNonZero || hasTwistDataChanged || hasFrameChanged) {
      const now = new Date();
      const secs = Math.floor(now.getTime() / 1000);
      const nsecs = (now.getTime() % 1000) * 1000000;

      const twistMsg = new ROSLIB.Message({
        header: {
          stamp: { sec: secs, nsec: nsecs },
          frame_id: currentFrameId,
        },
        twist: twist,
      });
      // console.log('Publishing TwistStamped:', twistMsg.twist, 'Speed:', SpeedMode[currentSpeedMode]);
      twistTopic.current.publish(twistMsg);
      // Store lastSentTwist with the frame_id it was published with for better hasFrameChanged logic
      const sentData: TwistState & { _frame_id_internal?: string } = JSON.parse(JSON.stringify(twist));
      sentData._frame_id_internal = currentFrameId; // Store it internally
      lastSentTwist.current = sentData;
    }
  }, [currentSpeedMode, currentFrameId]);

  const publishTwistThrottled = useCallback(
    throttle(publishTwist, THROTTLE_INTERVAL, { leading: true, trailing: true }),
    [publishTwist] 
  );

  // Helper to clear Z interval
  const clearZInterval = useCallback(() => {
    if (zIntervalRef.current) {
      clearInterval(zIntervalRef.current);
      zIntervalRef.current = null;
    }
  }, []);

  const stopJoystickInterval = (intervalRef: React.MutableRefObject<number | null>) => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const startJoystickInterval = (
    intervalRef: React.MutableRefObject<number | null>,
    updateFunction: () => void // Function to get and publish the latest joystick command
  ) => {
    stopJoystickInterval(intervalRef); // Clear existing interval first
    intervalRef.current = setInterval(() => {
      updateFunction();
    }, THROTTLE_INTERVAL);
  };

  useEffect(() => {
    twistTopic.current = new ROSLIB.Topic({ ros: ros, name: TWIST_TOPIC, messageType: TWIST_MSG_TYPE });
    twistTopic.current.advertise();
    // console.log(`Advertised ${TWIST_TOPIC} for ManipulatorGamepadLayout`);
    return () => {
      publishTwistThrottled.cancel(); // Cancel any pending throttled calls
      // Send a final zero twist message upon unmount to stop movement
      if (lastSentTwist.current && (
          lastSentTwist.current.linear.x !== 0 || lastSentTwist.current.linear.y !== 0 || lastSentTwist.current.linear.z !== 0 ||
          lastSentTwist.current.angular.x !== 0 || lastSentTwist.current.angular.y !== 0 || lastSentTwist.current.angular.z !== 0)
      ) {
        const finalTwist = {...initialTwistState};
        // Ensure final zero twist uses the last active frame to properly stop motion relative to that frame
        const lastFrame = (lastSentTwist.current as any)?._frame_id_internal || currentFrameId;
        const now = new Date();
        const secs = Math.floor(now.getTime() / 1000);
        const nsecs = (now.getTime() % 1000) * 1000000;
        const twistMsg = new ROSLIB.Message({ header: { stamp: { sec: secs, nsec: nsecs }, frame_id: lastFrame }, twist: finalTwist });
        twistTopic.current?.publish(twistMsg); 
      }
      twistTopic.current?.unadvertise();
      // console.log(`Unadvertised ${TWIST_TOPIC} for ManipulatorGamepadLayout`);
      twistTopic.current = null;
      clearZInterval(); // Clear Z interval on unmount
      stopJoystickInterval(leftJoystickIntervalRef);
      stopJoystickInterval(rightJoystickIntervalRef);
    };
  }, [ros, publishTwistThrottled, publishTwist, clearZInterval, currentFrameId]); // Added currentFrameId

  // Effect for continuous Z-button publishing
  useEffect(() => {
    if (zButtonsState[0] === 1 || zButtonsState[1] === 1) { // A Z button is active
      clearZInterval(); // Clear previous interval if speed mode or button changed rapidly
      
      zIntervalRef.current = setInterval(() => {
        const zValue = zButtonsState[0] === 1 
          ? JOYSTICK_MAX_OUTPUT_NORMALIZED * SPEED_FACTORS[currentSpeedMode as SpeedMode]
          : (zButtonsState[1] === 1 
              ? -JOYSTICK_MAX_OUTPUT_NORMALIZED * SPEED_FACTORS[currentSpeedMode as SpeedMode]
              : 0);
        
        if (zValue !== 0) {
          setCurrentTwist((prevJoystickTwist: TwistState) => {
            const newTwist = {
              ...prevJoystickTwist,
              linear: { ...prevJoystickTwist.linear, z: zValue }
            };
            publishTwistThrottled(newTwist); 
            return newTwist; 
          });
        }
      }, THROTTLE_INTERVAL);
    } else { // No Z button active
      clearZInterval();
    }
    // Cleanup function for this effect
    return clearZInterval;
  }, [zButtonsState, currentSpeedMode, publishTwistThrottled, setCurrentTwist, clearZInterval]);

  // Right Joystick: Linear X (forward/backward via Y-axis), Linear Y (left/right via X-axis)
  const handleMoveRightJoystick = useCallback((event: IJoystickUpdateEvent) => {
    const linearX = mapJoystickToOutput(-(event.y ?? 0));
    const linearY = mapJoystickToOutput(event.x ?? 0);
    latestRightJoystickCmd.current = { linearX, linearY };

    if (linearX !== 0 || linearY !== 0) {
      startJoystickInterval(rightJoystickIntervalRef, () => {
        setCurrentTwist((prev: TwistState) => {
          const newTwist = { ...prev, linear: { ...prev.linear, x: latestRightJoystickCmd.current.linearX, y: latestRightJoystickCmd.current.linearY } };
          publishTwistThrottled(newTwist);
          return newTwist;
        });
      });
    } else { // Joystick is back to center or in deadzone
      stopJoystickInterval(rightJoystickIntervalRef);
      setCurrentTwist((prev: TwistState) => {
        const newTwist = { ...prev, linear: { ...prev.linear, x: 0, y: 0 } };
        publishTwist(newTwist); // Publish one last zero
        return newTwist;
      });
    }
  }, [mapJoystickToOutput, publishTwistThrottled, publishTwist]);

  const handleStopRightJoystick = useCallback(() => {
    latestRightJoystickCmd.current = { linearX: 0, linearY: 0 };
    stopJoystickInterval(rightJoystickIntervalRef);
    setCurrentTwist((prev: TwistState) => {
      const newTwist = { ...prev, linear: { ...prev.linear, x: 0, y: 0 } };
      publishTwist(newTwist); // Publish final zero value
      return newTwist;
    });
  }, [publishTwist]);

  // Left Joystick: Angular X (roll via Y-axis), Angular Y (pitch via X-axis)
  const handleMoveLeftJoystick = useCallback((event: IJoystickUpdateEvent) => {
    const angularX = mapJoystickToOutput(-(event.y ?? 0));
    const angularY = mapJoystickToOutput(event.x ?? 0);
    latestLeftJoystickCmd.current = { angularX, angularY };

    if (angularX !== 0 || angularY !== 0) {
      startJoystickInterval(leftJoystickIntervalRef, () => {
        setCurrentTwist((prev: TwistState) => {
          const newTwist = { ...prev, angular: { ...prev.angular, x: latestLeftJoystickCmd.current.angularX, y: latestLeftJoystickCmd.current.angularY } };
          publishTwistThrottled(newTwist);
          return newTwist;
        });
      });
    } else {
      stopJoystickInterval(leftJoystickIntervalRef);
      setCurrentTwist((prev: TwistState) => {
        const newTwist = { ...prev, angular: { ...prev.angular, x: 0, y: 0 } };
        publishTwist(newTwist);
        return newTwist;
      });
    }
  }, [mapJoystickToOutput, publishTwistThrottled, publishTwist]);

  const handleStopLeftJoystick = useCallback(() => {
    latestLeftJoystickCmd.current = { angularX: 0, angularY: 0 };
    stopJoystickInterval(leftJoystickIntervalRef);
    setCurrentTwist((prev: TwistState) => {
      const newTwist = { ...prev, angular: { ...prev.angular, x: 0, y: 0 } };
      publishTwist(newTwist);
      return newTwist;
    });
  }, [publishTwist]);

  // Z-Axis Buttons
  const handleLinearZUpPress = useCallback(() => {
    const newLinearZ = JOYSTICK_MAX_OUTPUT_NORMALIZED * SPEED_FACTORS[currentSpeedMode as SpeedMode];
    // Update currentTwist and publish immediately
    setCurrentTwist((prev: TwistState) => {
      const updatedTwist = { ...prev, linear: { ...prev.linear, z: newLinearZ } };
      publishTwist(updatedTwist); // Immediate publish
      return updatedTwist;
    });
    setZButtonsState([1, 0]); // This will trigger the useEffect for continuous publishing
  }, [currentSpeedMode, publishTwist, setCurrentTwist]);

  const handleLinearZDownPress = useCallback(() => {
    const newLinearZ = -JOYSTICK_MAX_OUTPUT_NORMALIZED * SPEED_FACTORS[currentSpeedMode as SpeedMode];
    // Update currentTwist and publish immediately
    setCurrentTwist((prev: TwistState) => {
      const updatedTwist = { ...prev, linear: { ...prev.linear, z: newLinearZ } };
      publishTwist(updatedTwist); // Immediate publish
      return updatedTwist;
    });
    setZButtonsState([0, 1]); // This will trigger the useEffect for continuous publishing
  }, [currentSpeedMode, publishTwist, setCurrentTwist]);
  
  const handleLinearZRelease = useCallback(() => {
    // useEffect watching zButtonsState will clear the interval when state changes to [0,0]
    setZButtonsState([0, 0]);
     // Update currentTwist to Z=0 and publish immediately
    setCurrentTwist((prev: TwistState) => {
      const updatedTwist = { ...prev, linear: { ...prev.linear, z: 0 } };
      publishTwist(updatedTwist);
      return updatedTwist;
    });
  }, [publishTwist, setCurrentTwist]);

  return (
    <div className="manipulator-pad-layout">
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

      {/* New Frame ID Toggle Switch */}
      <div className="frame-toggle-switch-container" onClick={toggleFrameId} role="switch" aria-checked={currentFrameId === GRIPPER_FRAME} tabIndex={0} onKeyDown={(e) => e.key === ' ' || e.key === 'Enter' ? toggleFrameId() : null}>
        <span className={`frame-label left-label ${currentFrameId === WORLD_FRAME ? 'active' : ''}`}>World</span>
        <div className={`frame-toggle-track ${currentFrameId === GRIPPER_FRAME ? 'toggled-right' : ''}`}>
          <div className="frame-toggle-thumb" />
        </div>
        <span className={`frame-label right-label ${currentFrameId === GRIPPER_FRAME ? 'active' : ''}`}>Gripper</span>
      </div>

      <div className="manipulator-pad-interactive-area">
        <div className="manipulator-buttons-and-joysticks">
          <div className="joystick-wrapper">
            <div className="joystick-label">Angular (Y: Roll, X: Pitch)</div>
            <Joystick
              size={100}
              stickSize={60}
              baseColor={baseJoystickColor}
              stickColor={stickJoystickColor}
              move={handleMoveLeftJoystick}
              stop={handleStopLeftJoystick}
              throttle={THROTTLE_INTERVAL / 2}
            />
            <div className="joystick-output-display">
              Ang X: {currentTwist.angular.x.toFixed(2)}, Ang Y: {currentTwist.angular.y.toFixed(2)}
            </div>
          </div>

          <div className="joystick-wrapper">
            <div className="joystick-label">Linear Control (Y: X-axis, X: Y-axis)</div>
            <Joystick
              size={100}
              stickSize={60}
              baseColor={baseJoystickColor}
              stickColor={stickJoystickColor}
              move={handleMoveRightJoystick}
              stop={handleStopRightJoystick}
              throttle={THROTTLE_INTERVAL / 2}
            />
            <div className="joystick-output-display">
              Lin X: {currentTwist.linear.x.toFixed(2)}, Lin Y: {currentTwist.linear.y.toFixed(2)}
            </div>
          </div>
          
          <div className="z-controls-wrapper">
            <div className="z-axis-controls">
              <button
                title="Move Linear Z+"
                aria-label="Move Linear Z Positive"
                className={`manipulator-button ${zButtonsState[0] === 1 ? 'active' : ''}`}
                onMouseDown={handleLinearZUpPress}
                onMouseUp={handleLinearZRelease}
                onMouseLeave={handleLinearZRelease}
                onTouchStart={handleLinearZUpPress}
                onTouchEnd={handleLinearZRelease}
              >
                <IconArrowUp />
              </button>
              <button
                title="Move Linear Z-"
                aria-label="Move Linear Z Negative"
                className={`manipulator-button ${zButtonsState[1] === 1 ? 'active' : ''}`}
                onMouseDown={handleLinearZDownPress}
                onMouseUp={handleLinearZRelease}
                onMouseLeave={handleLinearZRelease}
                onTouchStart={handleLinearZDownPress}
                onTouchEnd={handleLinearZRelease}
              >
                <IconArrowDown />
              </button>
            </div>
            <div className="joystick-output-display z-output-display">
              Lin Z: {currentTwist.linear.z.toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManipulatorGamepadLayout; 