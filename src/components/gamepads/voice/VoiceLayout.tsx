import React, { useState, useEffect, useRef } from 'react';
import type { Ros, Topic } from 'roslib';
import ROSLIB from 'roslib';
import './VoiceLayout.css'; // Renamed CSS import

interface VoiceLayoutProps { // Renamed interface
  ros: Ros;
}

// Define the topic and message type for voice commands (e.g., Float32MultiArray)
// Adjust based on your specific ROS setup
const VOICE_CMD_TOPIC = '/voice_cmd'; // Example topic
const VOICE_CMD_MSG_TYPE = 'std_msgs/Float32MultiArray'; // Example message type

const VoiceLayout: React.FC<VoiceLayoutProps> = ({ ros }) => { // Renamed component
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Click Record to start');
  const voiceCmdTopic = useRef<Topic | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Initialize the topic publisher
  useEffect(() => {
    voiceCmdTopic.current = new ROSLIB.Topic({
      ros: ros,
      name: VOICE_CMD_TOPIC,
      messageType: VOICE_CMD_MSG_TYPE,
    });
    voiceCmdTopic.current.advertise();
    console.log(`Advertised ${VOICE_CMD_TOPIC} for VoiceLayout`); // Updated log

    return () => {
      voiceCmdTopic.current?.unadvertise();
      console.log(`Unadvertised ${VOICE_CMD_TOPIC} for VoiceLayout`); // Updated log
      voiceCmdTopic.current = null;
      // Ensure recorder is stopped if component unmounts while recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, [ros]);

  // Function to publish voice data (as Float32MultiArray placeholder)
  const publishVoiceData = (/* audioBlob: Blob */) => {
    if (!voiceCmdTopic.current) {
      console.warn('Voice command topic not initialized');
      return;
    }

    // --- Placeholder: Process audioBlob into Float32Array ---
    // This is complex and depends on how you want to represent the audio.
    // You might use Web Audio API to decode, resample, and get Float32Array data.
    // For now, we'll send a dummy array.
    const dummyData = [0.1, 0.2, 0.3]; 
    console.warn('Audio processing not implemented. Sending dummy data.');
    // --- End Placeholder ---

    const message = new ROSLIB.Message({
      layout: {
        dim: [{ label: 'samples', size: dummyData.length, stride: 1 }],
        data_offset: 0
      },
      data: dummyData
    });

    console.log('Publishing Voice Data (dummy):', message);
    voiceCmdTopic.current.publish(message);
    setStatusMessage('Voice command sent (dummy)');
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event: BlobEvent) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        // Process and publish the audio data
        publishVoiceData(/* audioBlob */);
        // Clean up stream tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setStatusMessage('Recording... Click Stop to send.');
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setStatusMessage('Error: Could not access microphone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Status message updated in onstop handler
    }
  };

  return (
    <div className="voice-layout"> {/* Renamed class */}
      {isRecording && (
        <div className="recording-indicator">
          {/* <div className="pulsating-dot"></div> Removed dot */}
          {/* Sound Wave Animation */}
          <div className="sound-wave-container">
            <div className="sound-bar"></div>
            <div className="sound-bar"></div>
            <div className="sound-bar"></div>
            <div className="sound-bar"></div>
            <div className="sound-bar"></div>
          </div>
          {/* <span>Recording...</span> Maybe remove text if wave is clear */} 
        </div>
      )}
      <p className="status-message">{statusMessage}</p>
      <button 
        className={`record-button ${isRecording ? 'recording' : ''}`}
        onClick={isRecording ? stopRecording : startRecording} 
        disabled={!ros}
      > 
        {isRecording ? 'Stop' : 'Record'}
      </button>
    </div>
  );
};

export default VoiceLayout; // Renamed export 