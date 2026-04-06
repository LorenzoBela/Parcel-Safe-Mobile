import AsyncStorage from '@react-native-async-storage/async-storage';

const DIAG_KEY = 'resume_diagnostics_v1';
const MAX_ENTRIES = 120;

export interface ResumeDiagnosticEntry {
    at: number;
    stage: string;
    durationMs: number;
    runId?: string;
    source?: string;
    meta?: Record<string, unknown>;
}

export async function recordResumeDiagnostic(entry: ResumeDiagnosticEntry): Promise<void> {
    try {
        const raw = await AsyncStorage.getItem(DIAG_KEY);
        const parsed: ResumeDiagnosticEntry[] = raw ? JSON.parse(raw) : [];
        parsed.unshift(entry);
        const trimmed = parsed.slice(0, MAX_ENTRIES);
        await AsyncStorage.setItem(DIAG_KEY, JSON.stringify(trimmed));
    } catch (error) {
        console.warn('[ResumeDiag] Failed to record diagnostic:', error);
    }
}

export async function getRecentResumeDiagnostics(limit = 20): Promise<ResumeDiagnosticEntry[]> {
    try {
        const raw = await AsyncStorage.getItem(DIAG_KEY);
        const parsed: ResumeDiagnosticEntry[] = raw ? JSON.parse(raw) : [];
        return parsed.slice(0, limit);
    } catch {
        return [];
    }
}

export async function recordResumeMarker(
    stage: string,
    options?: { runId?: string; source?: string; meta?: Record<string, unknown> }
): Promise<void> {
    await recordResumeDiagnostic({
        at: Date.now(),
        stage,
        durationMs: 0,
        runId: options?.runId,
        source: options?.source,
        meta: options?.meta,
    });
}
