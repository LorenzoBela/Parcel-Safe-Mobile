import { Platform } from 'react-native';
import { captureHandledError, captureHandledMessage } from './observability/sentryService';

let SQLite: typeof import('expo-sqlite') | null = null;
if (Platform.OS !== 'web') {
    try {
        SQLite = require('expo-sqlite');
    } catch {
        SQLite = null;
    }
}

type QueuedBoxCommand = {
    id: number;
    delivery_id: string;
    box_id: string;
    command: 'UNLOCKING' | 'LOCKED';
    request_id: string;
    requested_by: string;
    status: 'queued' | 'sent' | 'acked' | 'failed';
    attempt_count: number;
    created_at: number;
    next_retry_at?: number | null;
};

const RETRY_BACKOFF_MS = [2000, 5000, 10000, 20000, 40000, 60000];

function getNextRetryAt(attemptCount: number): number {
    const idx = Math.max(0, Math.min(attemptCount, RETRY_BACKOFF_MS.length - 1));
    return Date.now() + RETRY_BACKOFF_MS[idx];
}

let db: import('expo-sqlite').SQLiteDatabase | null = null;
let initialized = false;

function getDb(): import('expo-sqlite').SQLiteDatabase | null {
    if (!SQLite || Platform.OS === 'web') return null;
    if (!db) {
        db = SQLite.openDatabaseSync('smartbox_commands.db');
    }
    return db;
}

async function init(): Promise<void> {
    if (initialized) return;
    const database = getDb();
    if (!database) {
        initialized = true;
        return;
    }

    await database.execAsync(`
        CREATE TABLE IF NOT EXISTS box_command_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            delivery_id TEXT NOT NULL,
            box_id TEXT NOT NULL,
            command TEXT NOT NULL,
            request_id TEXT NOT NULL UNIQUE,
            requested_by TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            attempt_count INTEGER NOT NULL DEFAULT 0,
            next_retry_at INTEGER,
            last_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_attempt_at INTEGER,
            acked_at INTEGER,
            ack_status TEXT,
            ack_details TEXT,
            ack_command TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_box_command_queue_pending
        ON box_command_queue(status, created_at);
    `);

    initialized = true;
}

export async function enqueueBoxCommand(params: {
    deliveryId: string;
    boxId: string;
    command: 'UNLOCKING' | 'LOCKED';
    requestId: string;
    requestedBy: string;
}): Promise<void> {
    await init();
    const database = getDb();
    if (!database) return;

    const now = Date.now();
    await database.runAsync(
        `INSERT OR IGNORE INTO box_command_queue
         (delivery_id, box_id, command, request_id, requested_by, status, attempt_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
        [
            params.deliveryId,
            params.boxId,
            params.command,
            params.requestId,
            params.requestedBy,
            now,
            now,
        ]
    );

    captureHandledMessage('box_command_enqueued', {
        queue_uuid: params.requestId,
        action_type: 'box_command',
        flush_stage: 'enqueue',
        idempotency_result: 'queued_or_ignored',
    });
}

export async function flushQueuedBoxCommands(
    sender: (item: { boxId: string; command: 'UNLOCKING' | 'LOCKED'; requestId: string; requestedBy: string }) => Promise<void>,
    limit = 20
): Promise<{ sent: number; failed: number }> {
    await init();
    const database = getDb();
    if (!database) return { sent: 0, failed: 0 };

    const items = await database.getAllAsync<QueuedBoxCommand>(
        `SELECT id, delivery_id, box_id, command, request_id, requested_by, status, attempt_count, created_at
         FROM box_command_queue
         WHERE status = 'queued'
            OR (status = 'failed' AND (next_retry_at IS NULL OR next_retry_at <= ?))
         ORDER BY created_at ASC
         LIMIT ?`,
        [Date.now(), limit]
    );

    let sent = 0;
    let failed = 0;

    captureHandledMessage('box_command_flush_start', {
        queue_uuid: items.map((item) => item.request_id).join(','),
        action_type: 'box_command',
        flush_stage: 'flush_batch',
        idempotency_result: `batch_${items.length}`,
    });

    for (const item of items) {
        const now = Date.now();
        try {
            await sender({
                boxId: item.box_id,
                command: item.command,
                requestId: item.request_id,
                requestedBy: item.requested_by,
            });

            await database.runAsync(
                `UPDATE box_command_queue
                 SET status='sent',
                     attempt_count=attempt_count+1,
                     next_retry_at=NULL,
                     last_attempt_at=?,
                     updated_at=?
                 WHERE id=?`,
                [now, now, item.id]
            );
            captureHandledMessage('box_command_sent', {
                queue_uuid: item.request_id,
                action_type: 'box_command',
                flush_stage: 'flush_sent',
                idempotency_result: 'sent',
            });
            sent += 1;
        } catch (error) {
            await database.runAsync(
                `UPDATE box_command_queue
                 SET status='failed',
                     attempt_count=attempt_count+1,
                     next_retry_at=?,
                     last_attempt_at=?,
                     last_error=?,
                     updated_at=?
                 WHERE id=?`,
                [getNextRetryAt(item.attempt_count), now, String(error), now, item.id]
            );
            captureHandledError(error, {
                queue_uuid: item.request_id,
                action_type: 'box_command',
                flush_stage: 'flush_retry',
                idempotency_result: `attempt_${item.attempt_count + 1}`,
            });
            failed += 1;
        }
    }

    return { sent, failed };
}

export async function markLatestSentCommandAcked(params: {
    deliveryId: string;
    boxId: string;
    command: string;
    ackStatus?: string;
    ackDetails?: string;
}): Promise<void> {
    await init();
    const database = getDb();
    if (!database) return;

    const now = Date.now();
    await database.runAsync(
        `UPDATE box_command_queue
         SET status='acked',
             acked_at=?,
             ack_status=?,
             ack_details=?,
             ack_command=?,
             updated_at=?
         WHERE id = (
             SELECT id FROM box_command_queue
             WHERE delivery_id=?
               AND box_id=?
               AND command=?
               AND status IN ('sent', 'queued', 'failed')
             ORDER BY created_at DESC
             LIMIT 1
         )`,
        [
            now,
            params.ackStatus ?? null,
            params.ackDetails ?? null,
            params.command,
            now,
            params.deliveryId,
            params.boxId,
            params.command,
        ]
    );

    captureHandledMessage('box_command_acked', {
        queue_uuid: `${params.deliveryId}_${params.boxId}_${params.command}`,
        action_type: 'box_command_ack',
        flush_stage: 'ack',
        idempotency_result: params.ackStatus || 'acked',
    });
}
