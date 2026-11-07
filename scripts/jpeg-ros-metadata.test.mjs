import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
test('producer adds exact ROS metadata without altering decoded JPEG pixels; invalid headers remain untagged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'roboboy-jpeg-metadata-'));
  try {
    const input = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#123456' } }).jpeg().toBuffer();
    await writeFile(join(dir, 'input.jpg'), input);
    await writeFile(join(dir, 'test.cpp'), `
#include "infra/ros/jpeg_ros_metadata.hpp"
#include <fstream>
#include <iterator>
#include <cassert>
int main(int argc, char** argv) {
  std::ifstream source(argv[1], std::ios::binary);
  std::vector<uint8_t> jpeg((std::istreambuf_iterator<char>(source)), {});
  const auto original = jpeg;
  roboboy::add_ros_metadata(jpeg, 1, 1000000000, "optical", 16, 12); assert(jpeg == original);
  roboboy::add_ros_metadata(jpeg, -1, 0, "optical", 16, 12); assert(jpeg == original);
  roboboy::add_ros_metadata(jpeg, 1, 0, "bad\\r\\nframe", 16, 12); assert(jpeg == original);
  roboboy::add_ros_metadata(jpeg, 1792928097, 123456789, "camera_optical", 1280, 720);
  std::ofstream out(argv[2], std::ios::binary); out.write(reinterpret_cast<const char*>(jpeg.data()), jpeg.size());
}`);
    const compile = spawnSync('g++', ['-std=c++14', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-I', root, join(dir, 'test.cpp'), '-o', join(dir, 'test')], { encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stderr || compile.error?.message);
    const run = spawnSync(join(dir, 'test'), [join(dir, 'input.jpg'), join(dir, 'output.jpg')]);
    assert.equal(run.status, 0, run.stderr?.toString());
    const output = await readFile(join(dir, 'output.jpg'));
    assert.equal(output.toString('ascii', 6, 14), 'RBROS001');
    assert.equal(output.readUInt32BE(14), 1792928097);
    assert.equal(output.readUInt32BE(18), 123456789);
    assert.equal(output.readUInt32BE(22), 1280);
    assert.equal(output.readUInt32BE(26), 720);
    assert.equal(output.toString('utf8', 30, 2 + 2 + output.readUInt16BE(4)), 'camera_optical');
    assert.deepEqual(await sharp(output).raw().toBuffer(), await sharp(input).raw().toBuffer());
    assert.equal((await sharp(output).metadata()).width, 16);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
