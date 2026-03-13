import React, { useRef, useEffect, useState } from 'react';
import { View, Image, Animated, Easing, StyleSheet, Text } from 'react-native';
import MapboxGL from './MapboxWrapper';
import length from '@turf/length';
import along from '@turf/along';
import { lineString, point } from '@turf/helpers';
import lineSlice from '@turf/line-slice';
import bearing from '@turf/bearing';

// --- Configuration ---
const ANIMATION_DURATION = 1000; // ms to interpolate between updates
const JUMP_THRESHOLD = 0.005; // ~500m. If distance > this, snap instantly (teleport) instead of animating.

interface AnimatedRiderMarkerProps {
    latitude: number;
    longitude: number;
    rotation?: number; // Heading in degrees (0 = North)
    speed?: number; // Speed in m/s from Firebase
    pathGeometry?: number[][]; // Array of [lng, lat] coordinates representing the road
    id?: string;
    isSelected?: boolean;
    onSelected?: () => void;
}

const RiderImage = require('../../../assets/Rider.jpg');

const AnimatedRiderMarker: React.FC<AnimatedRiderMarkerProps> = ({
    latitude,
    longitude,
    rotation = 0,
    speed,
    pathGeometry,
    id = "rider-marker-animated",
    isSelected = false,
    onSelected,
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

    // Path geometry caching for animation loop
    const cachedPathRef = useRef<any>(null); // The GeoJSON Feature for the sliced path
    const cachedPathLengthRef = useRef<number>(0);

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
            cachedPathRef.current = null;
            return;
        }

        // 3. Smooth Animation Setup
        startCoord.current = renderCoord;
        targetCoord.current = newDest;

        startRotation.current = renderRotation;
        
        // Calculate bearing automatically if distance is significant enough, otherwise rely on prop
        let computedRotation = rotation;
        if (dist > 0.00005) { // ~5m minimum to establish meaningful heading
            computedRotation = bearing(point(startCoord.current), point(targetCoord.current));
            // Or if we want strictly positive:
            if (computedRotation < 0) computedRotation += 360;
        }
        targetRotation.current = computedRotation;

        // Cache the Turf slice to completely avoid calculating it during the animation tick!
        cachedPathRef.current = null;
        cachedPathLengthRef.current = 0;
        
        if (pathGeometry && pathGeometry.length >= 2) {
            try {
                const roadLine = lineString(pathGeometry);
                const ptStart = point(startCoord.current);
                const ptEnd = point(targetCoord.current);
                
                const sliced = lineSlice(ptStart, ptEnd, roadLine);
                const len = length(sliced, { units: 'meters' });
                
                if (len > 0.5) { // Minimum 0.5m path to avoid snapping bugs
                    cachedPathRef.current = sliced;
                    cachedPathLengthRef.current = len;
                }
            } catch (err) {
                // Turf may throw if coordinates perfectly overlap inappropriately.
                // Fallback to straight line.
                console.warn("Marker Path slice failed:", err);
            }
        }

        startTime.current = performance.now();

        // 4. Animation Loop
        const animate = (time: number) => {
            const elapsed = time - startTime.current;
            const progress = Math.min(elapsed / ANIMATION_DURATION, 1);

            // Ease Out Cubic
            const ease = 1 - Math.pow(1 - progress, 3);

            let lng = startCoord.current[0];
            let lat = startCoord.current[1];
            let rot = startRotation.current;
            let rotDiff = targetRotation.current - startRotation.current;

            if (rotDiff > 180) rotDiff -= 360;
            if (rotDiff < -180) rotDiff += 360;

            if (cachedPathRef.current && cachedPathLengthRef.current > 0) {
                // PATH-BASED INTERPOLATION
                try {
                    const currentDist = cachedPathLengthRef.current * ease;
                    const currentPoint = along(cachedPathRef.current, currentDist, { units: 'meters' });
                    lng = currentPoint.geometry.coordinates[0];
                    lat = currentPoint.geometry.coordinates[1];

                    // Dynamically calculate heading based on path curve
                    const lookAheadDist = Math.min(currentDist + 2, cachedPathLengthRef.current);
                    if (lookAheadDist > currentDist + 0.1) {
                        const aheadPoint = along(cachedPathRef.current, lookAheadDist, { units: 'meters' });
                        rot = bearing(currentPoint, aheadPoint);
                    } else if (progress < 1) {
                        // Very close to end, ease the last remaining difference
                        rot = startRotation.current + rotDiff * ease;
                    } else {
                        rot = targetRotation.current;
                    }
                } catch (e) {
                    // Fallback on error
                    lng = startCoord.current[0] + (targetCoord.current[0] - startCoord.current[0]) * ease;
                    lat = startCoord.current[1] + (targetCoord.current[1] - startCoord.current[1]) * ease;
                    rot = startRotation.current + rotDiff * ease;
                }
            } else {
                // POINT-TO-POINT INTERPOLATION (Fallback)
                lng = startCoord.current[0] + (targetCoord.current[0] - startCoord.current[0]) * ease;
                lat = startCoord.current[1] + (targetCoord.current[1] - startCoord.current[1]) * ease;
                rot = startRotation.current + rotDiff * ease;
            }

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
    }, [latitude, longitude, rotation, pathGeometry]);


    const annotationRef = useRef<any>(null);

    return (
        <MapboxGL.PointAnnotation
            ref={annotationRef}
            id={id}
            coordinate={renderCoord}
            anchor={{ x: 0.5, y: 0.7 }}
            onSelected={onSelected}
        >
            <View style={{ alignItems: 'center' }}>
                {/* Speed Badge — counter-rotated to stay upright */}
                <View style={[
                    styles.speedBadge,
                    { opacity: speed != null && speed >= 0 ? 1 : 0, transform: [{ rotate: `${-renderRotation}deg` }] }
                ]}>
                    <Text style={styles.speedBadgeText}>
                        {speed != null && speed >= 0 ? Math.round(speed * 3.6) : 0} km/h
                    </Text>
                </View>

                <View style={[
                    styles.riderMarkerOuter, 
                    { 
                        width: 84,
                        height: 84,
                        transform: [{ rotate: `${renderRotation}deg` }] 
                    }
                ]}>
                    {/* Image Container */}
                    <View style={[
                        styles.riderMarkerCircle,
                        {
                            width: isSelected ? 60 : 56,
                            height: isSelected ? 60 : 56,
                            borderRadius: isSelected ? 30 : 28,
                        }
                    ]}>
                        <Image
                            source={RiderImage}
                            style={[
                                styles.riderMarkerImage,
                                {
                                    width: isSelected ? 56 : 52,
                                    height: isSelected ? 56 : 52,
                                    borderRadius: isSelected ? 28 : 26,
                                }
                            ]}
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
                    <View style={[
                        styles.riderDirectionCone,
                        { 
                            top: isSelected ? 0 : 2, 
                            left: 36 // 84/2 = 42. 42 - 6 (half base) = 36
                        }
                    ]} />
                </View>
            </View>
        </MapboxGL.PointAnnotation>
    );
};

const styles = StyleSheet.create({
    speedBadge: {
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 999,
        marginBottom: 2,
    },
    speedBadgeText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '700',
    },
    riderMarkerOuter: {
        width: 84,
        height: 84,
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
        top: 2, // Overridden in render via style array
        left: 36, // Overridden in render
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
