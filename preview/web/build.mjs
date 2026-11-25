// Builds a single-file, demo-mode preview of the web app (for sharing as an artifact).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../../apps/web');
const out = resolve(here, 'dist');
mkdirSync(out, { recursive: true });

const router = resolve(here, 'router.tsx');
await build({
  entryPoints: [resolve(here, 'entry.tsx')],
  outfile: resolve(out, 'app.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  tsconfig: resolve(web, 'tsconfig.json'),
  alias: { 'next/link': router, 'next/navigation': router },
  define: { 'process.env.NEXT_PUBLIC_DATA_MODE': '"demo"', 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
  logOverride: { 'unsupported-directive': 'silent' },
});

execFileSync(resolve(here, '../../node_modules/.bin/tailwindcss'), ['-i', resolve(here, 'input.css'), '-o', resolve(out, 'app.css'), '--minify'], { cwd: here, stdio: 'inherit' });

const js = readFileSync(resolve(out, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(resolve(out, 'app.css'), 'utf8');
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pansari Phase 3 preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Yatra+One&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body class="min-h-dvh antialiased">
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;
writeFileSync(resolve(out, 'index.html'), html);
console.log('preview built:', (html.length / 1024).toFixed(0), 'KB');
