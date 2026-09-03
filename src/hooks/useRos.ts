import { useState, useEffect, useRef, useCallback } from 'react';
import ROSLIB from 'roslib';
import type { Ros } from 'roslib';
import { ConnectionParams } from '../App'; // Assuming App.tsx is in src/
import { resolveRuntimeEndpoints } from '../runtime/runtimeConfig';

// Define the hook's return type
interface UseRosReturn {
  ros: Ros | null;
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  connectionGeneration: number;
  connect: (params: ConnectionParams) => void;
  disconnect: () => void;
  // Add publish/subscribe methods here later
}

// Port is no longer needed here as we use the default via Caddy
// const ROSBRIDGE_PORT = 9090;

export const useRos = (): UseRosReturn => {
  const [ros, setRos] = useState<Ros | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<UseRosReturn['connectionStatus']>('disconnected');
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const isConnectedRef = useRef(false);
  // Use a single ref to hold the current ROS instance. Simpler state management.
  const rosInstanceRef = useRef<Ros | null>(null);
  // Ref to track if a connection attempt is in progress to avoid overlaps
  const isConnectingRef = useRef<boolean>(false);

  // Stable disconnect function
  const disconnect = useCallback(() => {
    if (rosInstanceRef.current) {
      console.log('[disconnect] Disconnecting ROS instance...');
      const currentRos = rosInstanceRef.current;
      rosInstanceRef.current = null;
      currentRos.close();
    }
    // Reset state regardless of whether an instance existed
    console.log('[disconnect] Resetting state.');
    setIsConnected(false);
    isConnectedRef.current = false;
    setRos(null);
    setConnectionStatus('disconnected');
    isConnectingRef.current = false;
  }, []);

  const connect = useCallback(
    (params: ConnectionParams) => {
      // 1. Check Flags/State
      if (isConnectingRef.current) {
        console.log('[connect] Connection attempt already in progress.');
        return;
      }
      if (isConnectedRef.current) {
        console.log('[connect] Already connected (state check).');
        return;
      }

      // 2. Reset State First
      console.log('[connect] Resetting connection state before new attempt.');
      setIsConnected(false);
      setRos(null);
      setConnectionStatus('disconnected');
      isConnectingRef.current = false; // Ensure flag is false before potentially closing/connecting

      // 3. Close Previous Instance
      if (rosInstanceRef.current) {
        console.log('[connect] Closing previous ROS instance ref before new attempt.');
        const previousRos = rosInstanceRef.current;
        rosInstanceRef.current = null;
        previousRos.close();
      }

      // 4. Set Connecting Flag
      console.log('[connect] Setting connecting flag and attempting connection with params:', params);
      isConnectingRef.current = true;
      setConnectionStatus('connecting');

      const { rosbridgeUrl: url, mode } = resolveRuntimeEndpoints(params);
      console.log(`[connect] Using ${mode} ROS bridge URL: ${url}`);

      const newRos = new ROSLIB.Ros({ url });

      // 5. Assign Ref *before* adding listeners
      console.log('[connect] Assigning new ROS instance to ref.');
      rosInstanceRef.current = newRos;
      setConnectionGeneration(generation => generation + 1);

      // 6. Add Listeners
      newRos.on('connection', () => {
        console.log('[on.connection] Event received.');
        // Critical check: Only update state if this is still the current attempt
        if (newRos === rosInstanceRef.current) {
          console.log('[on.connection] Current instance matched. Setting connected state.');
          setRos(newRos);
          setIsConnected(true);
          isConnectedRef.current = true;
          setConnectionStatus('connected');
          isConnectingRef.current = false;
        } else {
          console.warn('[on.connection] Ignoring event from stale ROS instance.');
          newRos.close();
        }
      });

      newRos.on('error', (error: Error) => {
        console.error('[on.error] Event received: ', error);
        // Only handle error if it belongs to the current attempt
        if (newRos === rosInstanceRef.current) {
          console.log('[on.error] Current instance matched. Disconnecting due to error.');
          disconnect(); // Use the main disconnect logic for full cleanup
        } else {
          console.warn('[on.error] Ignoring event from stale ROS instance.');
        }
      });

      newRos.on('close', () => {
        console.log('[on.close] Event received.');
        // Only handle close if it belongs to the current attempt
        // and wasn't an explicit disconnect already handled by error or direct call
        if (newRos === rosInstanceRef.current) {
          console.log('[on.close] Current instance matched. Disconnecting due to close.');
          disconnect(); // Use the main disconnect logic for full cleanup
        } else {
          console.warn('[on.close] Ignoring event from stale ROS instance.');
        }
      });
    },
    [disconnect]
  ); // connect should be stable

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('[useEffect cleanup] useRos unmounting - disconnecting');
      disconnect();
    };
  }, [disconnect]);

  return { ros, isConnected, connectionStatus, connectionGeneration, connect, disconnect };
};
