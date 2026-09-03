import path from 'node:path';
import { execFileSync } from 'node:child_process';

console.log('[BUILD] Building the Vite frontend before starting the server...');
execFileSync(process.execPath, [path.resolve(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build'], {
	stdio: 'inherit',
	env: process.env,
});

await import('tsx/esm');
await import('./server.ts');