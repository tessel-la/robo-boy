import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Ros, Topic } from 'roslib';
import ROSLIB from 'roslib';
import { Joystick } from 'react-joystick-component';
// import type { IJoystickUpdateEvent } from 'react-joystick-component/build/lib/Joystick'; // Type import failed
import { throttle } from 'lodash-es'; // Import throttle
import './PadControl.css'; // Create later

interface PadControlProps {
  ros: Ros;
}

// Constants
const CMD_VEL_TOPIC = '/cmd_vel';
const CMD_VEL_MSG_TYPE = 'geometry_msgs/Twist';
const THROTTLE_INTERVAL = 100; // Milliseconds between velocity commands
const MAX_LINEAR_SPEED = 0.5; // m/s - Adjust as needed
const MAX_ANGULAR_SPEED = 1.0; // rad/s - Adjust as needed
const MAX_LINEAR_Y_SPEED = 0.5; // m/s - Add Y speed limit
const MAX_LINEAR_Z_SPEED = 0.3; // m/s - Add Z speed limit

const PadControl: React.FC<PadControlProps> = ({ ros }) => {
  const cmdVelTopic = useRef<Topic | null>(null);
  // Use state to store combined velocity components from both joysticks
  const [velocities, setVelocities] = useState({
    linearX: 0,
    linearY: 0,
    linearZ: 0,
    angularZ: 0,
  });
  const lastSentVelocities = useRef({ ...velocities }); // Keep track of last sent values for display

  // Initialize the topic publisher
  useEffect(() => {
    cmdVelTopic.current = new ROSLIB.Topic({
      ros: ros,
      name: CMD_VEL_TOPIC,
      messageType: CMD_VEL_MSG_TYPE,
    });
    cmdVelTopic.current.advertise();
    console.log(`Advertised ${CMD_VEL_TOPIC}`);

    return () => {
      // Send a stop command when component unmounts if moving
      if (Object.values(lastSentVelocities.current).some(v => v !== 0)) {
        publishVelocityCombinedThrottled.cancel(); // Cancel any pending throttled calls
        publishVelocityCombined({ linearX: 0, linearY: 0, linearZ: 0, angularZ: 0 }); // Send immediate stop
      }
      cmdVelTopic.current?.unadvertise();
      console.log(`Unadvertised ${CMD_VEL_TOPIC}`);
      cmdVelTopic.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ros]); // Only re-initialize if ros changes

  // Raw velocity publishing function - takes the combined state
  const publishVelocityCombined = (vels: typeof velocities) => {
    if (!cmdVelTopic.current) return;

    const twist = new ROSLIB.Message({
      linear: { x: vels.linearX, y: vels.linearY, z: vels.linearZ },
      angular: { x: 0, y: 0, z: vels.angularZ },
    });
    // console.log('Publishing Twist:', twist);
    cmdVelTopic.current.publish(twist);
    lastSentVelocities.current = { ...vels }; // Update last sent state
    // We need to update the state for display purposes, as lastSentVelocities is just a ref
    setVelocities(vels);
  };

  // Throttled version of the combined publish function
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const publishVelocityCombinedThrottled = useCallback(
    throttle(publishVelocityCombined, THROTTLE_INTERVAL, { leading: true, trailing: true }),
    [ros] // Recreate throttled func only if ros changes
  );

  // --- Left Joystick Handlers (X/Y Translation) ---
  const handleMoveLeft = (event: any) => {
    if (event.x === null || event.y === null) return;
    const size = 100;
    const halfSize = size / 2;
    const newLinearX = (event.y / halfSize) * MAX_LINEAR_SPEED;
    const newLinearY = (-event.x / halfSize) * MAX_LINEAR_Y_SPEED; // Inverted X for Y

    const newVels = {
        ...lastSentVelocities.current, // Keep Z/Yaw from other joystick
        linearX: newLinearX,
        linearY: newLinearY,
    };
    setVelocities(newVels); // Update state immediately for responsiveness
    publishVelocityCombinedThrottled(newVels);
  };

  const handleStopLeft = () => {
    publishVelocityCombinedThrottled.cancel(); // Cancel pending calls
    const newVels = {
        ...lastSentVelocities.current, // Keep Z/Yaw from other joystick
        linearX: 0,
        linearY: 0,
    };
    setVelocities(newVels); // Update state immediately
    publishVelocityCombined(newVels); // Publish stop for X/Y immediately
  };

  // --- Right Joystick Handlers (Z/Yaw) ---
  const handleMoveRight = (event: any) => {
    if (event.x === null || event.y === null) return;
    const size = 100;
    const halfSize = size / 2;
    const newLinearZ = (event.y / halfSize) * MAX_LINEAR_Z_SPEED; // Y axis for Z
    const newAngularZ = (-event.x / halfSize) * MAX_ANGULAR_SPEED; // X axis for Yaw

     const newVels = {
        ...lastSentVelocities.current, // Keep X/Y from other joystick
        linearZ: newLinearZ,
        angularZ: newAngularZ,
    };
    setVelocities(newVels); // Update state immediately for responsiveness
    publishVelocityCombinedThrottled(newVels);
  };

  const handleStopRight = () => {
    publishVelocityCombinedThrottled.cancel(); // Cancel pending calls
    const newVels = {
        ...lastSentVelocities.current, // Keep X/Y from other joystick
        linearZ: 0,
        angularZ: 0,
    };
    setVelocities(newVels); // Update state immediately
    publishVelocityCombined(newVels); // Publish stop for Z/Yaw immediately
  };

  return (
    <div className="pad-control">
      <h4>Pad Control</h4>
      <div className="joysticks-container"> {/* Changed class */}
         {/* Left Joystick (X/Y Translation) */}
        <div className="joystick-wrapper">
          <Joystick
            size={100}
            stickSize={60}
            baseColor="var(--border-color)"
            stickColor="var(--primary-color)"
            move={handleMoveLeft}
            stop={handleStopLeft}
            throttle={THROTTLE_INTERVAL / 2}
          />
          <p className="joystick-label">Translate (X/Y)</p>
        </div>

        {/* Right Joystick (Z/Yaw) */}
         <div className="joystick-wrapper">
          <Joystick
            size={100}
            stickSize={60}
            baseColor="var(--border-color)"
            stickColor="var(--primary-color)"
            move={handleMoveRight}
            stop={handleStopRight}
            throttle={THROTTLE_INTERVAL / 2}
          />
          <p className="joystick-label">Height (Z) / Yaw</p>
         </div>
      </div>
      <div className="speed-info-grid"> {/* Changed class for grid layout */}
        <p>LX: {velocities.linearX.toFixed(2)} m/s</p>
        <p>LY: {velocities.linearY.toFixed(2)} m/s</p>
        <p>LZ: {velocities.linearZ.toFixed(2)} m/s</p>
        <p>AZ: {velocities.angularZ.toFixed(2)} rad/s</p>
      </div>
    </div>
  );
};

export default PadControl; 