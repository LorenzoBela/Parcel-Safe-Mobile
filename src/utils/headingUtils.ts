/**
 * headingUtils — Shared heading smoothing utilities for the mobile app.
 *
 * Provides circular EMA, dead zone filtering, and angle arithmetic
 * that correctly handles the 360°/0° boundary.
 */

// Compute shortest angular difference, accounting for 360° wrap. Returns value in [-180, 180].
export function angleDiff(from: number, to: number): number {
    return ((to - from) % 360 + 540) % 360 - 180;
}

// Circular Exponential Moving Average for compass headings.
export function smoothHeading(current: number, target: number, alpha: number): number {
    const currRad = (current * Math.PI) / 180;
    const targRad = (target * Math.PI) / 180;

    const sinAvg = alpha * Math.sin(targRad) + (1 - alpha) * Math.sin(currRad);
    const cosAvg = alpha * Math.cos(targRad) + (1 - alpha) * Math.cos(currRad);

    let result = (Math.atan2(sinAvg, cosAvg) * 180) / Math.PI;
    if (result < 0) result += 360;
    return result;
}

// Returns true if the heading change exceeds the dead zone threshold.
export function exceededDeadZone(current: number, target: number, threshold: number = 3): boolean {
    return Math.abs(angleDiff(current, target)) >= threshold;
}

// Stateful heading smoother.
export function createHeadingSmoother(options?: {
    alpha?: number;
    deadZone?: number;
    speedThreshold?: number;
}) {
    const alpha = options?.alpha ?? 0.3;
    const deadZone = options?.deadZone ?? 3;
    const speedThreshold = options?.speedThreshold ?? 1.5;

    let current = 0;
    let initialized = false;

    return {
        update(rawHeading: number, speed?: number, compassHeading?: number | null): number {
            let targetHeading = rawHeading;

            // When stationary, freeze rotation or use compass heading if available
            if (speed != null && speed < speedThreshold) {
                if (compassHeading != null && compassHeading >= 0) {
                    targetHeading = compassHeading;
                } else {
                    return current;
                }
            }

            if (targetHeading < 0 || targetHeading >= 360) {
                return current;
            }

            if (!initialized) {
                current = targetHeading;
                initialized = true;
                return targetHeading;
            }

            if (!exceededDeadZone(current, targetHeading, deadZone)) {
                return current;
            }

            const effectiveAlpha = (speed != null && speed < 3) ? alpha * 0.5 : alpha;

            current = smoothHeading(current, targetHeading, effectiveAlpha);
            return current;
        },

        get current() { return current; },

        reset() {
            current = 0;
            initialized = false;
        },
    };
}
