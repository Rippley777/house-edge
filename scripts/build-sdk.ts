import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await fs.mkdir('apps/dashboard/public', { recursive: true });
await build({ entryPoints: ['packages/sdk-browser/src/script.ts'], outfile: 'apps/dashboard/public/house-edge.js', bundle: true, minify: true, sourcemap: true, format: 'iife', target: 'es2020' });
await build({ entryPoints: ['packages/sdk-browser/src/index.ts'], outfile: 'packages/sdk-browser/dist/index.js', bundle: true, minify: true, format: 'esm', target: 'es2020' });
await build({ entryPoints: ['packages/sdk-node/src/index.ts'], outfile: 'packages/sdk-node/dist/index.js', bundle: true, format: 'esm', platform: 'node', target: 'node20' });
for (const pkg of ['sdk-browser', 'sdk-node']) execFileSync('npx', ['tsc', `packages/${pkg}/src/index.ts`, '--declaration', '--emitDeclarationOnly', '--outDir', `packages/${pkg}/dist`, '--moduleResolution', 'bundler', '--module', 'esnext', '--target', 'es2022', '--skipLibCheck'], { stdio: 'inherit' });
console.log('Browser SDK, script embed, and Node SDK built.');
