import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { Topic, Ros } from 'roslib';
import ROSLIB from 'roslib';
import { throttle } from 'lodash-es';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';

interface SliderComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
}

const THROTTLE_INTERVAL = 100;

const SliderComponent: React.FC<SliderComponentProps> = ({ config, ros, isEditing }) => {
  const topicRef = useRef<Topic | null>(null);
  const [value, setValue] = useState(0);

  const publishMessage = useCallback((sliderValue: number) => {
    if (!topicRef.current || isEditing) return;

    const action = config.action as ROSTopicConfig;
    if (!action || !action.topic) return;

    let message: any;

    if (action.messageType === 'std_msgs/Float32') {
      message = new ROSLIB.Message({
        data: sliderValue
      });
    } else if (action.messageType === 'std_msgs/Int32') {
      message = new ROSLIB.Message({
        data: Math.round(sliderValue)
      });
    } else if (action.messageType === 'sensor_msgs/JointState') {
      message = new ROSLIB.Message({
        header: {
          stamp: { secs: 0, nsecs: 0 },
          frame_id: ''
        },
        name: [],
        position: [sliderValue],
        velocity: [],
        effort: []
      });
    }

    if (message) {
      topicRef.current.publish(message);
    }
  }, [config, isEditing]);

  const publishThrottled = useCallback(
    throttle(publishMessage, THROTTLE_INTERVAL, { leading: true, trailing: true }),
    [publishMessage]
  );

  useEffect(() => {
    if (!config.action || isEditing) return;

    const action = config.action as ROSTopicConfig;
    if (!action.topic || !action.messageType) return;

    topicRef.current = new ROSLIB.Topic({
      ros: ros,
      name: action.topic,
      messageType: action.messageType,
    });
    topicRef.current.advertise();

    return () => {
      topicRef.current?.unadvertise();
      topicRef.current = null;
    };
  }, [ros, config.action, isEditing]);

  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (isEditing) return;
    
    const newValue = parseFloat(event.target.value);
    setValue(newValue);
    publishThrottled(newValue);
  }, [publishThrottled, isEditing]);

  const min = config.config?.min ?? -1;
  const max = config.config?.max ?? 1;
  const step = config.config?.step ?? 0.1;
  const orientation = config.config?.orientation || 'horizontal';

  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: orientation === 'horizontal' ? 'column' : 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '8px',
    opacity: isEditing ? 0.7 : 1
  };

  const sliderStyle: React.CSSProperties = {
    width: orientation === 'horizontal' ? '100%' : '30px',
    height: orientation === 'horizontal' ? '8px' : '100%',
    appearance: 'none',
    backgroundColor: 'var(--secondary-color)',
    borderRadius: '4px',
    outline: 'none',
    cursor: isEditing ? 'default' : 'pointer',
    writingMode: orientation === 'vertical' ? 'bt-lr' : undefined,
    transform: orientation === 'vertical' ? 'rotate(-90deg)' : undefined
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '0.9em',
    fontWeight: 'bold',
    color: 'var(--text-color)',
    textAlign: 'center'
  };

  const valueStyle: React.CSSProperties = {
    fontSize: '0.8em',
    color: 'var(--text-color-secondary)',
    fontFamily: 'monospace'
  };

  return (
    <div className="slider-component" style={containerStyle}>
      {config.label && (
        <div style={labelStyle}>
          {config.label}
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        style={sliderStyle}
        disabled={isEditing}
      />
      <div style={valueStyle}>
        {value.toFixed(2)}
      </div>
    </div>
  );
};

export default SliderComponent; 