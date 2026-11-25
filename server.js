import { register } from 'tsx/esm/api';

register();

try {
  await import('./server.ts');
} catch (error) {
  console.error('[BOOTSTRAP] Failed to load server.ts:', error);
  process.exitCode = 1;
}
