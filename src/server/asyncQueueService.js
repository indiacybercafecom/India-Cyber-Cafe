import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
const APP_ROOT = fs.existsSync(path.join(process.cwd(), 'package.json'))
    ? process.cwd()
    : path.resolve(process.cwd(), '..');
const LOCAL_QUEUE_PATH = path.join(APP_ROOT, 'data/async_queue_jobs.json');
const LOCAL_DLQ_PATH = path.join(APP_ROOT, 'data/async_queue_dlq.json');
const isTestMode = () => process.env.STORE_ORDER_TEST_MODE === '1' ||
    process.env.OPERATOR_TEST_MODE === '1';
const WORKER_ID = `worker-${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
const DEFAULT_CONCURRENCY = Math.max(1, Math.min(32, Number(process.env.WORKER_CONCURRENCY || '6') || 6));
const DEFAULT_LEASE_MS = Math.max(5000, Number(process.env.QUEUE_LEASE_MS || '30000') || 30000);
const DEFAULT_POLL_INTERVAL_MS = Math.max(250, Number(process.env.QUEUE_POLL_INTERVAL_MS || '1000') || 1000);
const processors = new Map();
const memoryJobs = new Map();
const memoryDlq = new Map();
const idempotencyJobIndex = new Map(); // idempotencyKey -> jobId
const processingDurations = [];
let memoryHydrated = false;
let workerLoopTimer = null;
let pumpRunning = false;
let pumpRequested = false;
let activeWorkers = 0;
let isShuttingDown = false;
let enqueuedTotal = 0;
let processedTotal = 0;
let retriedTotal = 0;
let queueFlushTimer = null;
let queueWriting = false;
let queueDirty = false;
let rtdbQueueUsableCache = { usable: false, expiresAt: 0 };
let rtdbQueueProbeInFlight = null;
export function getQueueDriver() {
    const configured = (process.env.QUEUE_DRIVER || '').trim().toLowerCase();
    if (configured === 'cloud_tasks' || configured === 'pubsub' || configured === 'rtdb' || configured === 'local') {
        if (isTestMode())
            return 'local';
        return configured;
    }
    if (!isTestMode() && getApps().length > 0 && process.env.QUEUE_USE_RTDB === '1') {
        return 'rtdb';
    }
    return 'local';
}
async function isQueueRtdbUsable() {
    if (isTestMode() || getApps().length === 0)
        return false;
    const now = Date.now();
    if (rtdbQueueUsableCache.expiresAt > now) {
        return rtdbQueueUsableCache.usable;
    }
    if (rtdbQueueProbeInFlight) {
        return rtdbQueueProbeInFlight;
    }
    rtdbQueueProbeInFlight = (async () => {
        try {
            const db = getDatabase(getApps()[0]);
            await Promise.race([
                db.ref('asyncQueue/jobs').limitToFirst(1).once('value'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('RTDB queue probe timeout')), 2000)),
            ]);
            rtdbQueueUsableCache = { usable: true, expiresAt: Date.now() + 30000 };
            return true;
        }
        catch {
            rtdbQueueUsableCache = { usable: false, expiresAt: Date.now() + 15000 };
            return false;
        }
        finally {
            rtdbQueueProbeInFlight = null;
        }
    })();
    return rtdbQueueProbeInFlight;
}
export function registerQueueProcessor(kind, handler) {
    processors.set(kind, handler);
}
export function clearQueueProcessorsForTesting() {
    processors.clear();
}
function recordDuration(ms) {
    processingDurations.push(Math.max(0, ms));
    if (processingDurations.length > 500) {
        processingDurations.splice(0, processingDurations.length - 500);
    }
}
function computeLatencyPercentiles() {
    if (processingDurations.length === 0)
        return { avg: 0, p95: 0 };
    const sorted = [...processingDurations].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return {
        avg: Math.round(sum / sorted.length),
        p95: Math.round(sorted[p95Index]),
    };
}
function buildQueueSnapshots() {
    const sortedJobs = Array.from(memoryJobs.entries())
        .sort((a, b) => new Date(b[1].createdAt || 0).getTime() - new Date(a[1].createdAt || 0).getTime())
        .slice(0, 1000);
    const sortedDlq = Array.from(memoryDlq.entries())
        .sort((a, b) => new Date(b[1].updatedAt || 0).getTime() - new Date(a[1].updatedAt || 0).getTime())
        .slice(0, 500);
    return {
        jobsObj: Object.fromEntries(sortedJobs),
        dlqObj: Object.fromEntries(sortedDlq),
    };
}
function writeJsonAtomic(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}
async function writeJsonAtomicAsync(filePath, data) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.promises.rename(tmpPath, filePath);
}
function readLocalStore(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return parsed && typeof parsed === 'object' ? parsed : {};
        }
    }
    catch { }
    return {};
}
function hydrateLocalQueue(force = false) {
    if (memoryHydrated && !force)
        return;
    const jobs = readLocalStore(LOCAL_QUEUE_PATH);
    const dlq = readLocalStore(LOCAL_DLQ_PATH);
    memoryJobs.clear();
    memoryDlq.clear();
    idempotencyJobIndex.clear();
    for (const [id, job] of Object.entries(jobs)) {
        if (!job || typeof job !== 'object')
            continue;
        memoryJobs.set(id, job);
        if (job.idempotencyKey) {
            idempotencyJobIndex.set(`${job.kind}:${job.idempotencyKey}`, id);
        }
    }
    for (const [id, job] of Object.entries(dlq)) {
        if (!job || typeof job !== 'object')
            continue;
        memoryDlq.set(id, job);
        if (job.idempotencyKey) {
            idempotencyJobIndex.set(`${job.kind}:${job.idempotencyKey}`, id);
        }
    }
    memoryHydrated = true;
}
export async function flushLocalQueueToDisk() {
    if (queueWriting) {
        queueDirty = true;
        return;
    }
    queueDirty = false;
    queueWriting = true;
    try {
        const { jobsObj, dlqObj } = buildQueueSnapshots();
        await Promise.all([
            writeJsonAtomicAsync(LOCAL_QUEUE_PATH, jobsObj),
            writeJsonAtomicAsync(LOCAL_DLQ_PATH, dlqObj),
        ]);
    }
    catch (err) {
        console.warn('[asyncQueueService] Async local persistence warning:', err?.message || err);
    }
    finally {
        queueWriting = false;
        if (queueDirty && !isShuttingDown) {
            scheduleLocalQueueFlush();
        }
    }
}
function scheduleLocalQueueFlush() {
    queueDirty = true;
    if (queueFlushTimer)
        return;
    queueFlushTimer = setTimeout(() => {
        queueFlushTimer = null;
        void flushLocalQueueToDisk();
    }, 120);
    if (typeof queueFlushTimer.unref === 'function')
        queueFlushTimer.unref();
}
function persistLocalQueue(immediateSync = false) {
    try {
        if (immediateSync || isTestMode()) {
            const { jobsObj, dlqObj } = buildQueueSnapshots();
            writeJsonAtomic(LOCAL_QUEUE_PATH, jobsObj);
            writeJsonAtomic(LOCAL_DLQ_PATH, dlqObj);
            return;
        }
        scheduleLocalQueueFlush();
    }
    catch (err) {
        console.warn('[asyncQueueService] Local persistence warning:', err?.message || err);
    }
}
async function persistRtdbJob(job) {
    if (!(await isQueueRtdbUsable()))
        return;
    try {
        const db = getDatabase(getApps()[0]);
        const sanitized = JSON.parse(JSON.stringify(job));
        await Promise.race([
            db.ref(`asyncQueue/jobs/${job.jobId}`).set(sanitized),
            new Promise((_, reject) => setTimeout(() => reject(new Error('RTDB queue write timeout')), 3000)),
        ]);
        if (job.state === 'dlq') {
            await Promise.race([
                db.ref(`asyncQueue/dlq/${job.jobId}`).set(sanitized),
                new Promise((_, reject) => setTimeout(() => reject(new Error('RTDB DLQ write timeout')), 3000)),
            ]);
        }
    }
    catch { }
}
/**
 * Optional distributed Cloud Tasks / PubSub push dispatcher when configured in Cloud Run / Kubernetes.
 */
async function dispatchToExternalBrokerIfConfigured(job) {
    const driver = getQueueDriver();
    if (driver === 'local' || driver === 'rtdb')
        return false;
    const handlerUrl = (process.env.CLOUD_TASKS_HANDLER_URL || '').trim();
    const workerSecret = (process.env.INTERNAL_WORKER_SECRET || '').trim();
    if (!handlerUrl)
        return false;
    try {
        // Obtain GCP metadata token cleanly when running on GCP Compute / Cloud Run
        let accessToken = (process.env.GCP_ACCESS_TOKEN || '').trim();
        if (!accessToken) {
            try {
                const metaResp = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
                    headers: { 'Metadata-Flavor': 'Google' },
                    signal: AbortSignal.timeout(1500),
                });
                if (metaResp.ok) {
                    const metaData = await metaResp.json();
                    accessToken = metaData?.access_token || '';
                }
            }
            catch { }
        }
        if (!accessToken)
            return false;
        if (driver === 'cloud_tasks') {
            const queuePath = (process.env.CLOUD_TASKS_QUEUE_PATH || '').trim();
            if (!queuePath)
                return false;
            const bodyPayload = Buffer.from(JSON.stringify({ jobId: job.jobId, job })).toString('base64');
            const taskReq = {
                task: {
                    httpRequest: {
                        httpMethod: 'POST',
                        url: handlerUrl,
                        headers: {
                            'Content-Type': 'application/json',
                            ...(workerSecret ? { 'X-Worker-Secret': workerSecret } : {}),
                        },
                        body: bodyPayload,
                    },
                },
            };
            if (job.nextAttemptAt > Date.now() + 1000) {
                taskReq.task.scheduleTime = new Date(job.nextAttemptAt).toISOString();
            }
            const resp = await fetch(`https://cloudtasks.googleapis.com/v2/${queuePath}/tasks`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(taskReq),
                signal: AbortSignal.timeout(4000),
            });
            return resp.ok;
        }
        if (driver === 'pubsub') {
            const topicPath = (process.env.PUBSUB_TOPIC_PATH || '').trim();
            if (!topicPath)
                return false;
            const resp = await fetch(`https://pubsub.googleapis.com/v1/${topicPath}:publish`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: [
                        {
                            data: Buffer.from(JSON.stringify({ jobId: job.jobId, job })).toString('base64'),
                            attributes: {
                                kind: job.kind,
                                idempotencyKey: job.idempotencyKey,
                            },
                        },
                    ],
                }),
                signal: AbortSignal.timeout(4000),
            });
            return resp.ok;
        }
    }
    catch (err) {
        console.warn(`[asyncQueueService] External broker dispatch (${driver}) fallback to durable local/RTDB:`, err?.message || err);
    }
    return false;
}
export function enqueueAsyncJob(input) {
    hydrateLocalQueue();
    const dedupKey = `${input.kind}:${input.idempotencyKey}`;
    const existingId = idempotencyJobIndex.get(dedupKey);
    if (existingId) {
        const existing = memoryJobs.get(existingId) || memoryDlq.get(existingId);
        if (existing && (existing.state === 'queued' || existing.state === 'processing' || existing.state === 'completed')) {
            return existing;
        }
    }
    const now = new Date().toISOString();
    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const job = {
        jobId,
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        payload: input.payload,
        ...(input.appId ? { appId: input.appId } : {}),
        ...(input.orderId ? { orderId: input.orderId } : {}),
        ...(input.ticketId ? { ticketId: input.ticketId } : {}),
        state: 'queued',
        attempts: 0,
        maxAttempts: Math.max(1, Math.min(10, Number(input.maxAttempts || 5))),
        nextAttemptAt: Date.now() + Math.max(0, Number(input.delayMs || 0)),
        leaseOwner: null,
        leaseExpiresAt: null,
        createdAt: now,
        updatedAt: now,
    };
    memoryJobs.set(jobId, job);
    idempotencyJobIndex.set(dedupKey, jobId);
    enqueuedTotal += 1;
    persistLocalQueue();
    // Fire-and-forget RTDB mirror & external broker push if configured (non-blocking)
    void persistRtdbJob(job);
    void dispatchToExternalBrokerIfConfigured(job).then((dispatched) => {
        if (!dispatched && process.env.DISABLE_EMBEDDED_WORKER !== '1' && !isShuttingDown) {
            queueMicrotask(() => {
                void pumpAsyncQueue();
            });
        }
    });
    return job;
}
async function claimRtdbDueJobs(limit) {
    if (getQueueDriver() !== 'rtdb' || !(await isQueueRtdbUsable())) {
        return [];
    }
    const claimed = [];
    const db = getDatabase(getApps()[0]);
    const now = Date.now();
    try {
        const [queuedSnap, procSnap] = await Promise.all([
            Promise.race([
                db.ref('asyncQueue/jobs').orderByChild('state').equalTo('queued').limitToFirst(Math.max(limit * 3, 18)).once('value'),
                new Promise(resolve => setTimeout(() => resolve(null), 2500)),
            ]),
            Promise.race([
                db.ref('asyncQueue/jobs').orderByChild('state').equalTo('processing').limitToFirst(Math.max(limit * 2, 12)).once('value'),
                new Promise(resolve => setTimeout(() => resolve(null), 2500)),
            ]),
        ]);
        const candidates = [];
        if (queuedSnap && queuedSnap.exists?.()) {
            for (const val of Object.values(queuedSnap.val() || {})) {
                if (val && (val.nextAttemptAt || 0) <= now)
                    candidates.push(val);
            }
        }
        if (procSnap && procSnap.exists?.()) {
            for (const val of Object.values(procSnap.val() || {})) {
                if (val && typeof val.leaseExpiresAt === 'number' && val.leaseExpiresAt > 0 && val.leaseExpiresAt <= now) {
                    candidates.push(val);
                }
            }
        }
        for (const candidate of candidates) {
            if (claimed.length >= limit)
                break;
            if (!candidate?.jobId)
                continue;
            const txn = await db.ref(`asyncQueue/jobs/${candidate.jobId}`).transaction((current) => {
                if (!current || typeof current !== 'object')
                    return;
                const t = Date.now();
                const isQueued = current.state === 'queued' && (current.nextAttemptAt || 0) <= t;
                const isExpired = current.state === 'processing' &&
                    typeof current.leaseExpiresAt === 'number' &&
                    current.leaseExpiresAt > 0 &&
                    current.leaseExpiresAt <= t;
                if (!isQueued && !isExpired)
                    return;
                return {
                    ...current,
                    state: 'processing',
                    leaseOwner: WORKER_ID,
                    leaseExpiresAt: t + DEFAULT_LEASE_MS,
                    updatedAt: new Date().toISOString(),
                };
            });
            if (txn.committed && txn.snapshot.exists()) {
                const claimedJob = txn.snapshot.val();
                memoryJobs.set(claimedJob.jobId, claimedJob);
                if (claimedJob.idempotencyKey) {
                    idempotencyJobIndex.set(`${claimedJob.kind}:${claimedJob.idempotencyKey}`, claimedJob.jobId);
                }
                claimed.push(claimedJob);
            }
        }
    }
    catch (err) {
        console.warn('[asyncQueueService] RTDB distributed claim notice:', err?.message || err);
    }
    return claimed;
}
/**
 * Atomic lease acquisition supporting crashed-worker recovery:
 * any processing job whose lease expired is automatically reclaimable.
 */
function claimDueJobs(limit) {
    hydrateLocalQueue();
    const now = Date.now();
    const claimed = [];
    for (const job of memoryJobs.values()) {
        if (claimed.length >= limit)
            break;
        const isQueuedDue = job.state === 'queued' && (job.nextAttemptAt || 0) <= now;
        const isExpiredLease = job.state === 'processing' &&
            typeof job.leaseExpiresAt === 'number' &&
            job.leaseExpiresAt > 0 &&
            job.leaseExpiresAt <= now;
        if (!isQueuedDue && !isExpiredLease)
            continue;
        job.state = 'processing';
        job.leaseOwner = WORKER_ID;
        job.leaseExpiresAt = now + DEFAULT_LEASE_MS;
        job.updatedAt = new Date().toISOString();
        claimed.push(job);
    }
    if (claimed.length > 0) {
        persistLocalQueue();
    }
    return claimed;
}
async function runSingleJob(job) {
    const startedAt = Date.now();
    activeWorkers += 1;
    // Periodic lease heartbeat keeps long-running jobs owned until completion
    const heartbeatIntervalMs = Math.max(2000, Math.floor(DEFAULT_LEASE_MS / 3));
    const heartbeatTimer = setInterval(() => {
        if (job.state === 'processing' && job.leaseOwner === WORKER_ID && !isShuttingDown) {
            job.leaseExpiresAt = Date.now() + DEFAULT_LEASE_MS;
            job.updatedAt = new Date().toISOString();
            if (getQueueDriver() === 'rtdb') {
                void isQueueRtdbUsable().then(usable => {
                    if (usable && job.state === 'processing' && job.leaseOwner === WORKER_ID) {
                        void getDatabase(getApps()[0])
                            .ref(`asyncQueue/jobs/${job.jobId}`)
                            .update({ leaseExpiresAt: job.leaseExpiresAt, updatedAt: job.updatedAt })
                            .catch(() => { });
                    }
                });
            }
        }
    }, heartbeatIntervalMs);
    if (typeof heartbeatTimer.unref === 'function')
        heartbeatTimer.unref();
    try {
        const processor = processors.get(job.kind);
        if (!processor) {
            throw new Error(`No async queue processor registered for job kind "${job.kind}"`);
        }
        job.attempts += 1;
        job.updatedAt = new Date().toISOString();
        const result = await processor(job);
        if (result.report !== undefined) {
            job.report = result.report;
        }
        if (result.ok) {
            job.state = 'completed';
            job.completedAt = new Date().toISOString();
            job.leaseOwner = null;
            job.leaseExpiresAt = null;
            job.lastError = undefined;
            processedTotal += 1;
        }
        else {
            const retryable = result.retryable !== false && job.attempts < job.maxAttempts;
            job.lastError = result.error || 'Job handler reported failure';
            job.leaseOwner = null;
            job.leaseExpiresAt = null;
            if (retryable) {
                const backoffMs = Math.min(60000, 1000 * Math.pow(2, Math.max(0, job.attempts - 1)));
                const jitter = Math.floor(Math.random() * 250);
                job.state = 'queued';
                job.nextAttemptAt = Date.now() + backoffMs + jitter;
                retriedTotal += 1;
            }
            else {
                job.state = 'dlq';
                memoryJobs.delete(job.jobId);
                memoryDlq.set(job.jobId, { ...job });
                processedTotal += 1;
            }
        }
    }
    catch (err) {
        const msg = err?.message || String(err);
        job.lastError = msg;
        job.leaseOwner = null;
        job.leaseExpiresAt = null;
        if (job.attempts < job.maxAttempts) {
            const backoffMs = Math.min(60000, 1000 * Math.pow(2, Math.max(0, job.attempts - 1)));
            const jitter = Math.floor(Math.random() * 250);
            job.state = 'queued';
            job.nextAttemptAt = Date.now() + backoffMs + jitter;
            retriedTotal += 1;
        }
        else {
            job.state = 'dlq';
            memoryJobs.delete(job.jobId);
            memoryDlq.set(job.jobId, { ...job });
            processedTotal += 1;
        }
    }
    finally {
        clearInterval(heartbeatTimer);
        activeWorkers = Math.max(0, activeWorkers - 1);
        job.updatedAt = new Date().toISOString();
        recordDuration(Date.now() - startedAt);
        persistLocalQueue();
        void persistRtdbJob(job);
    }
}
export async function processPushWorkerJob(jobPayload) {
    hydrateLocalQueue();
    let job = memoryJobs.get(jobPayload.jobId) || memoryDlq.get(jobPayload.jobId);
    if (!job) {
        job = { ...jobPayload, state: 'processing', leaseOwner: WORKER_ID, leaseExpiresAt: Date.now() + DEFAULT_LEASE_MS };
        memoryJobs.set(job.jobId, job);
    }
    else if (job.state === 'completed') {
        return { ok: true, job };
    }
    else {
        job.state = 'processing';
        job.leaseOwner = WORKER_ID;
        job.leaseExpiresAt = Date.now() + DEFAULT_LEASE_MS;
    }
    await runSingleJob(job);
    return { ok: job.state === 'completed', job, error: job.lastError };
}
export async function pumpAsyncQueue(forceDue = false) {
    if (isShuttingDown)
        return 0;
    if (pumpRunning) {
        pumpRequested = true;
        return 0;
    }
    pumpRunning = true;
    let count = 0;
    try {
        do {
            pumpRequested = false;
            hydrateLocalQueue();
            if (forceDue) {
                const now = Date.now();
                for (const job of memoryJobs.values()) {
                    if (job.state === 'queued') {
                        job.nextAttemptAt = Math.min(job.nextAttemptAt || now, now);
                    }
                }
            }
            const availableSlots = Math.max(0, DEFAULT_CONCURRENCY - activeWorkers);
            if (availableSlots <= 0)
                break;
            let batch = claimDueJobs(availableSlots);
            if (batch.length < availableSlots && getQueueDriver() === 'rtdb') {
                const localClaimedIds = new Set(batch.map(b => b.jobId));
                const rtdbClaimed = await claimRtdbDueJobs(availableSlots - batch.length);
                for (const rJob of rtdbClaimed) {
                    if (!localClaimedIds.has(rJob.jobId)) {
                        batch.push(rJob);
                    }
                }
            }
            if (batch.length === 0)
                break;
            count += batch.length;
            await Promise.allSettled(batch.map(job => runSingleJob(job)));
        } while (pumpRequested || (forceDue && Array.from(memoryJobs.values()).some(j => j.state === 'queued')));
    }
    finally {
        pumpRunning = false;
    }
    return count;
}
export async function flushAsyncQueueForTesting() {
    hydrateLocalQueue();
    for (let pass = 0; pass < 10; pass++) {
        const queuedOrProcessing = Array.from(memoryJobs.values()).filter(j => j.state === 'queued' || j.state === 'processing');
        if (queuedOrProcessing.length === 0 && activeWorkers === 0)
            break;
        // Make retries immediate during test flush
        const now = Date.now();
        for (const j of memoryJobs.values()) {
            if (j.state === 'queued')
                j.nextAttemptAt = now;
        }
        await pumpAsyncQueue(true);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return [
        ...Array.from(memoryJobs.values()),
        ...Array.from(memoryDlq.values()).map(j => ({ ...j, state: j.state })),
    ];
}
export function recoverExpiredQueueLeases() {
    hydrateLocalQueue(false);
    let recovered = 0;
    const now = Date.now();
    for (const job of memoryJobs.values()) {
        const isExpired = typeof job.leaseExpiresAt !== 'number' || job.leaseExpiresAt <= now;
        if (job.state === 'processing' && isExpired) {
            job.state = 'queued';
            job.leaseOwner = null;
            job.leaseExpiresAt = null;
            job.nextAttemptAt = now;
            job.updatedAt = new Date().toISOString();
            recovered += 1;
        }
    }
    if (recovered > 0) {
        persistLocalQueue();
        if (process.env.DISABLE_EMBEDDED_WORKER !== '1' && !isShuttingDown) {
            queueMicrotask(() => void pumpAsyncQueue());
        }
    }
    return recovered;
}
export function startAsyncWorkerLoop() {
    if (workerLoopTimer || isShuttingDown)
        return;
    recoverExpiredQueueLeases();
    workerLoopTimer = setInterval(() => {
        if (!isShuttingDown) {
            void pumpAsyncQueue(false);
        }
    }, DEFAULT_POLL_INTERVAL_MS);
    if (workerLoopTimer.unref)
        workerLoopTimer.unref();
}
export async function shutdownAsyncWorkerLoop(timeoutMs = 8000) {
    isShuttingDown = true;
    if (workerLoopTimer) {
        clearInterval(workerLoopTimer);
        workerLoopTimer = null;
    }
    if (queueFlushTimer) {
        clearTimeout(queueFlushTimer);
        queueFlushTimer = null;
    }
    const deadline = Date.now() + timeoutMs;
    while (activeWorkers > 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    // Release any leases still held by this dying worker so peers can immediately reclaim them
    hydrateLocalQueue();
    for (const job of memoryJobs.values()) {
        if (job.state === 'processing' && job.leaseOwner === WORKER_ID) {
            job.state = 'queued';
            job.leaseOwner = null;
            job.leaseExpiresAt = null;
            job.nextAttemptAt = Date.now();
        }
    }
    persistLocalQueue(true);
}
export function getDlqJobs(limit = 50) {
    hydrateLocalQueue();
    return Array.from(memoryDlq.values())
        .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
        .slice(0, Math.max(1, limit));
}
export async function replayDlqJob(jobId) {
    hydrateLocalQueue();
    const dlqJob = memoryDlq.get(jobId);
    if (!dlqJob)
        return { found: false };
    memoryDlq.delete(jobId);
    const replayed = {
        ...dlqJob,
        state: 'queued',
        attempts: 0,
        nextAttemptAt: Date.now(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: undefined,
        updatedAt: new Date().toISOString(),
    };
    memoryJobs.set(jobId, replayed);
    persistLocalQueue();
    void persistRtdbJob(replayed);
    await pumpAsyncQueue(true);
    return { found: true, job: memoryJobs.get(jobId) || memoryDlq.get(jobId) || replayed };
}
export function getQueueStats() {
    hydrateLocalQueue();
    let queuedCount = 0;
    let processingCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    for (const job of memoryJobs.values()) {
        if (job.state === 'queued')
            queuedCount++;
        else if (job.state === 'processing')
            processingCount++;
        else if (job.state === 'completed')
            completedCount++;
        else
            failedCount++;
    }
    const { avg, p95 } = computeLatencyPercentiles();
    return {
        driver: getQueueDriver(),
        workerId: WORKER_ID,
        embeddedWorkerEnabled: process.env.DISABLE_EMBEDDED_WORKER !== '1',
        activeWorkers,
        concurrency: DEFAULT_CONCURRENCY,
        queuedCount,
        processingCount,
        completedCount,
        failedCount,
        dlqCount: memoryDlq.size,
        enqueuedTotal,
        processedTotal,
        retriedTotal,
        avgProcessingMs: avg,
        p95ProcessingMs: p95,
    };
}
export function getAllQueueJobsForTesting() {
    hydrateLocalQueue();
    return [...Array.from(memoryJobs.values()), ...Array.from(memoryDlq.values())];
}
export function resetAsyncQueueForTesting() {
    memoryJobs.clear();
    memoryDlq.clear();
    idempotencyJobIndex.clear();
    processingDurations.length = 0;
    enqueuedTotal = 0;
    processedTotal = 0;
    retriedTotal = 0;
    isShuttingDown = false;
    memoryHydrated = true;
    if (isTestMode()) {
        try {
            if (fs.existsSync(LOCAL_QUEUE_PATH))
                fs.unlinkSync(LOCAL_QUEUE_PATH);
            if (fs.existsSync(LOCAL_DLQ_PATH))
                fs.unlinkSync(LOCAL_DLQ_PATH);
        }
        catch { }
    }
}
