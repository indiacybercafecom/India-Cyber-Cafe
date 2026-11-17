import 'dotenv/config';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { recoverNotificationOutbox, getNotificationOutboxStats } from './src/server/emailNotificationService.js';
import {
  startAsyncWorkerLoop,
  shutdownAsyncWorkerLoop,
  recoverExpiredQueueLeases,
  getQueueStats,
} from './src/server/asyncQueueService.js';
import './src/server/operatorService.js';

const APP_ROOT = fs.existsSync(path.join(process.cwd(), 'package.json'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');
dotenv.config({ path: path.join(APP_ROOT, '.env'), quiet: true } as any);

const SWEEP_INTERVAL_MS = Math.max(500, Number(process.env.WORKER_SWEEP_INTERVAL_MS || '1500') || 1500);

console.log(`[WORKER] Starting standalone background worker (pid=${process.pid})...`);

try {
  const recoveredOutbox = recoverNotificationOutbox();
  const recoveredLeases = recoverExpiredQueueLeases();
  if (recoveredOutbox > 0 || recoveredLeases > 0) {
    console.log(`[WORKER] Startup recovery: outbox=${recoveredOutbox}, expiredQueueLeases=${recoveredLeases}`);
  }
} catch (err: any) {
  console.warn('[WORKER] Initial outbox recovery notice:', err?.message || err);
}

startAsyncWorkerLoop();

const outboxSweepTimer = setInterval(() => {
  try {
    recoverNotificationOutbox();
    recoverExpiredQueueLeases();
  } catch (err: any) {
    console.warn('[WORKER] Sweep notice:', err?.message || err);
  }
}, SWEEP_INTERVAL_MS);
if (typeof outboxSweepTimer.unref === 'function') outboxSweepTimer.unref();

console.log(`[WORKER] Active. Queue stats:`, JSON.stringify({
  queue: getQueueStats(),
  outbox: getNotificationOutboxStats(),
}));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[WORKER] Received ${signal}. Draining active jobs and releasing leases...`);
  clearInterval(outboxSweepTimer);
  await shutdownAsyncWorkerLoop(10000);
  console.log('[WORKER] Clean shutdown complete.');
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
