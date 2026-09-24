import { assert, test } from 'vitest';
import { DEFAULT_CONFIG, getDesiredSources, sanitizeConfig, sourceKey } from './config.ts';

test('migrates the existing single-topic workspace without losing fields or plot settings', () => {
  const migrated = sanitizeConfig({
    schemaVersion: 2,
    topic: '/joint_states',
    messageType: 'sensor_msgs/msg/JointState',
    fieldPaths: ['position[0]', 'velocity[0]'],
    timeWindowSec: 30,
    sampleLimit: 2400,
    throttleMs: 50,
    autoScale: false,
    minY: -2,
    maxY: 2,
    showPoints: true,
  });
  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(
    migrated.series.map(series => series.fieldPath),
    ['position[0]', 'velocity[0]']
  );
  assert.ok(migrated.series.every(series => series.enabled && series.filter.type === 'raw'));
  assert.equal(migrated.timeWindowSec, 30);
  assert.equal(migrated.sampleLimit, 2400);
  assert.equal(migrated.autoScale, false);
  assert.deepEqual([migrated.minY, migrated.maxY, migrated.showPoints], [-2, 2, true]);
});

test('preserves an auto-detect placeholder for a legacy topic with no chosen fields', () => {
  const migrated = sanitizeConfig({
    schemaVersion: 2,
    topic: '/temperature',
    messageType: 'std_msgs/msg/Float64',
    fieldPaths: [],
  });
  assert.equal(migrated.series.length, 1);
  assert.equal(migrated.series[0].fieldPath, '');
});

test('retains the released schema-v2 fields and removes v1 auto-selected timestamp noise', () => {
  const v2 = sanitizeConfig({
    schemaVersion: 2,
    topic: '/state',
    messageType: 'State',
    fieldPaths: ['header.stamp.sec', 'value'],
  });
  assert.deepEqual(
    v2.series.map(series => series.fieldPath),
    ['header.stamp.sec', 'value']
  );

  const v1 = sanitizeConfig({
    schemaVersion: 1,
    topic: '/state',
    messageType: 'State',
    fieldPaths: ['header.stamp.sec', 'header.stamp.nanosec', 'value'],
  });
  assert.deepEqual(
    v1.series.map(series => series.fieldPath),
    ['value']
  );
});

test('sanitizes and round-trips saved multi-series filter and visibility settings', () => {
  const saved = sanitizeConfig({
    ...DEFAULT_CONFIG,
    schemaVersion: 3,
    renderFps: 30,
    series: [
      {
        id: 'arm-position',
        topic: '/arm/state',
        messageType: 'example/Arm',
        fieldPath: 'position',
        enabled: true,
        label: 'Arm',
        unit: 'rad',
        color: '#123abc',
        filter: { type: 'movingAverage', window: 12 },
      },
      {
        id: 'battery',
        topic: '/battery',
        messageType: 'example/Battery',
        fieldPath: 'voltage',
        enabled: false,
        label: 'Battery',
        unit: 'V',
        color: '#ffb454',
        filter: { type: 'ema', alpha: 0.15 },
      },
    ],
  });
  const reopened = sanitizeConfig(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(reopened, saved);
  assert.deepEqual(
    getDesiredSources(reopened).map(source => source.key),
    [sourceKey('/arm/state', 'example/Arm')]
  );
});

test('groups enabled fields from one topic into one source and excludes disabled topics', () => {
  const config = sanitizeConfig({
    ...DEFAULT_CONFIG,
    schemaVersion: 3,
    series: [
      { id: 'x', topic: '/pose', messageType: 'Pose', fieldPath: 'x', enabled: true },
      { id: 'y', topic: '/pose', messageType: 'Pose', fieldPath: 'y', enabled: true },
      { id: 'z', topic: '/other', messageType: 'Pose', fieldPath: 'z', enabled: false },
    ],
  });
  assert.deepEqual(
    getDesiredSources(config).map(source => source.topic),
    ['/pose']
  );
});
