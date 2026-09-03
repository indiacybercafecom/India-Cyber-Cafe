import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const distIndex = path.resolve(process.cwd(), 'dist', 'index.html');

if (!fs.existsSync(distIndex)) {
	console.log('[BUILD] dist/index.html not found. Building before starting the server...');
	execFileSync(process.execPath, [path.resolve(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build'], {
		stdio: 'inherit',
		env: process.env,
	});
}

await import('tsx/esm');
await import('./server.ts');