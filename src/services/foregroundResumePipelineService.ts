import { warmUpLocationServices, resetWarmup } from './gpsWarmupService';
import { supabase } from './supabaseClient';
import { flushQueuedBoxCommands } from './boxCommandQueueService';
import { updateBoxState } from './firebaseClient';
import { offlineQueueService } from './offlineQueueService';
import { recordResumeDiagnostic, recordResumeMarker } from './resumeDiagnosticsService';
import { statusUpdateService } from './statusUpdateService';
import { triggerDeliverySync } from './deliverySyncService';
import { NETWORK_POLICY } from './networkPolicy';
import { ensureOrderListenerHealthy, getOrderListenerDiagnostics } from './orderListenerService';
import useAuthStore from '../store/authStore';
import { captureHandledMessage } from './observability/sentryService';
import { runSelectiveReconnectInvalidation } from './queryClient';

export type ResumeTriggerSource =
    | 'app_state_active'
    | 'netinfo_restored'
    | 'resume_screen'
    | 'manual';

export type ResumeTriggerOutcome = 'started' | 'inflight_deduped' | 'cooldown_deduped';

const RESUME_TRIGGER_DEBOUNCE_MS = 2_500;

let activePipelinePromise: Promise<void> | null = null;
let activeBestEffortPipelinePromise: Promise<void> | null = null;
let activeRunId: string | null = null;
let lastRunStartedAt = 0;
let runSequence = 0;

function createRunId(source: ResumeTriggerSource): string {
    runSequence += 1;
    return `resume_${Date.now()}_${runSequence}_${source}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    return Promise.race([
        promise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
}

async function measureStage(
    name: string,
    runId: string,
    source: ResumeTriggerSource,
    fn: () => Promise<void>
): Promise<void> {
    const start = Date.now();
    try {
        await fn();
        await recordResumeDiagnostic({
            at: Date.now(),
            stage: name,
            durationMs: Date.now() - start,
            runId,
            source,
            meta: { ok: true },
        });
    } catch (error) {
        await recordResumeDiagnostic({
            at: Date.now(),
            stage: name,
            durationMs: Date.now() - start,
            runId,
            source,
            meta: { ok: false, error: String(error) },
        });
    }
}

function clearActiveRunIdIfIdle(): void {
    if (!activePipelinePromise && !activeBestEffortPipelinePromise) {
        activeRunId = null;
    }
}

interface ResumeHealthSnapshot {
    statusQueuePending: number;
    locationQueueDepth: number;
    locationQueueSyncing: boolean;
    locationQueueNextRetryInMs: number;
    orderListenerState: string;
    orderListenerActiveListeners: number;
    orderListenerCallbackCount: number;
}

async function collectResumeHealthSnapshot(): Promise<ResumeHealthSnapshot> {
    const statusQueuePending = await statusUpdateService.getPendingCount().catch(() => -1);
    const locationQueueSnapshot = offlineQueueService.getDiagnosticsSnapshot();
    const orderListenerSnapshot = getOrderListenerDiagnostics();

    return {
        statusQueuePending,
        locationQueueDepth: locationQueueSnapshot.queueDepth,
        locationQueueSyncing: locationQueueSnapshot.isSyncing,
        locationQueueNextRetryInMs: locationQueueSnapshot.nextRetryInMs,
        orderListenerState: orderListenerSnapshot.lifecycleState,
        orderListenerActiveListeners: orderListenerSnapshot.activeListenerCount,
        orderListenerCallbackCount: orderListenerSnapshot.callbackCount,
    };
}

function emitResumeHealthWarnings(snapshot: ResumeHealthSnapshot, runId: string, source: ResumeTriggerSource): void {
    if (snapshot.locationQueueDepth >= 20) {
        captureHandledMessage('resume_health_warning_location_queue_depth', {
            resume_run_id: runId,
            resume_source: source,
            queue_depth: String(snapshot.locationQueueDepth),
            status_queue_pending: String(snapshot.statusQueuePending),
        }, 'warning');
    }

    if (snapshot.statusQueuePending >= 5) {
        captureHandledMessage('resume_health_warning_status_queue_pending', {
            resume_run_id: runId,
            resume_source: source,
            status_queue_pending: String(snapshot.statusQueuePending),
        }, 'warning');
    }

    if (snapshot.orderListenerActiveListeners > 1) {
        captureHandledMessage('resume_health_warning_listener_fanout', {
            resume_run_id: runId,
            resume_source: source,
            listener_count: String(snapshot.orderListenerActiveListeners),
            listener_state: snapshot.orderListenerState,
        }, 'warning');
    }
}

async function runCriticalResumeStages(runId: string, source: ResumeTriggerSource): Promise<void> {
    // Stage 1: warmup GPS immediately (fire and cap)
    await measureStage('gps_warmup', runId, source, async () => {
        resetWarmup();
        await withTimeout(warmUpLocationServices(), NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_SHORT);
    });

    // Stage 2: quick auth/session refresh (non-blocking deadline)
    await measureStage('auth_refresh', runId, source, async () => {
        if (!supabase) return;
        await withTimeout(supabase.auth.getSession(), NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_AUTH);
    });

    // Stage 3: flush pending status updates first (logical source of delivery state)
    await measureStage('status_update_flush', runId, source, async () => {
        const result = await withTimeout(
            statusUpdateService.processQueue(),
            NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_SHORT
        );
        captureHandledMessage('resume_status_flush', {
            resume_run_id: runId,
            resume_source: source,
            queue_uuid: 'resume_batch',
            action_type: 'status_update',
            flush_stage: 'resume_foreground',
            idempotency_result: result ? `${result.success}_${result.failed}_${result.pending}` : 'timeout',
        });
    });
}

async function runBestEffortResumeStages(runId: string, source: ResumeTriggerSource): Promise<void> {
    // Stage 4: flush queued box commands
    await measureStage('box_command_flush', runId, source, async () => {
        const result = await withTimeout(
            flushQueuedBoxCommands(async (item) => {
                await updateBoxState(item.boxId, {
                    command: item.command,
                    command_request_id: item.requestId,
                    command_requested_by: item.requestedBy,
                } as any);
            }, 20),
            NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_SHORT
        );
        captureHandledMessage('resume_box_command_flush', {
            resume_run_id: runId,
            resume_source: source,
            queue_uuid: 'resume_batch',
            action_type: 'box_command',
            flush_stage: 'resume_foreground',
            idempotency_result: result ? `${result.sent}_${result.failed}` : 'timeout',
        });
    });

    // Stage 5: flush offline location queue
    await measureStage('location_queue_flush', runId, source, async () => {
        await withTimeout(offlineQueueService.processQueue(), NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_AUTH);
        captureHandledMessage('resume_location_flush', {
            resume_run_id: runId,
            resume_source: source,
            queue_uuid: 'resume_batch',
            action_type: 'location_update',
            flush_stage: 'resume_foreground',
            idempotency_result: 'attempted',
        });
    });

    // Stage 6: trigger delivery reconciliation sync
    await measureStage('delivery_sync_flush', runId, source, async () => {
        const result = await withTimeout(triggerDeliverySync(true), NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_SHORT);
        captureHandledMessage('resume_delivery_sync', {
            resume_run_id: runId,
            resume_source: source,
            queue_uuid: 'resume_batch',
            action_type: 'delivery_sync',
            flush_stage: 'resume_foreground',
            idempotency_result: result ? 'synced' : 'timeout_or_skipped',
        });
    });

    // Stage 7: ensure rider order listener is recovered after long background sessions
    await measureStage('order_listener_probe', runId, source, async () => {
        const authState = useAuthStore.getState() as any;
        const riderId = authState?.role === 'rider' ? authState?.user?.id : null;
        await withTimeout(ensureOrderListenerHealthy(riderId), NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_SHORT);
    });

    // Stage 8: selective react-query revalidation (avoid global reconnect storms)
    await measureStage('query_selective_revalidate', runId, source, async () => {
        await withTimeout(
            runSelectiveReconnectInvalidation(`resume_${source}`),
            NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_SHORT
        );
    });
}

async function executeForegroundResumePipeline(
    runId: string,
    source: ResumeTriggerSource,
    triggerMeta?: Record<string, unknown>
): Promise<void> {
    const healthSnapshot = await collectResumeHealthSnapshot();

    await recordResumeMarker('pipeline_start', {
        runId,
        source,
        meta: { startedAt: Date.now(), ...healthSnapshot, ...(triggerMeta ?? {}) },
    });

    emitResumeHealthWarnings(healthSnapshot, runId, source);

    await runCriticalResumeStages(runId, source);

    await recordResumeMarker('pipeline_critical_complete', {
        runId,
        source,
        meta: { at: Date.now() },
    });

    activeBestEffortPipelinePromise = runBestEffortResumeStages(runId, source)
        .catch(async (error) => {
            await recordResumeMarker('pipeline_best_effort_error', {
                runId,
                source,
                meta: { error: String(error) },
            });
        })
        .finally(async () => {
            await recordResumeMarker('pipeline_end', {
                runId,
                source,
                meta: { endedAt: Date.now() },
            });
            activeBestEffortPipelinePromise = null;
            clearActiveRunIdIfIdle();
        });
}

export async function triggerForegroundResumePipeline(
    source: ResumeTriggerSource,
    triggerMeta?: Record<string, unknown>
): Promise<{ runId: string | null; outcome: ResumeTriggerOutcome }> {
    const now = Date.now();

    if (activePipelinePromise || activeBestEffortPipelinePromise) {
        await recordResumeMarker('trigger_deduped_inflight', {
            runId: activeRunId ?? undefined,
            source,
            meta: {
                reason: 'pipeline_inflight',
                criticalInFlight: Boolean(activePipelinePromise),
                bestEffortInFlight: Boolean(activeBestEffortPipelinePromise),
                ...(triggerMeta ?? {}),
            },
        });
        return { runId: activeRunId, outcome: 'inflight_deduped' };
    }

    if (now - lastRunStartedAt < RESUME_TRIGGER_DEBOUNCE_MS) {
        await recordResumeMarker('trigger_deduped_cooldown', {
            source,
            meta: {
                reason: 'debounce_window',
                deltaMs: now - lastRunStartedAt,
                ...(triggerMeta ?? {}),
            },
        });
        return { runId: null, outcome: 'cooldown_deduped' };
    }

    const runId = createRunId(source);
    activeRunId = runId;
    lastRunStartedAt = now;

    activePipelinePromise = executeForegroundResumePipeline(runId, source, triggerMeta)
        .catch(async (error) => {
            await recordResumeMarker('pipeline_error', {
                runId,
                source,
                meta: { error: String(error) },
            });
            throw error;
        })
        .finally(() => {
            activePipelinePromise = null;
            clearActiveRunIdIfIdle();
        });

    await activePipelinePromise;
    return { runId, outcome: 'started' };
}

export async function runForegroundResumePipeline(): Promise<void> {
    await triggerForegroundResumePipeline('manual');
}
