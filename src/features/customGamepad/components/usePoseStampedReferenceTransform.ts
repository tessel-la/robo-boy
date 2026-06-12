import { useEffect, useRef } from 'react';
import type { Ros, Topic } from 'roslib';
import ROSLIB from 'roslib';
import type { GamepadComponentConfig } from '../types';
import type { OdometryLikeMessage, TransformLike } from '../rosMessageUtils';
import { lookupTfTransform, TfGraph, TfMessageLike, updateTfGraph } from '../poseStampedTf';

export function usePoseStampedReferenceTransform(
  ros: Ros,
  config: GamepadComponentConfig,
  isEditing = false
) {
  const tfTopicRef = useRef<Topic | null>(null);
  const tfStaticTopicRef = useRef<Topic | null>(null);
  const odometryTopicRef = useRef<Topic | null>(null);
  const latestTransformRef = useRef<TransformLike | null>(null);
  const latestOdometryRef = useRef<OdometryLikeMessage | null>(null);

  useEffect(() => {
    latestTransformRef.current = null;

    const outputFrame = config.config?.poseStampedFrameId?.trim();
    const referenceFrame = config.config?.poseStampedReferenceFrameId?.trim();
    const shouldUseTf = config.config?.poseStampedReferenceMode === 'tf'
      && !!outputFrame
      && !!referenceFrame
      && !isEditing;

    if (!shouldUseTf || !outputFrame || !referenceFrame) return;

    const graph: TfGraph = new Map();
    const updateTransform = (message: TfMessageLike, isStatic: boolean) => {
      updateTfGraph(graph, message, isStatic);
      latestTransformRef.current = lookupTfTransform(graph, outputFrame, referenceFrame);
    };
    const tfTopic = new ROSLIB.Topic({
      ros,
      name: '/tf',
      messageType: 'tf2_msgs/TFMessage',
      queue_size: 10,
      throttle_rate: 0,
    });
    const tfStaticTopic = new ROSLIB.Topic({
      ros,
      name: '/tf_static',
      messageType: 'tf2_msgs/TFMessage',
      queue_size: 10,
      throttle_rate: 0,
    });
    const handleTf = (message: TfMessageLike) => updateTransform(message, false);
    const handleTfStatic = (message: TfMessageLike) => updateTransform(message, true);
    tfTopic.subscribe(handleTf);
    tfStaticTopic.subscribe(handleTfStatic);
    tfTopicRef.current = tfTopic;
    tfStaticTopicRef.current = tfStaticTopic;

    return () => {
      tfTopic.unsubscribe();
      tfStaticTopic.unsubscribe();
      tfTopicRef.current = null;
      tfStaticTopicRef.current = null;
      latestTransformRef.current = null;
    };
  }, [config.config?.poseStampedFrameId, config.config?.poseStampedReferenceFrameId,
    config.config?.poseStampedReferenceMode, isEditing, ros]);

  useEffect(() => {
    latestOdometryRef.current = null;

    const odometryTopic = config.config?.poseStampedOdometryTopic?.trim();
    const shouldUseOdometry = config.config?.poseStampedReferenceMode === 'odometry'
      && !!odometryTopic
      && !isEditing;

    if (!shouldUseOdometry || !odometryTopic) return;

    const topic = new ROSLIB.Topic({
      ros,
      name: odometryTopic,
      messageType: config.config?.poseStampedOdometryMessageType || 'nav_msgs/Odometry',
    });
    topic.subscribe((message: OdometryLikeMessage) => {
      latestOdometryRef.current = message;
    });
    odometryTopicRef.current = topic;

    return () => {
      topic.unsubscribe();
      odometryTopicRef.current = null;
      latestOdometryRef.current = null;
    };
  }, [config.config?.poseStampedOdometryMessageType, config.config?.poseStampedOdometryTopic,
    config.config?.poseStampedReferenceMode, isEditing, ros]);

  return { latestTransformRef, latestOdometryRef };
}
