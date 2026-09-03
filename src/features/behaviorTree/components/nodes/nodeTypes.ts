import { NodeTypes } from 'reactflow';
import ActionNode from './ActionNode';
import ServiceNode from './ServiceNode';
import TopicNode from './TopicNode';
import SequenceNode from './SequenceNode';
import SelectorNode from './SelectorNode';
import ParallelNode from './ParallelNode';
import RetryNode from './RetryNode';
import RepeatNode from './RepeatNode';
import SubtreeNode from './SubtreeNode';
import TimeoutNode from './TimeoutNode';
import IfElseNode from './IfElseNode';
import SubscriberNode from './SubscriberNode';

export const nodeTypes: NodeTypes = {
  action: ActionNode,
  service: ServiceNode,
  topic: TopicNode,
  sequence: SequenceNode,
  selector: SelectorNode,
  parallel: ParallelNode,
  retry: RetryNode,
  repeat: RepeatNode,
  subtree: SubtreeNode,
  timeout: TimeoutNode,
  ifElse: IfElseNode,
  subscriber: SubscriberNode,
};
