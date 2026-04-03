export function generateQueueUuid(prefix: string): string {
    const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || 'queue';
    const rand = Math.random().toString(36).slice(2, 10);
    return `${safePrefix}_${Date.now()}_${rand}`;
}
