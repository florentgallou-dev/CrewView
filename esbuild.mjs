// Build : extension + CLI (Node, CommonJS) et scène (navigateur, IIFE).
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

const builds = [
  {
    entryPoints: { extension: 'src/extension.ts', cli: 'src/cli.ts' },
    outdir: 'dist',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    sourcemap: true,
  },
  {
    entryPoints: { webview: 'src/webview/main.ts' },
    outdir: 'dist/media',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    sourcemap: true,
  },
];

mkdirSync('dist/media', { recursive: true });
copyFileSync('src/webview/style.css', 'dist/media/webview.css');

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
  console.log('esbuild : surveillance active');
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
  console.log('esbuild : build terminé');
}
