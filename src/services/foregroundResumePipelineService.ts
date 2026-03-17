import { warmUpLocationServices, resetWarmup } from './gpsWarmupService';
import { supabase } from './supabaseClient';
import { flushQueuedBoxCommands } from './boxCommandQueueService';
import { updateBoxState } from './firebaseClient';
import { offlineQueueService } from './offlineQueueService';
import { recordResumeDiagnostic } from './resumeDiagnosticsService';

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
        await withTimeout(warmUpLocationServices(), 1200);
    });

    // Stage 2: quick auth/session refresh (non-blocking deadline)
    await measureStage('auth_refresh', async () => {
        if (!supabase) return;
        await withTimeout(supabase.auth.getSession(), 1000);
    });

    // Stage 3: flush queued box commands
    await measureStage('box_command_flush', async () => {
        await withTimeout(
            flushQueuedBoxCommands(async (item) => {
                await updateBoxState(item.boxId, {
                    command: item.command,
                    command_request_id: item.requestId,
                    command_requested_by: item.requestedBy,
                } as any);
            }, 20),
            1200
        );
    });

    // Stage 4: flush offline location queue
    await measureStage('location_queue_flush', async () => {
        await withTimeout(offlineQueueService.processQueue(), 1000);
    });
}
