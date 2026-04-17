/**
 * Canonical fare pricing — mobile side.
 *
 * Mirrors `web/src/lib/pricingService.ts`. The shipping plan chose the
 * mobile formula as the canonical one, so this file is the original — the
 * web module was back-ported from here. Kept as an independent file (as
 * opposed to a shared npm package) because the monorepo does not yet have
 * a shared-lib build step; the formula constants are simple enough that a
 * drift check at review time is sufficient.
 */

export const PRICING = {
    BASE_FARE: 50,
    PER_KM: 15,
    PER_MIN: 2,
    CURRENCY: 'PHP',
} as const;

export interface FareBreakdown {
    base: number;
    distance: number;
    time: number;
    promo: number;
    total: number;
    currency: string;
}

export function calculateFare(distanceKm: number, durationMin: number): FareBreakdown {
    const safeDistance = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
    const safeDuration = Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 0;

    const base = PRICING.BASE_FARE;
    const distance = safeDistance * PRICING.PER_KM;
    const time = safeDuration * PRICING.PER_MIN;
    const total = Math.max(0, Math.round(base + distance + time));

    return { base, distance, time, promo: 0, total, currency: PRICING.CURRENCY };
}

/** Shape returned by GET /api/pricing/rates */
export interface RateInfo {
    baseFare: number;
    perKm: number;
    perMin: number;
    currency: string;
    formula: string;
}

/**
 * Fetch canonical rates from the server. Falls back to local constants if
 * the network call fails so the UI never shows blank copy on a cold start
 * with flaky connectivity.
 */
export async function fetchRates(apiBaseUrl: string, signal?: AbortSignal): Promise<RateInfo> {
    try {
        const res = await fetch(`${apiBaseUrl}/api/pricing/rates`, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as RateInfo;
    } catch {
        return {
            baseFare: PRICING.BASE_FARE,
            perKm: PRICING.PER_KM,
            perMin: PRICING.PER_MIN,
            currency: PRICING.CURRENCY,
            formula: 'round(base + km * perKm + min * perMin)',
        };
    }
}
