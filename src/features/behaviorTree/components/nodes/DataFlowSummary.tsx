import React from 'react';
import { BlackboardInputBinding, BlackboardOutputBinding } from '../../types';

interface Props {
  inputs?: BlackboardInputBinding[];
  outputs?: BlackboardOutputBinding[];
}

const DataFlowSummary: React.FC<Props> = ({ inputs = [], outputs = [] }) => {
  if (!inputs.length && !outputs.length) return null;
  const items = [
    ...inputs.map(binding => ({ direction: 'in', variable: binding.variable })),
    ...outputs.map(binding => ({ direction: 'out', variable: binding.variable })),
  ];
  return (
    <div
      className="bt-data-flow"
      title={items.map(item => `${item.direction === 'in' ? 'read' : 'write'} ${item.variable}`).join(', ')}
    >
      {items.slice(0, 2).map((item, index) => (
        <span className={item.direction} key={`${item.direction}-${item.variable}-${index}`}>
          <i aria-hidden="true" />
          {item.direction === 'in' ? '←' : '→'} {item.variable}
        </span>
      ))}
      {items.length > 2 && <b>+{items.length - 2}</b>}
    </div>
  );
};

export default DataFlowSummary;
