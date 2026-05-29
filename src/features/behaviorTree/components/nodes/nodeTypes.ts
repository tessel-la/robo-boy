import { NodeTypes } from 'reactflow';
import ActionNode from './ActionNode';
import ServiceNode from './ServiceNode';
import TopicNode from './TopicNode';
import SequenceNode from './SequenceNode';
import SelectorNode from './SelectorNode';
import ParallelNode from './ParallelNode';

export const nodeTypes: NodeTypes = {
  action: ActionNode,
  service: ServiceNode,
  topic: TopicNode,
  sequence: SequenceNode,
  selector: SelectorNode,
  parallel: ParallelNode,
};

