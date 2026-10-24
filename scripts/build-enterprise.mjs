import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createThirdPartyNotices } from './third-party-notices.mjs';

// Ship only the gateway's imports. Installing the root production dependency tree also ships
// browser-only ROS packages, including pngparse, whose license grant is unresolved.
await mkdir('dist-enterprise', { recursive: true });
const result = await build({
  entryPoints: ['infra/enterprise/gateway.mjs'],
  outfile: 'dist-enterprise/gateway.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: {
    js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);",
  },
  metafile: true,
});
const inputs = Object.keys(result.metafile.inputs);
await writeFile('dist-enterprise/licenses.txt', await createThirdPartyNotices(inputs));
