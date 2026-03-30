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
import { createHeadingSmoother, angleDiff, smoothHeading as circularEMA } from '../utils/headingUtils';

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

export function useHeadingSmoothing(options?: HeadingSmootherOptions): HeadingSmootherResult {
    const smootherRef = useRef(createHeadingSmoother(options));

    const smooth = useCallback((rawHeading: number, speed?: number, compassHeading?: number | null): number => {
        return smootherRef.current.update(rawHeading, speed, compassHeading);
    }, []);

    const reset = useCallback(() => {
        smootherRef.current.reset();
    }, []);

    return {
        smooth,
        get current() { return smootherRef.current.current; },
        reset,
    };
}

export { angleDiff, circularEMA };
