export const NETWORK_POLICY = {
    TIMEOUTS_MS: {
        FIREBASE_WRITE: 10_000,
        RESUME_STAGE_SHORT: 1_200,
        RESUME_STAGE_AUTH: 1_000,
        DELIVERY_SYNC: 30_000,
    },
    RETRY: {
        BASE_MS: 1_000,
        MAX_ATTEMPTS: 5,
        JITTER_RATIO: 0.2,
    },
} as const;

export function getExponentialBackoffDelayMs(
    retryCount: number,
    baseMs: number = NETWORK_POLICY.RETRY.BASE_MS,
    maxAttempts: number = NETWORK_POLICY.RETRY.MAX_ATTEMPTS
): number {
    if (retryCount < 0) return baseMs;
    if (retryCount >= maxAttempts) return 0;
    return baseMs * Math.pow(2, retryCount);
}

export function applyJitter(delayMs: number, jitterRatio: number = NETWORK_POLICY.RETRY.JITTER_RATIO): number {
    if (delayMs <= 0) return 0;
    const boundedRatio = Math.max(0, Math.min(jitterRatio, 0.9));
    const min = delayMs * (1 - boundedRatio);
    const max = delayMs * (1 + boundedRatio);
    return Math.round(min + Math.random() * (max - min));
}
