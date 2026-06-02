import React, { useEffect, useRef, useState } from 'react';
import type { Ros, Topic } from 'roslib';
import ROSLIB from 'roslib';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';
import { buildCameraStreamUrl } from '../rosMessageUtils';
import './DataDisplayComponents.css';

interface CameraComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

function getImageMimeType(messageType: string, format?: string): string {
  if (!messageType.includes('CompressedImage')) return 'image/png';

  const normalized = (format || '').toLowerCase();
  if (normalized.includes('png')) return 'image/png';
  if (normalized.includes('webp')) return 'image/webp';
  return 'image/jpeg';
}

function arrayDataToBase64(data: string | number[] | Uint8Array): string {
  if (typeof data === 'string') return data;

  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function arrayDataToBytes(data: string | number[] | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return Uint8Array.from(data);

  const binary = window.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function rawImageToDataUrl(message: any): string | null {
  if (!message?.width || !message?.height || !message?.data) return null;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;

  const width = Number(message.width);
  const height = Number(message.height);
  const encoding = String(message.encoding || 'rgb8').toLowerCase();
  const source = arrayDataToBytes(message.data);
  canvas.width = width;
  canvas.height = height;
  const imageData = context.createImageData(width, height);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const targetIndex = pixel * 4;

    if (encoding === 'mono8') {
      const value = source[pixel] ?? 0;
      imageData.data[targetIndex] = value;
      imageData.data[targetIndex + 1] = value;
      imageData.data[targetIndex + 2] = value;
      imageData.data[targetIndex + 3] = 255;
    } else {
      const channels = encoding === 'rgba8' || encoding === 'bgra8' ? 4 : 3;
      const sourceIndex = pixel * channels;
      const r = source[sourceIndex] ?? 0;
      const g = source[sourceIndex + 1] ?? 0;
      const b = source[sourceIndex + 2] ?? 0;
      const a = channels === 4 ? source[sourceIndex + 3] ?? 255 : 255;

      imageData.data[targetIndex] = encoding.startsWith('bgr') ? b : r;
      imageData.data[targetIndex + 1] = g;
      imageData.data[targetIndex + 2] = encoding.startsWith('bgr') ? r : b;
      imageData.data[targetIndex + 3] = a;
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

const CameraComponent: React.FC<CameraComponentProps> = ({ config, ros, isEditing = false, scaleFactor = 1 }) => {
  const topicRef = useRef<Topic | null>(null);
  const action = config.action as ROSTopicConfig | undefined;
  const transport = config.config?.cameraTransport ?? 'proxy';
  const streamType = action?.messageType?.includes('CompressedImage') && (!config.config?.streamType || config.config.streamType === 'mjpeg')
    ? 'ros_compressed'
    : (config.config?.streamType ?? 'mjpeg');
  const streamWidth = config.config?.streamWidth;
  const streamHeight = config.config?.streamHeight;
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('No camera topic selected');

  useEffect(() => {
    setImageUrl(null);

    if (isEditing) {
      setStatus('Camera preview');
      return;
    }

    if (!action?.topic || !action.messageType) {
      setStatus('No camera topic selected');
      return;
    }

    if (transport === 'proxy') {
      setImageUrl(buildCameraStreamUrl({
        topic: action.topic,
        streamType,
        width: streamWidth,
        height: streamHeight,
      }));
      setStatus('');
      return;
    }

    if (!ros?.isConnected) {
      setStatus('Connecting...');
      return;
    }

    const topic = new ROSLIB.Topic({
      ros,
      name: action.topic,
      messageType: action.messageType,
    });

    topic.subscribe((message: any) => {
      if (!message?.data) {
        setStatus('Waiting for image data...');
        return;
      }

      const nextUrl = action.messageType.includes('CompressedImage')
        ? `data:${getImageMimeType(action.messageType, message.format)};base64,${arrayDataToBase64(message.data)}`
        : rawImageToDataUrl(message);

      if (!nextUrl) {
        setStatus('Unsupported image encoding');
        return;
      }

      setImageUrl(nextUrl);
      setStatus('');
    });

    topicRef.current = topic;
    setStatus('Waiting for image data...');

    return () => {
      topic.unsubscribe();
      topicRef.current = null;
    };
  }, [
    action?.topic,
    action?.messageType,
    isEditing,
    ros,
    ros?.isConnected,
    streamHeight,
    streamType,
    streamWidth,
    transport,
  ]);

  const fontSize = Math.max(10, Math.floor(12 * scaleFactor));

  return (
    <div className="data-display-component camera-pad-component" data-testid="camera-component">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`Camera stream ${action?.topic || ''}`}
          onError={() => setStatus('Failed to load camera stream')}
        />
      ) : (
        <div className="data-display-placeholder" style={{ fontSize }}>
          <span>Camera</span>
          <small>{status}</small>
        </div>
      )}
      {status && imageUrl && (
        <div className="data-display-status" style={{ fontSize: Math.max(9, fontSize - 2) }}>
          {status}
        </div>
      )}
    </div>
  );
};

export default CameraComponent;
