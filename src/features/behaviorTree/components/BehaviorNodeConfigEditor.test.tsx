import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BehaviorNodeType, type BehaviorTreeNode } from '../types';
import BehaviorNodeConfigEditor from './BehaviorNodeConfigEditor';

const renderEditor = (node: BehaviorTreeNode) => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <BehaviorNodeConfigEditor
      node={node}
      blackboardVariables={['enabled', 'speed']}
      onSave={onSave}
      onClose={onClose}
    />
  );
  return { onSave, onClose };
};

const node = (type: BehaviorNodeType, data: BehaviorTreeNode['data']): BehaviorTreeNode => ({
  id: `${type}-node`,
  type,
  position: { x: 0, y: 0 },
  data,
});

describe('BehaviorNodeConfigEditor', () => {
  it('validates and saves timeout settings', () => {
    const { onSave, onClose } = renderEditor(node(BehaviorNodeType.Timeout, { label: 'Deadline', timeout: 500 }));
    const timeout = screen.getByLabelText('Timeout (ms)');

    fireEvent.change(timeout, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Timeout must be positive.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(timeout, { target: { value: '1250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ timeout: 1250 }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('edits an if/else comparison and closes from the backdrop', () => {
    const { onSave, onClose } = renderEditor(
      node(BehaviorNodeType.IfElse, {
        label: 'Choose branch',
        variable: 'enabled',
        operator: 'truthy',
      })
    );

    fireEvent.change(screen.getByLabelText('Blackboard variable'), { target: { value: 'speed' } });
    fireEvent.change(screen.getByLabelText('Comparison'), { target: { value: 'greaterThan' } });
    fireEvent.change(screen.getByLabelText('Expected JSON value'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        variable: 'speed',
        operator: 'greaterThan',
        expectedValue: 2.5,
      })
    );

    fireEvent.click(document.querySelector('.ape-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('parses publisher payloads and blackboard input bindings', () => {
    const { onSave } = renderEditor(
      node(BehaviorNodeType.Topic, {
        label: 'Publisher',
        topicName: '/cmd_vel',
        messageType: 'geometry_msgs/msg/Twist',
        message: { linear: { x: 1 } },
        inputBindings: [{ targetPath: 'linear.x', variable: 'speed' }],
      })
    );

    fireEvent.change(screen.getByLabelText('Message JSON'), { target: { value: '{"linear":{"x":2}}' } });
    fireEvent.change(screen.getByLabelText('Frequency (Hz, empty for once)'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Duration (ms, 0 for continuous)'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('Target path = variable'), {
      target: { value: 'linear.x=speed\ninvalid\nangular.z = enabled' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        message: { linear: { x: 2 } },
        frequencyHz: 5,
        durationMs: 3000,
        inputBindings: [
          { targetPath: 'linear.x', variable: 'speed' },
          { targetPath: 'angular.z', variable: 'enabled' },
        ],
      })
    );
  });

  it('reports invalid publisher JSON', () => {
    const { onSave } = renderEditor(
      node(BehaviorNodeType.Topic, {
        label: 'Publisher',
        topicName: '/value',
        messageType: 'std_msgs/msg/String',
        message: {},
      })
    );
    fireEvent.change(screen.getByLabelText('Message JSON'), { target: { value: '{' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(document.querySelector('.ape-json-error')).toHaveTextContent('JSON');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('requires and saves subscriber output mappings', () => {
    const { onSave } = renderEditor(
      node(BehaviorNodeType.Subscriber, {
        label: 'Subscriber',
        topicName: '/status',
        messageType: 'example/msg/Status',
        timeout: 10000,
        outputBindings: [],
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Add at least one message-path mapping.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Timeout (ms)'), { target: { value: '2500' } });
    fireEvent.change(screen.getByLabelText('Source path = variable'), { target: { value: 'data.ready=enabled' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 2500,
        outputBindings: [{ sourcePath: 'data.ready', variable: 'enabled' }],
      })
    );
  });

  it('supports the close and cancel controls', () => {
    const { onClose } = renderEditor(node(BehaviorNodeType.Timeout, { label: 'Deadline', timeout: 100 }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
