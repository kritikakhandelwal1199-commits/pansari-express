// Bundles functions + workspace packages (@pansari/shared, @pansari/adapters,
// pdf-lib, qrcode) into deploy/index.js, and writes a clean deploy/package.json
// with only the runtime dependencies Google's build needs to install.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
mkdirSync('deploy', { recursive: true });

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'deploy/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});

writeFileSync(
  'deploy/package.json',
  JSON.stringify(
    {
      name: 'pansari-functions',
      private: true,
      type: 'module',
      main: 'index.js',
      engines: { node: '22' },
      dependencies: pkg.dependencies,
    },
    null,
    2,
  ) + '\n',
);
