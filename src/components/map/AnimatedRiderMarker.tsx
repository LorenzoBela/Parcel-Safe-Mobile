import React, { useRef, useEffect, useState } from 'react';
import { View, Image, Animated, Easing, StyleSheet } from 'react-native';
import MapboxGL from './MapboxWrapper';

// --- Configuration ---
const ANIMATION_DURATION = 1000; // ms to interpolate between updates
const JUMP_THRESHOLD = 0.005; // ~500m. If distance > this, snap instantly (teleport) instead of animating.

interface AnimatedRiderMarkerProps {
    latitude: number;
    longitude: number;
    rotation?: number; // Heading in degrees (0 = North)
}

const RiderImage = require('../../../assets/Rider.jpg');

const AnimatedRiderMarker: React.FC<AnimatedRiderMarkerProps> = ({
    latitude,
    longitude,
    rotation = 0,
}) => {
    // 1. Maintain the "current" animated coordinate in a Ref to avoid React render loop lag,
    //    but we need a State to force Mapbox to re-render the PointAnnotation.
    //    Actually, Mapbox PointAnnotation expects a raw coordinate prop. 
    //    To animate smoothly 60fps, we can use an Animated.ValueXY approach if Mapbox supports it,
    //    BUT MapboxGL.PointAnnotation 'coordinate' prop is not an Animated.Value.
    //    
    //    Standard Workaround: We must use a primitive RequestAnimationFrame loop that updates
    //    a React State `currentCoord` specific to this component. This isolates re-renders 
    //    to just this marker, not the whole map.

    const [renderCoord, setRenderCoord] = useState([longitude, latitude]);
    const [renderRotation, setRenderRotation] = useState(rotation);

    // Refs for animation state
    const startCoord = useRef([longitude, latitude]);
    const targetCoord = useRef([longitude, latitude]);
    const startTime = useRef<number>(0);
    const animFrameId = useRef<number | null>(null);

    // Rotation interpolation
    const startRotation = useRef(rotation);
    const targetRotation = useRef(rotation);

    useEffect(() => {
        // New target received
        const prevDest = targetCoord.current;
        const newDest = [longitude, latitude];

        // 1. Check for valid coordinates
        if (isNaN(latitude) || isNaN(longitude)) return;

        // 2. Calculate distance to check for "Teleport" (Large Jump)
        const dist = Math.sqrt(
            Math.pow(newDest[0] - prevDest[0], 2) +
            Math.pow(newDest[1] - prevDest[1], 2)
        );

        if (dist > JUMP_THRESHOLD) {
            // SNAP instantly
            if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
            startCoord.current = newDest;
            targetCoord.current = newDest;
            setRenderCoord(newDest);

            // Also snap rotation
            startRotation.current = rotation;
            targetRotation.current = rotation;
            setRenderRotation(rotation);
            return;
        }

        // 3. Smooth Animation Setup
        // Start from wherever we are currently rendered (approx) or the last target?
        // Better: Start from the *current interpolated value* if we're mid-animation.
        // For simplicity/robustness remix: Start from the *last known rendered frame*.
        startCoord.current = renderCoord;
        targetCoord.current = newDest;

        startRotation.current = renderRotation;
        targetRotation.current = rotation;

        startTime.current = performance.now();

        // 4. Animation Loop
        const animate = (time: number) => {
            const elapsed = time - startTime.current;
            const progress = Math.min(elapsed / ANIMATION_DURATION, 1);

            // Ease Out Cubic
            const ease = 1 - Math.pow(1 - progress, 3);

            // Interpolate Lng/Lat
            const lng = startCoord.current[0] + (targetCoord.current[0] - startCoord.current[0]) * ease;
            const lat = startCoord.current[1] + (targetCoord.current[1] - startCoord.current[1]) * ease;

            // Interpolate Rotation (Handle 350 -> 10 deg wrapping)
            let rotDiff = targetRotation.current - startRotation.current;
            if (rotDiff > 180) rotDiff -= 360;
            if (rotDiff < -180) rotDiff += 360;
            const rot = startRotation.current + rotDiff * ease;

            setRenderCoord([lng, lat]);
            setRenderRotation(rot);

            if (progress < 1) {
                animFrameId.current = requestAnimationFrame(animate);
            } else {
                // Done
                animFrameId.current = null;
                // Sync exact end state to avoid float drift
                setRenderCoord(targetCoord.current);
                setRenderRotation(targetRotation.current);
            }
        };

        if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
        animFrameId.current = requestAnimationFrame(animate);

        return () => {
            if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
        };
    }, [latitude, longitude, rotation]);


    const annotationRef = useRef<any>(null);

    return (
        <MapboxGL.PointAnnotation
            ref={annotationRef}
            id="rider-marker-animated"
            coordinate={renderCoord}
            anchor={{ x: 0.5, y: 0.5 }}
        >
            <View style={[styles.riderMarkerOuter, { transform: [{ rotate: `${renderRotation}deg` }] }]}>
                {/* Image Container */}
                <View style={[styles.riderMarkerCircle]}>
                    <Image
                        source={RiderImage}
                        style={styles.riderMarkerImage}
                        resizeMode="cover"
                        fadeDuration={0}
                        onLoad={() => {
                            if (annotationRef.current) {
                                annotationRef.current.refresh();
                            }
                        }}
                    />
                </View>

                {/* Direction Cone - Fixed at top, orbits map by rotating container */}
                <View style={styles.riderDirectionCone} />
            </View>
        </MapboxGL.PointAnnotation>
    );
};

const styles = StyleSheet.create({
    riderMarkerOuter: {
        width: 56,
        height: 56,
        justifyContent: 'center',
        alignItems: 'center',
    },
    riderMarkerCircle: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: 'white',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#0f172a', // Slate-900
        overflow: 'hidden',
        zIndex: 20,
        // Shadow
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 6,
    },
    riderMarkerImage: {
        width: 52,
        height: 52,
        borderRadius: 26,
    },
    riderDirectionCone: {
        position: 'absolute',
        top: -12, // Match track order screen / web
        left: 22, // 56/2 = 28. 28 - 6 (borderLeftWidth) = 22. This centers the 12px wide base
        width: 0,
        height: 0,
        borderLeftWidth: 6,
        borderLeftColor: 'transparent',
        borderRightWidth: 6,
        borderRightColor: 'transparent',
        borderBottomWidth: 10,
        borderBottomColor: 'rgba(15, 23, 42, 0.9)', // Slate-900/90 (Match Web)
        zIndex: 10,
    },
});

export default AnimatedRiderMarker;
