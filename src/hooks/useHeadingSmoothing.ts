/**
 * useHeadingSmoothing — Circular EMA smoothing for GPS course-over-ground / compass headings.
 *
 * Handles 360°/0° wraparound correctly using sin/cos decomposition.
 * Designed for the Google Maps directional marker pattern:
 *   - Smooth rotation while moving
 *   - Freeze heading when stationary (speed < threshold)
 *   - Dead zone filter to suppress micro-jitter
 *
 * Usage:
 *   const smoother = useHeadingSmoothing();
 *   const heading = smoother.smooth(rawHeading, speed);
 *   <AnimatedRiderMarker rotation={heading} />
 */
import { useRef, useCallback } from 'react';

interface HeadingSmootherOptions {
    /** EMA weight: 0 = full smooth (laggy), 1 = raw. Default 0.3 */
    alpha?: number;
    /** Minimum degree change to trigger update. Default 3° */
    deadZone?: number;
    /** Speed (m/s) below which heading updates are frozen. Default 1.5 */
    speedThreshold?: number;
}

interface HeadingSmootherResult {
    /** Feed raw heading + optional speed + optional compass, returns smoothed heading in [0, 360) */
    smooth: (rawHeading: number, speed?: number, compassHeading?: number | null) => number;
    /** Current smoothed heading value */
    current: number;
    /** Reset smoother state */
    reset: () => void;
}

/**
 * Compute shortest angular difference, accounting for 360° wrap.
 * Returns value in [-180, 180].
 */
function angleDiff(from: number, to: number): number {
    let diff = ((to - from) % 360 + 540) % 360 - 180;
    return diff;
}

/**
 * Circular EMA:  decomposes angles into sin/cos to avoid the 359°→1° jump.
 */
function circularEMA(current: number, target: number, alpha: number): number {
    const currRad = (current * Math.PI) / 180;
    const targRad = (target * Math.PI) / 180;

    const sinAvg = alpha * Math.sin(targRad) + (1 - alpha) * Math.sin(currRad);
    const cosAvg = alpha * Math.cos(targRad) + (1 - alpha) * Math.cos(currRad);

    let result = (Math.atan2(sinAvg, cosAvg) * 180) / Math.PI;
    if (result < 0) result += 360;
    return result;
}

export function useHeadingSmoothing(options?: HeadingSmootherOptions): HeadingSmootherResult {
    const alpha = options?.alpha ?? 0.3;
    const deadZone = options?.deadZone ?? 3;
    const speedThreshold = options?.speedThreshold ?? 1.5;

    const currentHeading = useRef<number>(0);
    const initialized = useRef<boolean>(false);

    const smooth = useCallback((rawHeading: number, speed?: number, compassHeading?: number | null): number => {
        let targetHeading = rawHeading;

        // When stationary (speed < threshold), we normally freeze rotation.
        // However, if the device provides a compass heading, we use it instead!
        if (speed != null && speed < speedThreshold) {
            if (compassHeading != null && compassHeading >= 0) {
                targetHeading = compassHeading;
            } else {
                return currentHeading.current;
            }
        }

        // Invalid tracking heading (-1 = fallback) + moving fast enough = freeze
        if (targetHeading < 0 || targetHeading >= 360) {
            return currentHeading.current;
        }

        // First valid reading → initialize without smoothing
        if (!initialized.current) {
            currentHeading.current = targetHeading;
            initialized.current = true;
            return targetHeading;
        }

        // Dead zone: skip update if change is below threshold
        const diff = Math.abs(angleDiff(currentHeading.current, targetHeading));
        if (diff < deadZone) {
            return currentHeading.current;
        }

        // Speed-adaptive alpha: more smoothing at low speeds, or when using compass
        const effectiveAlpha = (speed != null && speed < 3) ? alpha * 0.5 : alpha;

        // Apply circular EMA
        currentHeading.current = circularEMA(currentHeading.current, targetHeading, effectiveAlpha);

        return currentHeading.current;
    }, [alpha, deadZone, speedThreshold]);

    const reset = useCallback(() => {
        currentHeading.current = 0;
        initialized.current = false;
    }, []);

    return {
        smooth,
        get current() { return currentHeading.current; },
        reset,
    };
}

export { angleDiff, circularEMA };
