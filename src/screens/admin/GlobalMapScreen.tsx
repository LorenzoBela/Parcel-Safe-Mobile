import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
    View, StyleSheet, Dimensions, ScrollView, TouchableOpacity,
    Animated, TextInput as RNTextInput, Platform, Easing,
    Image, PanResponder,
} from 'react-native';
import { Text, Surface, Card, Chip, IconButton } from 'react-native-paper';
import { useAppTheme } from '../../context/ThemeContext';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import MapboxGL from '../../components/map/MapboxWrapper';
import AnimatedRiderMarker from '../../components/map/AnimatedRiderMarker';
import bearing from '@turf/bearing';
import { point } from '@turf/helpers';
import {
    HardwareByBoxId,
    HardwareDiagnostics,
    LocationsByBoxId,
    subscribeToAllHardware,
    subscribeToAllLocations,
} from '../../services/firebaseClient';
import { supabase } from '../../services/supabaseClient';

// ==================== Constants ====================

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DEFAULT_CENTER: [number, number] = [121.0244, 14.5547];
const ANIMATION_DURATION = 800;
const NAV_PITCH_DEG = 60;
const ZOOM_MIN_LEVEL = 8;
const ZOOM_MAX_LEVEL = 20;
const ZOOM_STEP = 1;

const STATUS_PRIORITY: Record<string, number> = {
    TAMPER: 0,
    IN_TRANSIT: 1,
    ACTIVE: 2,
    ARRIVED: 3,
    STANDBY: 4,
    IDLE: 5,
    OFFLINE: 6,
};

// ==================== Types ====================

type BoxMarker = {
    id: string;
    lat: number;
    lng: number;
    speed?: number;
    alert: boolean;
    status: string;
    gpsSource?: string;
    timestamp?: number;
    connection?: string;
    rssi?: number;
    csq?: number;
    op?: string;
    gpsFix?: boolean;
    lastUpdated?: number;
    dataBytes?: number;
    batteryPct?: number;
    batteryVolt?: number;
    distanceTrav?: number;
    phoneBatteryPct?: number;
    hasActiveDelivery?: boolean;
    deliveryId?: string;
    hwLastUpdated?: number;
    phoneLastUpdated?: number;
    phoneConnected?: boolean;
    rawStatus?: string;
};

type AnimationState = {
    current: [number, number];
    target: [number, number];
    startTime: number;
    start: [number, number];
    currentRot: number;
    startRot: number;
    targetRot: number;
};

type FleetFilter = 'ALL' | 'TAMPER' | 'ACTIVE' | 'OFFLINE';

type TamperIncidentPoint = {
    id: string;
    boxId: string | null;
    lat: number;
    lng: number;
    detectedAt: string;
    status: string;
    locationSource: string | null;
};

// ==================== Helpers ====================

function getStatusColor(status: string, alert: boolean): string {
    if (alert) return '#F44336';
    switch (status) {
        case 'IN_TRANSIT':
        case 'ACTIVE': return '#2196F3';
        case 'ARRIVED': return '#FF9800';
        case 'IDLE':
        case 'STANDBY': return '#4CAF50';
        case 'OFFLINE': return '#607D8B';
        default: return '#9E9E9E';
    }
}

function getStatusIcon(status: string, alert: boolean): string {
    if (alert) return 'shield-alert';
    switch (status) {
        case 'IN_TRANSIT': return 'truck-fast';
        case 'ACTIVE': return 'package-variant-closed';
        case 'ARRIVED': return 'map-marker-check';
        case 'IDLE': return 'package-variant';
        case 'STANDBY': return 'clock-outline';
        case 'OFFLINE': return 'wifi-off';
        default: return 'help-circle-outline';
    }
}

function getSignalBars(csq?: number): number {
    if (csq == null || csq === 99 || csq <= 0) return 0;
    if (csq <= 5) return 1;
    if (csq <= 12) return 2;
    if (csq <= 20) return 3;
    return 4;
}

function getSignalColor(bars: number): string {
    switch (bars) {
        case 0: return '#607D8B';
        case 1: return '#F44336';
        case 2: return '#FF9800';
        case 3: return '#66BB6A';
        default: return '#2E7D32';
    }
}

function getSignalIcon(bars: number): string {
    switch (bars) {
        case 0: return 'signal-off';
        case 1: return 'signal-cellular-1';
        case 2: return 'signal-cellular-2';
        case 3: return 'signal-cellular-3';
        default: return 'signal-cellular-outline';
    }
}

function formatDataBytes(bytes?: number): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
}

function deriveStatus(hw: HardwareDiagnostics | null): string {
    if (!hw) return 'OFFLINE';
    if (typeof hw.status === 'string' && hw.status.length > 0) return hw.status;
    if (hw.gps_fix) return 'ACTIVE';
    if (hw.connection) return 'STANDBY';
    return 'IDLE';
}

function formatTimeAgo(timestamp?: number): string {
    if (!timestamp || !Number.isFinite(timestamp)) return '—';
    if (timestamp < 1600000000000) {
        const totalSec = Math.floor(timestamp / 1000);
        if (totalSec < 60) return `${totalSec}s uptime`;
        const mins = Math.floor(totalSec / 60);
        if (mins < 60) return `${mins}m uptime`;
        const hours = Math.floor(mins / 60);
        return `${hours}h ${mins % 60}m uptime`;
    }
    const diffMs = Date.now() - timestamp;
    if (diffMs < 0) return 'just now';
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ${diffMin % 60}m ago`;
    try {
        return new Date(timestamp).toLocaleString('en-US', { timeZone: 'Asia/Manila' });
    } catch {
        return '—';
    }
}

function formatCoord(val: number, isLat: boolean): string {
    if (!Number.isFinite(val)) return '—';
    const abs = Math.abs(val);
    const dir = isLat ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
    return `${abs.toFixed(5)}° ${dir}`;
}

function formatSpeed(speedMs: number | undefined | null): string {
    if (speedMs == null || speedMs < 0) return '0 km/h';
    return `${Math.round(speedMs * 3.6)} km/h`;
}

// ==================== Sub-components ====================

/** Animated pulsing live indicator dot */
function LivePulseDot({ color }: { color: string }) {
    const pulse = useRef(new Animated.Value(1)).current;
    useEffect(() => {
        const anim = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, { toValue: 1.7, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
                Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            ]),
        );
        anim.start();
        return () => anim.stop();
    }, [pulse]);
    return (
        <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={{
                position: 'absolute', width: 14, height: 14, borderRadius: 7,
                backgroundColor: color + '40', transform: [{ scale: pulse }],
            }} />
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
        </View>
    );
}

/** Visual 4-bar signal strength */
function SignalBars({ bars, color }: { bars: number; color: string }) {
    const heights = [4, 7, 10, 13];
    return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14 }}>
            {heights.map((h, i) => (
                <View key={i} style={{
                    width: 3, height: h, borderRadius: 1.5,
                    backgroundColor: i < bars ? color : '#E0E0E0',
                }} />
            ))}
        </View>
    );
}

/** Single diagnostics metric tile */
function DiagTile({ icon, label, value, valueColor, children }: {
    icon: string; label: string; value?: string;
    valueColor?: string; children?: React.ReactNode;
}) {
    return (
        <View style={diagStyles.tile}>
            <View style={diagStyles.tileIconWrap}>
                <MaterialCommunityIcons name={icon as any} size={14} color={valueColor ?? '#78909C'} />
            </View>
            <Text style={diagStyles.tileLabel}>{label}</Text>
            {children ?? (
                <Text style={[diagStyles.tileValue, valueColor ? { color: valueColor } : undefined]} numberOfLines={1}>
                    {value ?? '—'}
                </Text>
            )}
        </View>
    );
}

const diagStyles = StyleSheet.create({
    tile: { width: '33.33%', paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center' },
    tileIconWrap: {
        width: 26, height: 26, borderRadius: 13,
        alignItems: 'center', justifyContent: 'center', marginBottom: 3,
    },
    tileLabel: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
    tileValue: { fontSize: 12, fontFamily: 'Inter_700Bold' },
});

// ==================== Component ====================

export default function GlobalMapScreen() {
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
    const { isDarkMode } = useAppTheme();
    // Dynamic colors for overlays
    const uiBg = isDarkMode ? '#141414' : '#FFFFFF';
    const uiBorder = isDarkMode ? '#2C2C2E' : '#E5E5EA';
    const uiText = isDarkMode ? '#FFFFFF' : '#000000';
    const uiTextSec = isDarkMode ? '#8E8E93' : '#6B6B6B';
    const uiPill = isDarkMode ? '#1C1C1E' : '#F2F2F7';
    const uiAccent = isDarkMode ? '#FFFFFF' : '#000000';

    const [locationsByBox, setLocationsByBox] = useState<LocationsByBoxId | null>(null);
    const [hardwareByBox, setHardwareByBox] = useState<HardwareByBoxId | null>(null);
    const [tamperIncidentPoints, setTamperIncidentPoints] = useState<TamperIncidentPoint[]>([]);

    const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
    const [lockedBoxId, setLockedBoxId] = useState<string | null>(null);
    const [navMode, setNavMode] = useState<boolean>(false);
    const [listVisible, setListVisible] = useState(false);
    const [fleetFilter, setFleetFilter] = useState<FleetFilter>('ALL');
    const [expandedFeedIds, setExpandedFeedIds] = useState<Set<string>>(new Set());

    const [sidebarAddresses, setSidebarAddresses] = useState<Map<string, string>>(new Map());

    const [cameraCenter, setCameraCenter] = useState<[number, number]>(DEFAULT_CENTER);
    const [cameraZoom, setCameraZoom] = useState<number>(12);
    const [cameraBearing, setCameraBearing] = useState<number>(0);

    // Swipe-down-to-close gesture for the diagnostics card
    const isDiagGestureRef = useRef(false);
    // -------------- Swipe-to-close gesture (Diagnostics) --------------
    const diagSwipeY = useRef(new Animated.Value(0)).current;
    const diagPanResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gestureState) => {
                // Only capture downward swipes
                return gestureState.dy > 10;
            },
            onPanResponderMove: (_, gestureState) => {
                if (gestureState.dy > 0) {
                    diagSwipeY.setValue(gestureState.dy);
                }
            },
            onPanResponderRelease: (_, gestureState) => {
                if (gestureState.dy > 100 || gestureState.vy > 1.5) {
                    // Swipe down detected -> close
                    Animated.timing(diagSwipeY, {
                        toValue: 500,
                        duration: 200,
                        useNativeDriver: true,
                    }).start(() => {
                        setSelectedBoxId(null);
                        diagSwipeY.setValue(0);
                    });
                } else {
                    // Spring back
                    Animated.spring(diagSwipeY, {
                        toValue: 0,
                        useNativeDriver: true,
                        tension: 200,
                        friction: 20,
                    }).start(() => {
                        isDiagGestureRef.current = false;
                    });
                }
            },
        })
    ).current;

    // Optimizations
    const shapeSourceRef = useRef<any>(null);
    const animationStates = useRef<Map<string, AnimationState>>(new Map());
    const animationFrameId = useRef<number | null>(null);
    const boxBearings = useRef<Map<string, number>>(new Map()); // per-box bearing tracking
    const markerRefs = useRef<Map<string, any>>(new Map()); // per-box PointAnnotation refs for refresh
    const lastCameraBearingRef = useRef<number>(0);

    const updateCameraBearing = useCallback((event: any) => {
        const isUserInteraction =
            Boolean(
                event?.properties?.isUserInteraction ??
                    event?.nativeEvent?.properties?.isUserInteraction
            );

        // If the user manually moves the map, stop auto-follow/auto-nav so we don't fight their gestures.
        if (isUserInteraction && !isDiagGestureRef.current) {
            setLockedBoxId(null);
            setNavMode(false);
        }

        const nextBearingRaw =
            event?.properties?.heading ??
            event?.properties?.bearing ??
            event?.heading ??
            event?.bearing ??
            event?.nativeEvent?.properties?.heading ??
            event?.nativeEvent?.properties?.bearing;

        if (typeof nextBearingRaw !== 'number' || Number.isNaN(nextBearingRaw)) return;

        const normalized = ((nextBearingRaw % 360) + 360) % 360;
        const prev = lastCameraBearingRef.current;
        const diff = Math.abs(normalized - prev);
        const circularDiff = Math.min(diff, 360 - diff);

        // While Nav Mode is enabled, rider-heading should be the source of truth.
        if (navMode && !isUserInteraction) {
            lastCameraBearingRef.current = normalized;
            return;
        }

        if (circularDiff >= 0.5) {
            lastCameraBearingRef.current = normalized;
            setCameraBearing(normalized);
        }
    }, [navMode]);

    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }
    }, [MAPBOX_TOKEN]);

    const fetchAndCacheAddress = useCallback(async (deviceId: string, lat: number, lng: number) => {
        if (!MAPBOX_TOKEN || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
        try {
            const res = await fetch(
                `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address,poi,place&limit=1`
            );
            if (!res.ok) return;
            const data = await res.json();
            const placeName = data.features?.[0]?.place_name;
            if (placeName) {
                setSidebarAddresses(prev => {
                    const next = new Map(prev);
                    next.set(deviceId, placeName);
                    return next;
                });
            }
        } catch {}
    }, [MAPBOX_TOKEN]);

    useEffect(() => {
        const unsubscribeLocations = subscribeToAllLocations(setLocationsByBox);
        const unsubscribeHardware = subscribeToAllHardware(setHardwareByBox);
        return () => {
            unsubscribeLocations();
            unsubscribeHardware();
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadTamperIncidents = async () => {
            const { data, error } = await supabase
                .from('tamper_incidents')
                .select('id,box_id,status,detected_at,location_lat,location_lng,location_source')
                .in('status', ['OPEN', 'PENDING_REVIEW'])
                .not('location_lat', 'is', null)
                .not('location_lng', 'is', null)
                .order('detected_at', { ascending: false })
                .limit(200);

            if (cancelled) return;
            if (error) {
                console.error('[GlobalMapScreen] Failed to load tamper incidents:', error);
                return;
            }

            const points: TamperIncidentPoint[] = (data || [])
                .map((row: any) => ({
                    id: String(row.id),
                    boxId: row.box_id ? String(row.box_id) : null,
                    lat: Number(row.location_lat),
                    lng: Number(row.location_lng),
                    detectedAt: String(row.detected_at || ''),
                    status: String(row.status || 'OPEN'),
                    locationSource: row.location_source ? String(row.location_source) : null,
                }))
                .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

            setTamperIncidentPoints(points);
        };

        loadTamperIncidents();
        const intervalId = setInterval(loadTamperIncidents, 20000);

        return () => {
            cancelled = true;
            clearInterval(intervalId);
        };
    }, []);

    const activeBoxes = useMemo<BoxMarker[]>(() => {
        if (!locationsByBox) return [];

        const isValidLat = (value: number) => Number.isFinite(value) && value >= -90 && value <= 90;
        const isValidLng = (value: number) => Number.isFinite(value) && value >= -180 && value <= 180;

        return Object.entries(locationsByBox)
            .map(([boxId, location]) => {
                const hw: HardwareDiagnostics | null =
                    hardwareByBox?.[boxId] ?? null;
                const tamper = hw?.tamper;
                const alert = Boolean(tamper?.lockdown || tamper?.detected);
                const status = alert ? 'TAMPER' : deriveStatus(hw);

                return {
                    id: boxId,
                    lat: typeof location?.latitude === 'number' ? location.latitude : NaN,
                    lng: typeof location?.longitude === 'number' ? location.longitude : NaN,
                    speed: typeof location?.speed === 'number' ? location.speed : undefined,
                    alert,
                    status,
                    gpsSource: location?.source,
                    timestamp: location?.timestamp,
                    // Diagnostics
                    connection: hw?.connection,
                    rssi: hw?.rssi,
                    csq: hw?.csq,
                    op: hw?.op,
                    gpsFix: hw?.gps_fix,
                    lastUpdated: hw?.last_updated,
                    dataBytes: hw?.data_bytes,
                    batteryPct: hw?.batt_pct,
                    batteryVolt: hw?.batt_v,
                    distanceTrav: hw?.geo_dist_m,
                    phoneBatteryPct: (hw as any)?.phone_status?.battery_level,
                    hasActiveDelivery: !!(hw as any)?.delivery_id,
                    deliveryId: (hw as any)?.delivery_id,
                    hwLastUpdated: hw?.last_updated,
                    phoneLastUpdated: (hw as any)?.phone_status?.timestamp,
                    phoneConnected: (hw as any)?.phone_status?.is_connected,
                    rawStatus: hw?.status,
                };
            })
            .filter((b) => isValidLat(b.lat) && isValidLng(b.lng));
    }, [locationsByBox, hardwareByBox]);

    useEffect(() => {
        if (selectedBoxId) {
            const box = activeBoxes.find(b => b.id === selectedBoxId);
            if (box && !sidebarAddresses.has(selectedBoxId)) {
                fetchAndCacheAddress(selectedBoxId, box.lat, box.lng);
            }
        }
    }, [selectedBoxId, activeBoxes, sidebarAddresses, fetchAndCacheAddress]);

    const tamperAlertCount = useMemo(() => activeBoxes.filter((b) => b.alert).length, [activeBoxes]);
    const activeMoveCount = useMemo(
        () => activeBoxes.filter((b) => !b.alert && b.status !== 'OFFLINE').length,
        [activeBoxes],
    );
    const offlineCount = useMemo(
        () => activeBoxes.filter((b) => b.status === 'OFFLINE').length,
        [activeBoxes],
    );

    const filteredBoxes = useMemo(() => {
        switch (fleetFilter) {
            case 'TAMPER':
                return activeBoxes.filter((b) => b.alert);
            case 'ACTIVE':
                // Match any box that is connected / not offline and not a tamper alert
                return activeBoxes.filter((b) => !b.alert && b.status !== 'OFFLINE');
            case 'OFFLINE':
                return activeBoxes.filter((b) => b.status === 'OFFLINE');
            default:
                return activeBoxes;
        }
    }, [activeBoxes, fleetFilter]);

    // Initial center
    useEffect(() => {
        if (filteredBoxes.length === 0) return;
        if (lockedBoxId) return;
        if (cameraCenter[0] === DEFAULT_CENTER[0] && cameraCenter[1] === DEFAULT_CENTER[1]) {
            setCameraCenter([filteredBoxes[0].lng, filteredBoxes[0].lat]);
            setCameraZoom(13);
        }
    }, [filteredBoxes, cameraCenter, lockedBoxId]);

    // EMA smoothing per-box for GPS jitter reduction
    const emaSmoothStates = useRef<Map<string, [number, number]>>(new Map());
    const EMA_ALPHA = 0.4; // 0 = full smooth (laggy), 1 = no smooth (raw)

    // Animation Loop
    useEffect(() => {
        const updateAnimationTargets = () => {
            filteredBoxes.forEach(box => {
                // EMA smooth the raw coords before animation
                let smoothedTarget: [number, number] = [box.lng, box.lat];
                const prevSmoothed = emaSmoothStates.current.get(box.id);
                if (prevSmoothed) {
                    smoothedTarget = [
                        EMA_ALPHA * box.lng + (1 - EMA_ALPHA) * prevSmoothed[0],
                        EMA_ALPHA * box.lat + (1 - EMA_ALPHA) * prevSmoothed[1],
                    ];
                }
                emaSmoothStates.current.set(box.id, smoothedTarget);

                let targetRotation = 0;
                
                // Compute bearing from previous → current position
                const prevTarget = animationStates.current.get(box.id)?.target;
                if (prevTarget) {
                    const dLng = smoothedTarget[0] - prevTarget[0];
                    const dLat = smoothedTarget[1] - prevTarget[1];
                    const distKm = Math.sqrt(dLng * dLng + dLat * dLat) * 111;
                    if (distKm > 0.005) { // ~5m threshold
                        targetRotation = bearing(
                            point([prevTarget[0], prevTarget[1]]),
                            point([smoothedTarget[0], smoothedTarget[1]])
                        );
                        if (targetRotation < 0) targetRotation += 360;
                        boxBearings.current.set(box.id, targetRotation);
                    } else {
                        targetRotation = boxBearings.current.get(box.id) ?? 0;
                    }
                } else {
                    targetRotation = boxBearings.current.get(box.id) ?? 0;
                }

                let state = animationStates.current.get(box.id);

                if (!state) {
                    // New marker
                    animationStates.current.set(box.id, {
                        current: smoothedTarget,
                        target: smoothedTarget,
                        start: smoothedTarget,
                        startTime: Date.now(),
                        currentRot: targetRotation,
                        startRot: targetRotation,
                        targetRot: targetRotation
                    });
                } else if (state.target[0] !== smoothedTarget[0] || state.target[1] !== smoothedTarget[1]) {
                    // Update target
                    // Teleport if too far (> 500m approx 0.005 deg)
                    const dist = Math.abs(state.current[0] - smoothedTarget[0]) + Math.abs(state.current[1] - smoothedTarget[1]);
                    if (dist > 0.005) {
                        state.current = smoothedTarget;
                        state.start = smoothedTarget;
                        state.target = smoothedTarget;
                        state.startTime = Date.now();
                        state.currentRot = targetRotation;
                        state.startRot = targetRotation;
                        state.targetRot = targetRotation;
                    } else {
                        state.start = state.current;
                        state.target = smoothedTarget;
                        state.startTime = Date.now();
                        state.startRot = state.currentRot;
                        state.targetRot = targetRotation;
                    }
                }
            });
        };

        updateAnimationTargets();

        const tick = () => {
            const now = Date.now();
            const features = [];
            const idsToRemove: string[] = [];

            // 1. Interpolate
            for (const [id, state] of animationStates.current.entries()) {
                // Check if box still exists in filteredBoxes (handle removal)
                const box = filteredBoxes.find(b => b.id === id);
                if (!box) {
                    idsToRemove.push(id);
                    continue;
                }

                const elapsed = now - state.startTime;
                const progress = Math.min(elapsed / ANIMATION_DURATION, 1);

                // Ease out cubic
                const t = 1 - Math.pow(1 - progress, 3);

                const currentLng = state.start[0] + (state.target[0] - state.start[0]) * t;
                const currentLat = state.start[1] + (state.target[1] - state.start[1]) * t;

                // Interpolate Rotation seamlessly
                let rotDiff = state.targetRot - state.startRot;
                if (rotDiff > 180) rotDiff -= 360;
                if (rotDiff < -180) rotDiff += 360;
                const currentRot = state.startRot + rotDiff * t;

                state.current = [currentLng, currentLat];
                state.currentRot = currentRot;

                // 2. Build Feature
                features.push({
                    type: 'Feature',
                    id: id,
                    properties: {
                        id: id,
                        status: box.status,
                        alert: box.alert,
                        color: getStatusColor(box.status, box.alert),
                        selected: id === selectedBoxId,
                        bearing: currentRot,
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: state.current
                    }
                });
            }

            // Cleanup removed
            idsToRemove.forEach(id => animationStates.current.delete(id));

            // 3. Update ShapeSource
            const collection = {
                type: 'FeatureCollection',
                features: features
            };

            if (shapeSourceRef.current) {
                try {
                    shapeSourceRef.current.setNativeProps({ shape: collection });
                } catch (e) {
                    // Fallback for older versions or if setNativeProps fails
                    // shapeSourceRef.current.setState({ shape: collection }); 
                    // Ignoring for now as setNativeProps is standard for perf
                }
            }

            animationFrameId.current = requestAnimationFrame(tick);
        };

        tick();

        return () => {
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        };
    }, [filteredBoxes, selectedBoxId]); // Re-run when list changes or selection changes (to update styling props)

    // Auto-recenter while locked-follow is active.
    useEffect(() => {
        if (!lockedBoxId) return;
        const box = filteredBoxes.find(b => b.id === lockedBoxId);
        if (!box) return;

        const smoothed = emaSmoothStates.current.get(lockedBoxId);
        const coordToPass = smoothed ?? [box.lng, box.lat];
        setCameraCenter(coordToPass);
    }, [lockedBoxId, filteredBoxes]);

    // Auto-rotate camera bearing while nav mode is enabled.
    useEffect(() => {
        const activeNavBoxId = selectedBoxId ?? lockedBoxId;
        if (!navMode || !activeNavBoxId) return;
        const heading = boxBearings.current.get(activeNavBoxId);
        if (typeof heading !== 'number' || Number.isNaN(heading)) return;

        const normalized = ((heading % 360) + 360) % 360;
        lastCameraBearingRef.current = normalized;
        setCameraBearing(normalized);
    }, [navMode, selectedBoxId, lockedBoxId, filteredBoxes]);

    const selectedBox = useMemo(() => {
        if (!selectedBoxId) return null;
        return activeBoxes.find((b) => b.id === selectedBoxId) ?? null;
    }, [selectedBoxId, activeBoxes]);

    const recenterToFleet = useCallback(() => {
        const target = filteredBoxes[0] ?? activeBoxes[0];
        if (!target) return;
        setLockedBoxId(null);
        setNavMode(false);
        setCameraBearing(0);
        lastCameraBearingRef.current = 0;
        setCameraCenter([target.lng, target.lat]);
        setCameraZoom(13);
    }, [filteredBoxes, activeBoxes]);

    const zoomBy = useCallback((delta: number) => {
        setCameraZoom(prev => {
            const next = prev + delta;
            return Math.max(ZOOM_MIN_LEVEL, Math.min(ZOOM_MAX_LEVEL, next));
        });
    }, []);

    const getStatusColor = (status: string, alert: boolean) => {
        if (alert) return '#F44336';
        switch (status) {
            case 'IN_TRANSIT':
            case 'ACTIVE':
                return '#2196F3';
            case 'ARRIVED':
                return '#FF9800';
            case 'IDLE':
            case 'STANDBY':
                return '#4CAF50';
            default:
                return '#9E9E9E';
        }
    };

    const selectBox = (boxId: string) => {
        diagSwipeY.setValue(0);
        setSelectedBoxId(boxId);
        if (lockedBoxId) setLockedBoxId(boxId);
        const box = activeBoxes.find((b) => b.id === boxId);
        if (box) {
            setCameraCenter([box.lng, box.lat]);
            setCameraZoom(15);
        }
    };

    // ==================== Render ====================

    const renderDiagnosticsCard = () => {
        if (!selectedBox) {
            return (
                <Card style={[styles.infoCardHint, { backgroundColor: uiBg }]}>
                    <Card.Content style={styles.infoHintContent}>
                        <MaterialCommunityIcons name="gesture-tap" size={14} color={uiTextSec} />
                        <Text variant="bodySmall" style={{ color: uiTextSec }}>
                            Tap a marker for diagnostics
                        </Text>
                    </Card.Content>
                </Card>
            );
        }

        const now = Date.now();
        const isAppOnline = (selectedBox.phoneConnected === true && (now - (selectedBox.phoneLastUpdated || 0) < 120000)) ||
            (selectedBox.gpsSource === 'phone' && (now - (selectedBox.timestamp || 0) < 60000));
        
        const boxStateMs = selectedBox.hwLastUpdated 
            ? (selectedBox.hwLastUpdated > 1e12 ? selectedBox.hwLastUpdated : selectedBox.hwLastUpdated * 1000) 
            : 0;
        const isBoxOnline = boxStateMs > 0 && (now - boxStateMs < 30000);
        
        const isOnline = isAppOnline || isBoxOnline;
        let sourceText = 'OFFLINE';
        if (isOnline) {
            if (isAppOnline && isBoxOnline) sourceText = 'BOTH ONLINE';
            else if (isAppOnline) sourceText = 'APP ONLINE';
            else if (isBoxOnline) sourceText = 'BOX ONLINE';
        }

        const hwStatus = selectedBox.rawStatus || '—';
        const isLocked = hwStatus === 'LOCKED' || hwStatus === 'IDLE';
        const lockLabel = isLocked ? 'LOCKED' : (hwStatus === 'UNLOCKING' ? 'UNLOCKING' : 'UNLOCKED');

        const boxBattPct = selectedBox.batteryPct != null ? Math.round(selectedBox.batteryPct) : null;
        const phoneBattPct = selectedBox.phoneBatteryPct != null ? Math.round(selectedBox.phoneBatteryPct) : null;
        const boxVolt = selectedBox.batteryVolt != null ? `${Number(selectedBox.batteryVolt).toFixed(1)}V` : null;

        const connType = selectedBox.connection || '—';
        const rssiVal = selectedBox.rssi != null ? `${selectedBox.rssi} dBm` : '—';
        const csqVal = selectedBox.csq != null ? `CSQ ${selectedBox.csq}` : null;
        const opName = selectedBox.op || null;
        const gpsFix = selectedBox.gpsFix;
        const speed = formatSpeed(selectedBox.speed);

        const dataBytes = selectedBox.dataBytes;
        const dataLabel = dataBytes != null
            ? dataBytes > 1048576 ? `${(dataBytes / 1048576).toFixed(1)} MB` : `${(dataBytes / 1024).toFixed(0)} KB`
            : '—';

        const deliveryId = selectedBox.deliveryId ? selectedBox.deliveryId.substring(0, 8) + '…' : '—';
        const deliveryState = selectedBox.hasActiveDelivery ? hwStatus.replace(/_/g, ' ') : 'None';

        const address = sidebarAddresses.get(selectedBox.id);

        // Format timestamps
        const fmtTime = (ts?: number) => {
            if (!ts || !Number.isFinite(ts)) return '—';
            const ms = ts > 1e12 ? ts : ts * 1000;
            return new Date(ms).toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        };
        const boxUpdatedStr = fmtTime(selectedBox.hwLastUpdated);
        const phoneUpdatedStr = fmtTime(selectedBox.phoneLastUpdated);

        const getBattColor = (pct: number | null) => {
            if (pct == null) return uiTextSec;
            if (pct > 50) return '#22C55E';
            if (pct > 20) return '#F59E0B';
            return '#EF4444';
        };

        const Row = ({ icon, label, value, valueColor }: { icon: string; label: string; value: string; valueColor?: string }) => (
            <View style={styles.diagRow}>
                <View style={styles.diagRowLeft}>
                    <MaterialCommunityIcons name={icon as any} size={13} color={uiTextSec} />
                    <Text style={[styles.diagLbl, { color: uiTextSec }]}>{label}</Text>
                </View>
                <Text style={[styles.diagVal, { color: valueColor || uiText }]}>{value}</Text>
            </View>
        );

        const SectionDivider = () => <View style={{ height: 1, backgroundColor: uiBorder, marginVertical: 8 }} />;

        return (
            <Card style={[styles.infoCard, { backgroundColor: uiBg }]}>
                <Card.Content style={{ padding: 12 }}>
                    {/* Swipe handle pill */}
                    <View style={{ alignItems: 'center', paddingBottom: 8 }}>
                        <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: uiBorder }} />
                    </View>

                    {/* Header: ID + Online Status */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: uiText }}>{selectedBox.id}</Text>
                        <View style={{
                            paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12,
                            backgroundColor: isOnline ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.1)',
                        }}>
                            <Text style={{
                                fontSize: 10, fontFamily: 'Inter_700Bold',
                                color: isOnline ? '#22C55E' : '#EF4444',
                            }}>{sourceText}</Text>
                        </View>
                    </View>

                    {/* Section: Lock & State */}
                    <Row icon="lock" label="Lock" value={lockLabel} valueColor={isLocked ? '#22C55E' : '#F59E0B'} />
                    <Row icon="state-machine" label="State" value={hwStatus.replace(/_/g, ' ')} />
                    <Row icon="speedometer" label="Speed" value={speed} />

                    <SectionDivider />

                    {/* Section: Battery (Box + Phone) */}
                    <View style={styles.diagRow}>
                        <View style={styles.diagRowLeft}>
                            <MaterialCommunityIcons name="battery" size={13} color={uiTextSec} />
                            <Text style={[styles.diagLbl, { color: uiTextSec }]}>Box Battery</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Text style={[styles.diagVal, { color: getBattColor(boxBattPct) }]}>
                                {boxBattPct != null ? `${boxBattPct}%` : '—'}
                            </Text>
                            {boxVolt && <Text style={{ fontSize: 10, fontFamily: 'JetBrainsMono_400Regular', color: uiTextSec }}>{boxVolt}</Text>}
                        </View>
                    </View>

                    <View style={styles.diagRow}>
                        <View style={styles.diagRowLeft}>
                            <MaterialCommunityIcons name="cellphone" size={13} color={uiTextSec} />
                            <Text style={[styles.diagLbl, { color: uiTextSec }]}>Phone Battery</Text>
                        </View>
                        <Text style={[styles.diagVal, { color: getBattColor(phoneBattPct) }]}>
                            {phoneBattPct != null ? `${phoneBattPct}%` : '—'}
                        </Text>
                    </View>

                    <SectionDivider />

                    {/* Section: Connectivity */}
                    <Row icon="signal" label="Signal" value={rssiVal} />
                    <View style={styles.diagRow}>
                        <View style={styles.diagRowLeft}>
                            <MaterialCommunityIcons name="antenna" size={13} color={uiTextSec} />
                            <Text style={[styles.diagLbl, { color: uiTextSec }]}>Network</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={[styles.diagVal, { color: uiText }]}>{connType}</Text>
                            {csqVal && <Text style={{ fontSize: 10, color: uiTextSec }}>{csqVal}</Text>}
                            {opName && <Text style={{ fontSize: 10, color: uiTextSec }}>· {opName}</Text>}
                        </View>
                    </View>
                    <Row icon="crosshairs-gps" label="GPS Fix" value={gpsFix ? 'Yes' : 'No'} valueColor={gpsFix ? '#22C55E' : '#EF4444'} />
                    <Row icon="database" label="Data Used" value={dataLabel} />

                    <SectionDivider />

                    {/* Section: Delivery */}
                    <Row icon="package-variant" label="Delivery" value={deliveryState} />
                    <View style={styles.diagRow}>
                        <View style={styles.diagRowLeft}>
                            <MaterialCommunityIcons name="identifier" size={13} color={uiTextSec} />
                            <Text style={[styles.diagLbl, { color: uiTextSec }]}>ID</Text>
                        </View>
                        <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, color: uiTextSec }}>{deliveryId}</Text>
                    </View>

                    {address ? (
                        <>
                            <SectionDivider />
                            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                                <MaterialCommunityIcons name="map-marker" size={13} color={uiTextSec} style={{ marginTop: 2 }} />
                                <Text style={{ flex: 1, fontSize: 11, color: uiTextSec, lineHeight: 16 }}>{address}</Text>
                            </View>
                        </>
                    ) : null}

                    <SectionDivider />

                    {/* Section: Timestamps (Box vs Phone) */}
                    <View style={styles.diagTimestampRow}>
                        <View style={styles.diagTimestampCol}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                <MaterialCommunityIcons name="chip" size={11} color={uiTextSec} />
                                <Text style={[styles.diagTimestampLabel, { color: uiTextSec }]}>Box Updated</Text>
                            </View>
                            <Text style={[styles.diagTimestampValue, { color: isBoxOnline ? uiText : uiTextSec }]}>{boxUpdatedStr}</Text>
                        </View>
                        <View style={{ width: 1, backgroundColor: uiBorder, marginHorizontal: 8 }} />
                        <View style={styles.diagTimestampCol}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                <MaterialCommunityIcons name="cellphone" size={11} color={uiTextSec} />
                                <Text style={[styles.diagTimestampLabel, { color: uiTextSec }]}>Phone Updated</Text>
                            </View>
                            <Text style={[styles.diagTimestampValue, { color: isAppOnline ? uiText : uiTextSec }]}>{phoneUpdatedStr}</Text>
                        </View>
                    </View>

                    {/* Footer: Coordinates */}
                    <Text style={{ marginTop: 6, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 9, color: uiTextSec, textAlign: 'center' }}>
                        {selectedBox.lat.toFixed(5)}, {selectedBox.lng.toFixed(5)}
                    </Text>
                </Card.Content>
            </Card>
        );
    };

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.container, screenAnim.style]}>
            {MAPBOX_TOKEN ? (
                <MapboxGL.MapView
                    style={styles.map}
                    logoEnabled={false}
                    attributionEnabled={false}
                    onPress={() => setSelectedBoxId(null)}
                    onCameraChanged={updateCameraBearing}
                    onRegionDidChange={updateCameraBearing}
                >
                    <MapboxGL.Camera
                        zoomLevel={cameraZoom}
                        centerCoordinate={cameraCenter}
                        heading={cameraBearing}
                        pitch={navMode ? NAV_PITCH_DEG : 0}
                    />

                    {/* Per-box rider markers — PointAnnotation for reliable Android touch */}
                    {filteredBoxes.map((box) => {
                        const anim = animationStates.current.get(box.id);
                        
                        // Use the smoothed coords if available to reduce GPS jitter
                        const smoothed = emaSmoothStates.current.get(box.id);
                        const coordToPass = smoothed ?? [box.lng, box.lat];
                        
                        const isSelected = box.id === selectedBoxId;
                        
                        return (
                            <AnimatedRiderMarker
                                key={box.id}
                                id={`box-${box.id}`}
                                latitude={coordToPass[1]}
                                longitude={coordToPass[0]}
                                rotation={boxBearings.current.get(box.id) ?? 0}
                                mapBearing={cameraBearing}
                                speed={box.speed}
                                isSelected={isSelected}
                                onSelected={() => selectBox(box.id)}
                            />
                        );
                    })}

                    {/* Tamper incident pins from recorded incident coordinates */}
                    {tamperIncidentPoints.map((incident) => (
                        <MapboxGL.PointAnnotation
                            key={`incident-${incident.id}`}
                            id={`incident-${incident.id}`}
                            coordinate={[incident.lng, incident.lat]}
                            onSelected={() => {
                                if (incident.boxId) {
                                    selectBox(incident.boxId);
                                } else {
                                    setCameraCenter([incident.lng, incident.lat]);
                                    setCameraZoom(15);
                                }
                            }}
                        >
                            <View style={styles.incidentPinWrap}>
                                <View style={styles.incidentPinHalo} />
                                <View style={styles.incidentPinCore}>
                                    <Text style={styles.incidentPinText}>!</Text>
                                </View>
                            </View>
                            <MapboxGL.Callout title={`Tamper ${incident.status}`} />
                        </MapboxGL.PointAnnotation>
                    ))}

                </MapboxGL.MapView>
            ) : (
                <View style={[styles.map, styles.mapFallback, { backgroundColor: uiPill }]}>
                    <Text style={{ color: uiTextSec }}>Map unavailable: set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env</Text>
                </View>
            )}

            {/* Top summary banner */}
            <View style={styles.overlayTop}>
                <Card style={[styles.topCard, { backgroundColor: uiBg }]}>
                    <Card.Content style={styles.topHudContent}>
                        <LivePulseDot color="#22C55E" />
                        <View style={{ flex: 1 }}>
                            <Text variant="titleSmall" style={{ fontFamily: 'Inter_700Bold', color: uiText }}>Live Fleet</Text>
                            <Text variant="labelSmall" style={{ color: uiTextSec }}>
                                {filteredBoxes.length}/{activeBoxes.length} boxes visible
                            </Text>
                        </View>
                        <View style={styles.topHudStats}>
                            <View style={styles.topHudStatChip}>
                                <MaterialCommunityIcons name="shield-alert" size={12} color="#DC2626" />
                                <Text style={[styles.topHudStatValue, { color: tamperAlertCount > 0 ? '#DC2626' : uiTextSec }]}>{tamperAlertCount}</Text>
                            </View>
                            <View style={styles.topHudStatChip}>
                                <MaterialCommunityIcons name="truck-fast" size={12} color="#2196F3" />
                                <Text style={[styles.topHudStatValue, { color: uiText }]}>{activeMoveCount}</Text>
                            </View>
                            <View style={styles.topHudStatChip}>
                                <MaterialCommunityIcons name="wifi-off" size={12} color="#607D8B" />
                                <Text style={[styles.topHudStatValue, { color: uiTextSec }]}>{offlineCount}</Text>
                            </View>
                        </View>
                    </Card.Content>
                </Card>

                <View style={[styles.filterCard, { backgroundColor: uiBg }]}>
                    {/* Row 1: filters only */}
                    <View style={styles.filterRow}>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={styles.filterScroll}
                            contentContainerStyle={styles.filterScrollContent}
                        >
                            {([
                                { key: 'ALL' as FleetFilter, label: 'All', count: activeBoxes.length, color: uiText },
                                { key: 'TAMPER' as FleetFilter, label: 'Tamper', count: tamperAlertCount, color: '#DC2626' },
                                { key: 'ACTIVE' as FleetFilter, label: 'Active', count: activeMoveCount, color: '#2196F3' },
                                { key: 'OFFLINE' as FleetFilter, label: 'Offline', count: offlineCount, color: '#607D8B' },
                            ]).map((f) => {
                                const isActive = fleetFilter === f.key;
                                return (
                                    <TouchableOpacity
                                        key={f.key}
                                        activeOpacity={0.7}
                                        onPress={() => {
                                            setFleetFilter(f.key);
                                            Haptics.selectionAsync().catch(() => undefined);
                                        }}
                                        style={[
                                            styles.filterPill,
                                            { backgroundColor: isActive ? uiAccent : uiPill },
                                        ]}
                                    >
                                        {isActive && (
                                            <View
                                                style={[
                                                    styles.filterPillDot,
                                                    { backgroundColor: f.key === 'ALL' ? (isDarkMode ? '#000' : '#fff') : f.color },
                                                ]}
                                            />
                                        )}
                                        <Text
                                            style={[
                                                styles.filterPillText,
                                                { color: isActive ? (isDarkMode ? '#000' : '#fff') : uiText },
                                            ]}
                                        >
                                            {f.label}
                                        </Text>
                                        <Text
                                            style={[
                                                styles.filterPillCount,
                                                { color: isActive ? (isDarkMode ? '#000' : '#fff') : uiTextSec },
                                            ]}
                                        >
                                            {f.count}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    </View>

                    {/* Row 2: controls (stacked) */}
                    <View style={styles.controlsColumn}>
                        <View style={styles.filterActionsTop}>
                            <IconButton icon="crosshairs-gps" size={20} iconColor={uiText} onPress={recenterToFleet} />
                            <IconButton
                                icon={lockedBoxId ? 'lock' : 'lock-open-variant-outline'}
                                size={20}
                                iconColor={lockedBoxId ? uiText : uiTextSec}
                                disabled={!selectedBoxId && !lockedBoxId}
                                onPress={() => {
                                    if (!selectedBoxId) {
                                        setLockedBoxId(null);
                                        return;
                                    }
                                    setLockedBoxId(prev => (prev === selectedBoxId ? null : selectedBoxId));
                                }}
                            />
                            <IconButton
                                icon={navMode ? 'navigation' : 'compass-outline'}
                                size={20}
                                iconColor={selectedBoxId || lockedBoxId ? uiText : uiTextSec}
                                disabled={!selectedBoxId && !lockedBoxId}
                                onPress={() => {
                                    const targetId = selectedBoxId ?? lockedBoxId;
                                    if (!targetId) return;
                                    if (navMode) {
                                        setNavMode(false);
                                        setCameraBearing(0);
                                        lastCameraBearingRef.current = 0;
                                    } else {
                                        setNavMode(true);
                                        const heading = boxBearings.current.get(targetId);
                                        if (typeof heading === 'number' && !Number.isNaN(heading)) {
                                            const normalized = ((heading % 360) + 360) % 360;
                                            lastCameraBearingRef.current = normalized;
                                            setCameraBearing(normalized);
                                        }
                                    }
                                }}
                            />
                                <IconButton
                                    icon="magnify-plus-outline"
                                    size={20}
                                    iconColor={lockedBoxId || navMode ? uiText : uiTextSec}
                                    disabled={!lockedBoxId && !navMode}
                                    onPress={() => zoomBy(ZOOM_STEP)}
                                />
                                <IconButton
                                    icon="magnify-minus-outline"
                                    size={20}
                                    iconColor={lockedBoxId || navMode ? uiText : uiTextSec}
                                    disabled={!lockedBoxId && !navMode}
                                    onPress={() => zoomBy(-ZOOM_STEP)}
                                />
                                <IconButton
                                    icon={listVisible ? 'chevron-down' : 'format-list-bulleted'}
                                    size={20}
                                    iconColor={uiText}
                                    onPress={() => setListVisible((v) => !v)}
                                />
                        </View>
                    </View>
                </View>
            </View>

            {/* Diagnostics info panel — swipe down to close */}
            <Animated.View
                style={[
                    styles.overlayInfo,
                    listVisible ? styles.overlayInfoRaised : null,
                    selectedBox ? { transform: [{ translateY: diagSwipeY }], opacity: diagSwipeY.interpolate({ inputRange: [0, 300], outputRange: [1, 0], extrapolate: 'clamp' }) } : null,
                ]}
                {...(selectedBox ? diagPanResponder.panHandlers : {})}
            >
                {renderDiagnosticsCard()}
            </Animated.View>

            {/* Box list panel */}
            {listVisible ? (
                <View style={[styles.listPanel, { backgroundColor: uiBg }]}>
                    <View style={[styles.listHeader, { borderBottomColor: uiBorder }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                            <Text variant="titleMedium" style={{ flex: 1, color: uiText }}>
                                Box Feed • {fleetFilter} ({filteredBoxes.length})
                            </Text>
                            <IconButton 
                                icon="close" 
                                size={20} 
                                iconColor={uiText} 
                                onPress={() => setListVisible(false)} 
                                style={{ margin: 0 }} 
                            />
                        </View>
                    </View>

                    <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
                        {filteredBoxes.map((box) => {
                            const isSelected = selectedBoxId === box.id;
                            const isExpanded = expandedFeedIds.has(box.id);
                            
                            const color = getStatusColor(box.status, box.alert);
                            const bars = getSignalBars(box.csq);
                            const sigColor = getSignalColor(bars);

                            // Derive online status (same logic as diagnostics card)
                            const now = Date.now();
                            const isAppOnline = (box.phoneConnected === true && (now - (box.phoneLastUpdated || 0) < 120000)) ||
                                (box.gpsSource === 'phone' && (now - (box.timestamp || 0) < 60000));
                            const boxStateMs = box.hwLastUpdated
                                ? (box.hwLastUpdated > 1e12 ? box.hwLastUpdated : box.hwLastUpdated * 1000)
                                : 0;
                            const isBoxOnline = boxStateMs > 0 && (now - boxStateMs < 30000);
                            const isOnline = isAppOnline || isBoxOnline;

                            const hwStatus = box.rawStatus || '—';
                            const isLocked = hwStatus === 'LOCKED' || hwStatus === 'IDLE';
                            const lockLabel = isLocked ? 'LOCKED' : (hwStatus === 'UNLOCKING' ? 'UNLOCKING' : 'UNLOCKED');

                            const boxBattPct = box.batteryPct != null ? Math.round(box.batteryPct) : null;
                            const phoneBattPct = box.phoneBatteryPct != null ? Math.round(box.phoneBatteryPct) : null;
                            const boxVolt = box.batteryVolt != null ? `${Number(box.batteryVolt).toFixed(1)}V` : null;

                            const getBattColor = (pct: number | null) => {
                                if (pct == null) return uiTextSec;
                                if (pct > 50) return '#22C55E';
                                if (pct > 20) return '#F59E0B';
                                return '#EF4444';
                            };

                            const connType = box.connection || '—';
                            const rssiVal = box.rssi != null ? `${box.rssi} dBm` : '—';
                            const csqVal = box.csq != null ? `CSQ ${box.csq}` : null;
                            const opName = box.op || null;

                            const dataLabel = box.dataBytes != null
                                ? box.dataBytes > 1048576 ? `${(box.dataBytes / 1048576).toFixed(1)} MB` : `${(box.dataBytes / 1024).toFixed(0)} KB`
                                : '—';

                            const FeedRow = ({ icon, label, value, valueColor }: { icon: string; label: string; value: string; valueColor?: string }) => (
                                <View style={styles.feedRow}>
                                    <View style={styles.feedRowLeft}>
                                        <MaterialCommunityIcons name={icon as any} size={12} color={uiTextSec} />
                                        <Text style={[styles.feedRowLabel, { color: uiTextSec }]}>{label}</Text>
                                    </View>
                                    <Text style={[styles.feedRowValue, { color: valueColor || uiText }]}>{value}</Text>
                                </View>
                            );

                            return (
                                <View
                                    key={box.id}
                                    style={[styles.feedCard, { borderBottomColor: uiBorder }, isSelected ? { backgroundColor: uiAccent + '12' } : null]}
                                >
                                    {/* Header: Touchable to toggle expansion */}
                                    <TouchableOpacity 
                                        activeOpacity={0.7} 
                                        onPress={() => {
                                            setExpandedFeedIds(prev => {
                                                const next = new Set(prev);
                                                if (next.has(box.id)) next.delete(box.id);
                                                else next.add(box.id);
                                                return next;
                                            });
                                        }}
                                        style={styles.feedHeader}
                                    >
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                                            <LivePulseDot color={color} />
                                            <Text style={[styles.feedTitle, { color: uiText }]}>{box.id}</Text>
                                        </View>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <View style={{
                                                paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10,
                                                backgroundColor: isOnline ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.1)',
                                            }}>
                                                <Text style={{ fontSize: 9, fontFamily: 'Inter_700Bold', color: isOnline ? '#22C55E' : '#EF4444' }}>
                                                    {isOnline ? 'ONLINE' : 'OFFLINE'}
                                                </Text>
                                            </View>
                                            <View style={{
                                                paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10,
                                                backgroundColor: color + '20',
                                            }}>
                                                <Text style={{ fontSize: 9, fontFamily: 'Inter_700Bold', color }}>
                                                    {box.alert ? 'TAMPER' : hwStatus.replace(/_/g, ' ')}
                                                </Text>
                                            </View>
                                            <MaterialCommunityIcons 
                                                name={isExpanded ? "chevron-up" : "chevron-down"} 
                                                size={20} 
                                                color={uiTextSec} 
                                            />
                                        </View>
                                    </TouchableOpacity>

                                    {/* Expanded Details */}
                                    {isExpanded && (
                                        <>
                                            {/* Section: Lock, Speed */}
                                            <View style={styles.feedSection}>
                                                <FeedRow icon="lock" label="Lock" value={lockLabel} valueColor={isLocked ? '#22C55E' : '#F59E0B'} />
                                                <FeedRow icon="speedometer" label="Speed" value={formatSpeed(box.speed)} />
                                            </View>

                                            <View style={[styles.feedDivider, { backgroundColor: uiBorder }]} />

                                            {/* Section: Battery */}
                                            <View style={styles.feedSection}>
                                                <View style={styles.feedRow}>
                                                    <View style={styles.feedRowLeft}>
                                                        <MaterialCommunityIcons name="battery" size={12} color={uiTextSec} />
                                                        <Text style={[styles.feedRowLabel, { color: uiTextSec }]}>Box Batt</Text>
                                                    </View>
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                                        <Text style={[styles.feedRowValue, { color: getBattColor(boxBattPct) }]}>
                                                            {boxBattPct != null ? `${boxBattPct}%` : '—'}
                                                        </Text>
                                                        {boxVolt && <Text style={{ fontSize: 9, fontFamily: 'JetBrainsMono_400Regular', color: uiTextSec }}>{boxVolt}</Text>}
                                                    </View>
                                                </View>
                                                <View style={styles.feedRow}>
                                                    <View style={styles.feedRowLeft}>
                                                        <MaterialCommunityIcons name="cellphone" size={12} color={uiTextSec} />
                                                        <Text style={[styles.feedRowLabel, { color: uiTextSec }]}>Phone Batt</Text>
                                                    </View>
                                                    <Text style={[styles.feedRowValue, { color: getBattColor(phoneBattPct) }]}>
                                                        {phoneBattPct != null ? `${phoneBattPct}%` : '—'}
                                                    </Text>
                                                </View>
                                            </View>

                                            <View style={[styles.feedDivider, { backgroundColor: uiBorder }]} />

                                            {/* Section: Connectivity */}
                                            <View style={styles.feedSection}>
                                                <View style={styles.feedRow}>
                                                    <View style={styles.feedRowLeft}>
                                                        <SignalBars bars={bars} color={sigColor} />
                                                        <Text style={[styles.feedRowLabel, { color: uiTextSec }]}>Signal</Text>
                                                    </View>
                                                    <Text style={[styles.feedRowValue, { color: sigColor }]}>{rssiVal}</Text>
                                                </View>
                                                <View style={styles.feedRow}>
                                                    <View style={styles.feedRowLeft}>
                                                        <MaterialCommunityIcons name="antenna" size={12} color={uiTextSec} />
                                                        <Text style={[styles.feedRowLabel, { color: uiTextSec }]}>Network</Text>
                                                    </View>
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                                        <Text style={[styles.feedRowValue, { color: uiText }]}>{connType}</Text>
                                                        {csqVal && <Text style={{ fontSize: 9, color: uiTextSec }}>{csqVal}</Text>}
                                                        {opName && <Text style={{ fontSize: 9, color: uiTextSec }}>· {opName}</Text>}
                                                    </View>
                                                </View>
                                                <FeedRow icon="crosshairs-gps" label="GPS" value={box.gpsFix ? 'Fix ✓' : 'No Fix'} valueColor={box.gpsFix ? '#22C55E' : '#EF4444'} />
                                            </View>

                                            <View style={[styles.feedDivider, { backgroundColor: uiBorder }]} />

                                            {/* Section: Data & Distance */}
                                            <View style={styles.feedSection}>
                                                <FeedRow icon="cloud-upload-outline" label="Data Used" value={dataLabel} />
                                                <FeedRow
                                                    icon="map-marker-distance"
                                                    label="Distance"
                                                    value={box.distanceTrav != null
                                                        ? (box.distanceTrav >= 1000 ? `${(box.distanceTrav / 1000).toFixed(1)} km` : `${Math.round(box.distanceTrav)} m`)
                                                        : '—'}
                                                />
                                                <FeedRow
                                                    icon={box.gpsSource === 'phone' ? 'cellphone' : 'cube-outline'}
                                                    label="GPS Source"
                                                    value={box.gpsSource === 'phone' ? 'Phone' : 'Box'}
                                                />
                                            </View>

                                            {/* Footer: Delivery + Timestamp + Locate Button */}
                                            <View style={[styles.feedDivider, { backgroundColor: uiBorder }]} />
                                            <View style={styles.feedFooter}>
                                                <View style={{ flex: 1 }}>
                                                    {box.hasActiveDelivery && (
                                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                                            <MaterialCommunityIcons name="package-variant" size={10} color="#3B82F6" />
                                                            <Text style={{ fontSize: 9, fontFamily: 'Inter_600SemiBold', color: '#3B82F6' }}>DELIVERY</Text>
                                                        </View>
                                                    )}
                                                    <Text style={[styles.feedTimestamp, { color: uiTextSec }]}>
                                                        {formatTimeAgo(box.lastUpdated || box.timestamp)}
                                                    </Text>
                                                </View>
                                                <TouchableOpacity
                                                    activeOpacity={0.7}
                                                    onPress={() => {
                                                        selectBox(box.id);
                                                        setListVisible(false);
                                                    }}
                                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 14, backgroundColor: uiAccent + '15' }}
                                                >
                                                    <MaterialCommunityIcons name="crosshairs-gps" size={12} color={uiAccent} />
                                                    <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: uiAccent }}>Locate</Text>
                                                </TouchableOpacity>
                                            </View>
                                        </>
                                    )}
                                </View>
                            );
                        })}

                        {filteredBoxes.length === 0 ? (
                            <View style={{ padding: 20, alignItems: 'center' }}>
                                <Text variant="bodySmall" style={{ color: uiTextSec }}>No boxes match this filter</Text>
                            </View>
                        ) : null}
                    </ScrollView>
                </View>
            ) : null}
        </Animated.View>
    );
}

// ==================== Styles ====================

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    map: {
        width: Dimensions.get('window').width,
        height: Dimensions.get('window').height,
    },
    mapFallback: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f1f1f1',
    },
    markerDot: {
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 3,
        borderColor: 'white',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 5,
    },
    incidentPinWrap: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    incidentPinHalo: {
        position: 'absolute',
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(244,67,54,0.25)',
    },
    incidentPinCore: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: '#F44336',
        borderWidth: 2,
        borderColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    incidentPinText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontFamily: 'Inter_700Bold',
        lineHeight: 10,
    },
    overlayTop: {
        position: 'absolute',
        top: 44,
        left: 10,
        right: 10,
    },
    topCard: {
        borderRadius: 12,
        elevation: 3,
        backgroundColor: 'white',
        marginBottom: 6,
    },
    topHudContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 10,
        gap: 8,
    },
    topHudStats: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    topHudStatChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    topHudStatValue: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
    },
    liveHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    liveChipBadge: {
        backgroundColor: '#EEF2FF',
    },
    kpiRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 8,
    },
    kpiChip: {
        backgroundColor: '#F3F4F6',
    },
    filterCard: {
        borderRadius: 12,
        elevation: 2,
        overflow: 'hidden',
    },
    filterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 10,
        justifyContent: 'center',
    },
    filterScrollContent: {
        paddingRight: 8,
        gap: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    filterScroll: {
        flex: 1,
    },
    filterPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
    },
    filterPillDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    filterPillText: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
    },
    filterPillCount: {
        fontSize: 11,
        fontFamily: 'Inter_700Bold',
    },
    filterActions: {
        flexDirection: 'column',
        alignItems: 'flex-end',
        marginLeft: 'auto',
    },
    filterActionsTop: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        justifyContent: 'center',
        flexWrap: 'nowrap',
    },
    filterRowBottom: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
        paddingHorizontal: 10,
    },
    filterActionsBottom: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: 6,
    },
    controlsColumn: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingBottom: 2,
        width: '100%',
    },
    filterActionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 4,
    },
    overlayInfo: {
        position: 'absolute',
        bottom: 14,
        left: 10,
        right: 10,
    },
    overlayInfoRaised: {
        bottom: 300,
    },
    infoCard: {
        borderRadius: 12,
        elevation: 3,
    },
    infoCardHint: {
        borderRadius: 999,
        elevation: 1,
        alignSelf: 'center',
    },
    infoHintContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 4,
    },
    topCardContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    diagCompactContent: {
        paddingVertical: 8,
        paddingHorizontal: 10,
    },
    diagHeaderCompact: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    diagPillRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    diagPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#F8FAFC',
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    diagPillText: {
        fontSize: 11,
        color: '#334155',
        fontFamily: 'Inter_600SemiBold',
    },
    // Diagnostics panel
    diagHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    statusChip: {
        borderRadius: 12,
        paddingHorizontal: 4,
    },
    diagGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    diagItem: {
        width: '33.3%',
        alignItems: 'center',
        paddingVertical: 6,
    },
    diagLabel: {
        fontSize: 10,
        color: '#999',
        marginTop: 2,
    },
    diagValue: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
        color: '#333',
        marginTop: 1,
    },
    // List panel
    listPanel: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: 480,
        backgroundColor: 'white',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 10,
        overflow: 'hidden',
    },
    listHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
    },
    listScroll: {
        flexGrow: 0,
        flexShrink: 1,
    },
    listItem: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F5F5F5',
    },
    listItemSelected: {
        backgroundColor: '#E3F2FD',
    },
    listItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    listItemDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: 'white',
    },
    listItemTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 3,
    },
    listItemMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
    },
    listItemMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    listItemMetaText: {
        fontSize: 11,
        color: '#666',
    },
    webPopupRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 2,
    },
    webPopupLbl: {
        color: '#71717a',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    webPopupVal: {
        fontFamily: 'Inter_600SemiBold',
        fontSize: 12,
    },
    // Diagnostics card rows
    diagRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 3,
    },
    diagRowLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    diagLbl: {
        fontSize: 11,
        fontFamily: 'Inter_500Medium',
    },
    diagVal: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
    },
    diagTimestampRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
    },
    diagTimestampCol: {
        flex: 1,
    },
    diagTimestampLabel: {
        fontSize: 9,
        fontFamily: 'Inter_500Medium',
        textTransform: 'uppercase',
        letterSpacing: 0.3,
    },
    diagTimestampValue: {
        fontSize: 11,
        fontFamily: 'JetBrainsMono_400Regular',
    },
    // Feed card styles
    feedCard: {
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F5F5F5',
    },
    feedHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    feedTitle: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    feedSection: {
        paddingVertical: 2,
    },
    feedRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 2,
    },
    feedRowLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    feedRowLabel: {
        fontSize: 11,
        fontFamily: 'Inter_500Medium',
    },
    feedRowValue: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
    },
    feedDivider: {
        height: 1,
        marginVertical: 6,
    },
    feedFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 4,
    },
    feedTimestamp: {
        fontSize: 10,
        fontFamily: 'JetBrainsMono_400Regular',
        marginLeft: 'auto',
    },
});
