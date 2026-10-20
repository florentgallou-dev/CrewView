// Compile les tests TypeScript avec esbuild puis les exécute avec le runner natif de Node.
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const entryPoints = readdirSync('test').filter((f) => f.endsWith('.test.ts')).map((f) => `test/${f}`);
await esbuild.build({ entryPoints, outdir: 'dist/test', bundle: true, platform: 'node', format: 'cjs', target: 'node18', logLevel: 'warning' });
const files = entryPoints.map((f) => f.replace(/^test\//, 'dist/test/').replace(/\.ts$/, '.js'));
const { status } = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(status ?? 1);
