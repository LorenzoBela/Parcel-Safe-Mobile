import { warmUpLocationServices, resetWarmup } from './gpsWarmupService';
import { supabase } from './supabaseClient';
import { flushQueuedBoxCommands } from './boxCommandQueueService';
import { updateBoxState } from './firebaseClient';
import { offlineQueueService } from './offlineQueueService';
import { recordResumeDiagnostic } from './resumeDiagnosticsService';
import { statusUpdateService } from './statusUpdateService';
import { triggerDeliverySync } from './deliverySyncService';
import { NETWORK_POLICY } from './networkPolicy';
import { ensureOrderListenerHealthy } from './orderListenerService';
import useAuthStore from '../store/authStore';
import { captureHandledMessage } from './observability/sentryService';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    return Promise.race([
        promise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
}

async function measureStage(name: string, fn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    try {
        await fn();
        await recordResumeDiagnostic({
            at: Date.now(),
            stage: name,
            durationMs: Date.now() - start,
            meta: { ok: true },
        });
    } catch (error) {
        await recordResumeDiagnostic({
            at: Date.now(),
            stage: name,
            durationMs: Date.now() - start,
            meta: { ok: false, error: String(error) },
        });
    }
}

export async function runForegroundResumePipeline(): Promise<void> {
    // Stage 1: warmup GPS immediately (fire and cap)
    await measureStage('gps_warmup', async () => {
        resetWarmup();
        await withTimeout(warmUpLocationServices(), NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_SHORT);
    });

    // Stage 2: quick auth/session refresh (non-blocking deadline)
    await measureStage('auth_refresh', async () => {
        if (!supabase) return;
        await withTimeout(supabase.auth.getSession(), NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_AUTH);
    });

    // Stage 3: flush pending status updates first (logical source of delivery state)
    await measureStage('status_update_flush', async () => {
        const result = await withTimeout(
            statusUpdateService.processQueue(),
            NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_SHORT
        );
        captureHandledMessage('resume_status_flush', {
            queue_uuid: 'resume_batch',
            action_type: 'status_update',
            flush_stage: 'resume_foreground',
            idempotency_result: result ? `${result.success}_${result.failed}_${result.pending}` : 'timeout',
        });
    });

    // Stage 4: flush queued box commands
    await measureStage('box_command_flush', async () => {
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
            queue_uuid: 'resume_batch',
            action_type: 'box_command',
            flush_stage: 'resume_foreground',
            idempotency_result: result ? `${result.sent}_${result.failed}` : 'timeout',
        });
    });

    // Stage 5: flush offline location queue
    await measureStage('location_queue_flush', async () => {
        await withTimeout(offlineQueueService.processQueue(), NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_AUTH);
        captureHandledMessage('resume_location_flush', {
            queue_uuid: 'resume_batch',
            action_type: 'location_update',
            flush_stage: 'resume_foreground',
            idempotency_result: 'attempted',
        });
    });

    // Stage 6: trigger delivery reconciliation sync
    await measureStage('delivery_sync_flush', async () => {
        const result = await withTimeout(triggerDeliverySync(true), NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_SHORT);
        captureHandledMessage('resume_delivery_sync', {
            queue_uuid: 'resume_batch',
            action_type: 'delivery_sync',
            flush_stage: 'resume_foreground',
            idempotency_result: result ? 'synced' : 'timeout_or_skipped',
        });
    });

    // Stage 7: ensure rider order listener is recovered after long background sessions
    await measureStage('order_listener_probe', async () => {
        const authState = useAuthStore.getState() as any;
        const riderId = authState?.role === 'rider' ? authState?.user?.id : null;
        await withTimeout(ensureOrderListenerHealthy(riderId), NETWORK_POLICY.TIMEOUTS_MS.RESUME_STAGE_SHORT);
    });
}
