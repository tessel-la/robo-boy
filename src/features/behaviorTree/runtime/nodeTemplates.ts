import type { NativeNodeTemplate } from './types';

const leaf = (defaults: Record<string, string> = {}): NativeNodeTemplate => ({ defaults, children: 'none' });
const control = (defaults: Record<string, string> = {}): NativeNodeTemplate => ({ defaults, children: 'many' });
const decorator = (defaults: Record<string, string> = {}): NativeNodeTemplate => ({ defaults, children: 'one' });
const bridge = {
  Wait: leaf({ seconds: '0.5' }),
  RosAction: leaf({ action_name: '', action_type: '', goal_b64: 'e30=', timeout: '30', result: '{result}' }),
  JsonGet: leaf({ json: '{result}', field: '', value: '{value}' }),
  JsonSet: leaf({ json: '', field: '', value: 'true', result: '{result}' }),
  SubTree: leaf({ ID: '' }),
};

export const cppEditorNodes: Record<string, NativeNodeTemplate> = {
  Sequence: control(),
  SequenceWithMemory: control(),
  ReactiveSequence: control(),
  Fallback: control(),
  ReactiveFallback: control(),
  Parallel: control({ success_count: '-1', failure_count: '1' }),
  ParallelAll: control({ max_failures: '1' }),
  Inverter: decorator(),
  ForceSuccess: decorator(),
  ForceFailure: decorator(),
  RetryUntilSuccessful: decorator({ num_attempts: '3' }),
  Repeat: decorator({ num_cycles: '3' }),
  Timeout: decorator({ msec: '1000' }),
  Delay: decorator({ delay_msec: '1000' }),
  AlwaysSuccess: leaf(),
  AlwaysFailure: leaf(),
  ...bridge,
};
export const pythonEditorNodes: Record<string, NativeNodeTemplate> = {
  Sequence: control({ memory: 'true' }),
  Selector: control({ memory: 'true' }),
  Fallback: control({ memory: 'true' }),
  Parallel: control({ policy: 'success_on_all' }),
  Inverter: decorator(),
  SuccessIsFailure: decorator(),
  FailureIsSuccess: decorator(),
  RunningIsFailure: decorator(),
  RunningIsSuccess: decorator(),
  SuccessIsRunning: decorator(),
  FailureIsRunning: decorator(),
  Timeout: decorator({ duration: '1.0' }),
  Success: leaf(),
  Failure: leaf(),
  Running: leaf(),
  Dummy: leaf(),
  ...bridge,
};
