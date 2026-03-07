/**
 * useEntryAnimation.ts
 * Lightweight, premium animation hooks — uses React Native's built-in Animated API.
 * All animations use useNativeDriver: true to run on the UI thread.
 */
import { useRef, useEffect } from 'react';
import { Animated } from 'react-native';

// ─── Entry Animation (fade + slide-up) ──────────────────────────────────────
// Returns an animated style that fades in and translates from Y+12 to Y+0.
export function useEntryAnimation(delay = 0, duration = 280) {
    const opacity = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(12)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(opacity, {
                toValue: 1,
                duration,
                delay,
                useNativeDriver: true,
            }),
            Animated.timing(translateY, {
                toValue: 0,
                duration,
                delay,
                useNativeDriver: true,
            }),
        ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        style: { opacity, transform: [{ translateY }] },
    };
}

// ─── Stagger Animation ───────────────────────────────────────────────────────
// Returns an array of animated styles, each delayed by `itemDelay` ms more.
// Cap at `count` items; items beyond cap get opacity 1 instantly (no perf hit).
export function useStaggerAnimation(count: number, itemDelay = 50, baseDelay = 0, duration = 260) {
    const anims = useRef(
        Array.from({ length: count }, () => ({
            opacity: new Animated.Value(0),
            translateY: new Animated.Value(10),
        }))
    ).current;

    useEffect(() => {
        const animations = anims.map((anim, i) =>
            Animated.parallel([
                Animated.timing(anim.opacity, {
                    toValue: 1,
                    duration,
                    delay: baseDelay + i * itemDelay,
                    useNativeDriver: true,
                }),
                Animated.timing(anim.translateY, {
                    toValue: 0,
                    duration,
                    delay: baseDelay + i * itemDelay,
                    useNativeDriver: true,
                }),
            ])
        );
        Animated.parallel(animations).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return anims.map((anim) => ({
        style: { opacity: anim.opacity, transform: [{ translateY: anim.translateY }] },
    }));
}

// ─── Shake Animation ─────────────────────────────────────────────────────────
// Call triggerShake() to animate a horizontal shake (e.g. wrong OTP entry).
export function useShakeAnimation() {
    const translateX = useRef(new Animated.Value(0)).current;

    const triggerShake = () => {
        Animated.sequence([
            Animated.timing(translateX, { toValue: -8, duration: 50, useNativeDriver: true }),
            Animated.timing(translateX, { toValue: 8, duration: 50, useNativeDriver: true }),
            Animated.timing(translateX, { toValue: -6, duration: 50, useNativeDriver: true }),
            Animated.timing(translateX, { toValue: 6, duration: 50, useNativeDriver: true }),
            Animated.timing(translateX, { toValue: -3, duration: 40, useNativeDriver: true }),
            Animated.timing(translateX, { toValue: 0, duration: 40, useNativeDriver: true }),
        ]).start();
    };

    return {
        style: { transform: [{ translateX }] },
        triggerShake,
    };
}

// ─── Pulse Animation (looping opacity) ───────────────────────────────────────
// Returns a looping opacity pulse style (for loading states, critical alerts, etc.)
export function usePulseAnimation(minOpacity = 0.4, duration = 900) {
    const opacity = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, {
                    toValue: minOpacity,
                    duration,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 1,
                    duration,
                    useNativeDriver: true,
                }),
            ])
        );
        pulse.start();
        return () => pulse.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { style: { opacity } };
}

// ─── Scale Pop Animation ──────────────────────────────────────────────────────
// Plays once on mount: scale 0.6 → 1.1 → 1.0 (success / completion pop).
export function useScalePopAnimation(delay = 0) {
    const scale = useRef(new Animated.Value(0.6)).current;

    useEffect(() => {
        Animated.sequence([
            Animated.timing(scale, { toValue: 1.1, duration: 240, delay, useNativeDriver: true }),
            Animated.spring(scale, { toValue: 1.0, useNativeDriver: true, bounciness: 6, speed: 14 }),
        ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { style: { transform: [{ scale }] } };
}

// ─── Press Scale Hook ─────────────────────────────────────────────────────────
// Use with onPressIn / onPressOut on any Pressable/TouchableOpacity.
export function usePressScale(toValue = 0.96) {
    const scale = useRef(new Animated.Value(1)).current;

    const onPressIn = () =>
        Animated.spring(scale, { toValue, useNativeDriver: true, speed: 50, bounciness: 4 }).start();

    const onPressOut = () =>
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();

    return { style: { transform: [{ scale }] }, onPressIn, onPressOut };
}
