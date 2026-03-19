import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
    View, StyleSheet, Dimensions, ScrollView, TouchableOpacity,
    Animated, TextInput as RNTextInput, Platform, Easing,
    Image,
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
    tileValue: { fontSize: 12, fontWeight: '700' },
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
    const [listVisible, setListVisible] = useState(false);
    const [fleetFilter, setFleetFilter] = useState<FleetFilter>('ALL');

    const [cameraCenter, setCameraCenter] = useState<[number, number]>(DEFAULT_CENTER);
    const [cameraZoom, setCameraZoom] = useState<number>(12);
    const [cameraBearing, setCameraBearing] = useState<number>(0);

    // Optimizations
    const shapeSourceRef = useRef<any>(null);
    const animationStates = useRef<Map<string, AnimationState>>(new Map());
    const animationFrameId = useRef<number | null>(null);
    const boxBearings = useRef<Map<string, number>>(new Map()); // per-box bearing tracking
    const markerRefs = useRef<Map<string, any>>(new Map()); // per-box PointAnnotation refs for refresh
    const lastCameraBearingRef = useRef<number>(0);

    const updateCameraBearing = useCallback((event: any) => {
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

        if (circularDiff >= 0.5) {
            lastCameraBearingRef.current = normalized;
            setCameraBearing(normalized);
        }
    }, []);

    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
            MapboxGL.setTelemetryEnabled(false);
        }
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
                };
            })
            .filter((b) => isValidLat(b.lat) && isValidLng(b.lng));
    }, [locationsByBox, hardwareByBox]);

    const tamperAlertCount = useMemo(() => activeBoxes.filter((b) => b.alert).length, [activeBoxes]);
    const activeMoveCount = useMemo(
        () => activeBoxes.filter((b) => b.status === 'ACTIVE' || b.status === 'IN_TRANSIT').length,
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
                return activeBoxes.filter((b) => b.status === 'ACTIVE' || b.status === 'IN_TRANSIT');
            case 'OFFLINE':
                return activeBoxes.filter((b) => b.status === 'OFFLINE');
            default:
                return activeBoxes;
        }
    }, [activeBoxes, fleetFilter]);

    // Initial center
    useEffect(() => {
        if (filteredBoxes.length === 0) return;
        if (cameraCenter[0] === DEFAULT_CENTER[0] && cameraCenter[1] === DEFAULT_CENTER[1]) {
            setCameraCenter([filteredBoxes[0].lng, filteredBoxes[0].lat]);
            setCameraZoom(13);
        }
    }, [filteredBoxes, cameraCenter]);

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

    const selectedBox = useMemo(() => {
        if (!selectedBoxId) return null;
        return activeBoxes.find((b) => b.id === selectedBoxId) ?? null;
    }, [selectedBoxId, activeBoxes]);

    const recenterToFleet = useCallback(() => {
        const target = filteredBoxes[0] ?? activeBoxes[0];
        if (!target) return;
        setCameraCenter([target.lng, target.lat]);
        setCameraZoom(13);
    }, [filteredBoxes, activeBoxes]);

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
        setSelectedBoxId(boxId);
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

        const bars = getSignalBars(selectedBox.csq);
        const sigColor = getSignalColor(bars);
        const sigIcon = getSignalIcon(bars);
        const statusColor = getStatusColor(selectedBox.status, selectedBox.alert);
        const displayStatus = selectedBox.alert ? 'TAMPER' : selectedBox.status;

        return (
            <Card style={[styles.infoCard, { backgroundColor: uiBg }]}>
                <Card.Content style={styles.diagCompactContent}>
                    <View style={styles.diagHeaderCompact}>
                        <Text variant="titleSmall" style={{ fontWeight: 'bold', flex: 1, color: uiText }}>
                            {selectedBox.id}
                        </Text>
                        <Chip
                            compact
                            style={[styles.statusChip, { backgroundColor: statusColor + '22' }]}
                            textStyle={{ color: statusColor, fontSize: 11, fontWeight: 'bold' }}
                        >
                            {displayStatus}
                        </Chip>
                    </View>
                    <View style={styles.diagPillRow}>
                        <View style={[styles.diagPill, { backgroundColor: uiPill }]}>
                            <MaterialCommunityIcons name={selectedBox.connection === 'WiFi' ? 'wifi' : 'antenna'} size={14} color={uiAccent} />
                            <Text style={[styles.diagPillText, { color: uiText }]}>{selectedBox.connection ?? '—'}</Text>
                        </View>
                        <View style={[styles.diagPill, { backgroundColor: uiPill }]}>
                            <MaterialCommunityIcons name={sigIcon as any} size={14} color={sigColor} />
                            <Text style={[styles.diagPillText, { color: sigColor }]}>{selectedBox.rssi != null ? `${selectedBox.rssi} dBm` : '—'}</Text>
                        </View>
                        <View style={[styles.diagPill, { backgroundColor: uiPill }]}>
                            <MaterialCommunityIcons name={selectedBox.gpsFix ? 'crosshairs-gps' : 'crosshairs-off'} size={14} color={selectedBox.gpsFix ? '#16A34A' : '#DC2626'} />
                            <Text style={[styles.diagPillText, { color: uiText }]}>{selectedBox.gpsFix ? 'GPS Fix' : 'No Fix'}</Text>
                        </View>
                        <View style={[styles.diagPill, { backgroundColor: uiPill }]}>
                            <MaterialCommunityIcons name="clock-outline" size={14} color="#F59E0B" />
                            <Text style={[styles.diagPillText, { color: uiText }]}>{formatTimeAgo(selectedBox.lastUpdated || selectedBox.timestamp)}</Text>
                        </View>
                        <View style={[styles.diagPill, { backgroundColor: uiPill }]}>
                            <MaterialCommunityIcons name={selectedBox.gpsSource === 'phone' ? 'cellphone' : 'box'} size={14} color={uiAccent} />
                            <Text style={[styles.diagPillText, { color: uiText }]}>{selectedBox.gpsSource === 'phone' ? 'Phone' : 'Box'}</Text>
                        </View>
                        <View style={[styles.diagPill, { backgroundColor: uiPill }]}>
                            <MaterialCommunityIcons name="speedometer" size={14} color={uiAccent} />
                            <Text style={[styles.diagPillText, { color: uiText }]}>{formatSpeed(selectedBox.speed)}</Text>
                        </View>
                        <View style={[styles.diagPill, { backgroundColor: uiPill }]}>
                            <MaterialCommunityIcons 
                                name={selectedBox.batteryPct != null && selectedBox.batteryPct <= 20 ? 'battery-alert' : 'battery'} 
                                size={14} 
                                color={selectedBox.batteryPct != null && selectedBox.batteryPct <= 20 ? '#DC2626' : '#16A34A'} 
                            />
                            <Text style={[styles.diagPillText, { color: uiText }]}>
                                {selectedBox.batteryPct != null ? `${selectedBox.batteryPct}%` : '—'}
                            </Text>
                        </View>
                        <View style={[styles.diagPill, { backgroundColor: uiPill }]}>
                            <MaterialCommunityIcons name="map-marker-distance" size={14} color={uiAccent} />
                            <Text style={[styles.diagPillText, { color: uiText }]}>
                                {selectedBox.distanceTrav != null 
                                    ? (selectedBox.distanceTrav >= 1000 ? `${(selectedBox.distanceTrav / 1000).toFixed(1)} km` : `${Math.round(selectedBox.distanceTrav)} m`) 
                                    : '—'}
                            </Text>
                        </View>
                    </View>
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
                    <MapboxGL.Camera zoomLevel={cameraZoom} centerCoordinate={cameraCenter} />

                    {/* Per-box rider markers — same style as tracking pages */}
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
                            <Text variant="titleSmall" style={{ fontWeight: '800', color: uiText }}>Live Fleet</Text>
                            <Text variant="labelSmall" style={{ color: uiTextSec }}>
                                {filteredBoxes.length}/{activeBoxes.length} boxes visible
                            </Text>
                        </View>
                        <View style={styles.topHudStats}>
                            <Text style={styles.topHudStatDanger}>T {tamperAlertCount}</Text>
                            <Text style={[styles.topHudStat, { color: uiText }]}>A {activeMoveCount}</Text>
                            <Text style={[styles.topHudStat, { color: uiText }]}>O {offlineCount}</Text>
                        </View>
                    </Card.Content>
                </Card>

                <Card style={[styles.filterCard, { backgroundColor: uiBg }]}>
                    <Card.Content style={styles.filterRow}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
                            {(['ALL', 'TAMPER', 'ACTIVE', 'OFFLINE'] as FleetFilter[]).map((filterKey) => (
                                <Chip
                                    key={filterKey}
                                    compact
                                    selected={fleetFilter === filterKey}
                                    onPress={() => {
                                        setFleetFilter(filterKey);
                                        Haptics.selectionAsync().catch(() => undefined);
                                    }}
                                    style={[styles.filterChip, { backgroundColor: uiPill }, fleetFilter === filterKey ? styles.filterChipSelected : null]}
                                    textStyle={fleetFilter === filterKey ? styles.filterChipTextSelected : { color: uiText }}
                                >
                                    {filterKey}
                                </Chip>
                            ))}
                        </ScrollView>

                        <View style={styles.filterActions}>
                            <IconButton icon="crosshairs-gps" size={20} iconColor={uiText} onPress={recenterToFleet} />
                            <IconButton
                                icon={listVisible ? 'chevron-down' : 'format-list-bulleted'}
                                size={20}
                                iconColor={uiText}
                                onPress={() => setListVisible((v) => !v)}
                            />
                        </View>
                    </Card.Content>
                </Card>
            </View>

            {/* Diagnostics info panel */}
            <View style={[styles.overlayInfo, listVisible ? styles.overlayInfoRaised : null]}>
                {renderDiagnosticsCard()}
            </View>

            {/* Box list panel */}
            {listVisible ? (
                <View style={[styles.listPanel, { backgroundColor: uiBg }]}>
                    <View style={[styles.listHeader, { borderBottomColor: uiBorder }]}>
                        <Text variant="titleMedium" style={{ flex: 1, color: uiText }}>
                            Box Feed • {fleetFilter} ({filteredBoxes.length})
                        </Text>
                        <IconButton icon="close" size={20} iconColor={uiText} onPress={() => setListVisible(false)} />
                    </View>
                    <ScrollView style={styles.listScroll}>
                        {filteredBoxes.map((box) => {
                            const isSelected = selectedBoxId === box.id;
                            const color = getStatusColor(box.status, box.alert);
                            const bars = getSignalBars(box.csq);
                            const sigColor = getSignalColor(bars);

                            return (
                                <TouchableOpacity
                                    key={box.id}
                                    onPress={() => {
                                        selectBox(box.id);
                                        setListVisible(false);
                                    }}
                                    style={[styles.listItem, { borderBottomColor: uiBorder }, isSelected ? { backgroundColor: uiAccent + '15' } : null]}
                                >
                                    <View style={styles.listItemLeft}>
                                        <View style={[styles.listItemDot, { backgroundColor: color }]} />
                                        <View style={{ flex: 1 }}>
                                            <View style={styles.listItemTitleRow}>
                                                <Text variant="titleSmall" style={{ flex: 1, color: uiText }}>
                                                    {box.id}
                                                </Text>
                                                <Text variant="bodySmall" style={{ color: uiTextSec }}>
                                                    {box.alert ? 'TAMPER' : box.status}
                                                </Text>
                                            </View>
                                            <View style={styles.listItemMetaRow}>
                                                <View style={styles.listItemMeta}>
                                                    <MaterialCommunityIcons
                                                        name={getSignalIcon(bars) as any}
                                                        size={12}
                                                        color={sigColor}
                                                    />
                                                    <Text style={[styles.listItemMetaText, { color: sigColor }]}>
                                                        {box.rssi != null ? `${box.rssi}dBm` : '—'}
                                                    </Text>
                                                </View>
                                                <View style={styles.listItemMeta}>
                                                    <MaterialCommunityIcons
                                                        name={box.connection === 'WiFi' ? 'wifi' : 'antenna'}
                                                        size={12}
                                                        color={uiTextSec}
                                                    />
                                                    <Text style={[styles.listItemMetaText, { color: uiTextSec }]}>
                                                        {box.connection ?? '—'}
                                                    </Text>
                                                </View>
                                                <View style={styles.listItemMeta}>
                                                    <MaterialCommunityIcons
                                                        name="speedometer"
                                                        size={12}
                                                        color={uiTextSec}
                                                    />
                                                    <Text style={[styles.listItemMetaText, { color: uiTextSec }]}>
                                                        {formatSpeed(box.speed)}
                                                    </Text>
                                                </View>
                                                <View style={styles.listItemMeta}>
                                                    <MaterialCommunityIcons
                                                        name={box.gpsFix ? 'crosshairs-gps' : 'crosshairs-off'}
                                                        size={12}
                                                        color={box.gpsFix ? '#4CAF50' : uiTextSec}
                                                    />
                                                    <Text style={[styles.listItemMetaText, { color: uiTextSec }]}>
                                                        {box.gpsFix ? 'Fix' : 'No Fix'}
                                                    </Text>
                                                </View>
                                                <View style={styles.listItemMeta}>
                                                    <MaterialCommunityIcons 
                                                        name={box.batteryPct != null && box.batteryPct <= 20 ? 'battery-alert' : 'battery'} 
                                                        size={12} 
                                                        color={box.batteryPct != null && box.batteryPct <= 20 ? '#DC2626' : '#16A34A'} 
                                                    />
                                                    <Text style={[styles.listItemMetaText, { color: uiTextSec }]}>
                                                        {box.batteryPct != null ? `${box.batteryPct}%` : '—'}
                                                    </Text>
                                                </View>
                                                <View style={styles.listItemMeta}>
                                                    <MaterialCommunityIcons name="map-marker-distance" size={12} color={uiTextSec} />
                                                    <Text style={[styles.listItemMetaText, { color: uiTextSec }]}>
                                                        {box.distanceTrav != null 
                                                            ? (box.distanceTrav >= 1000 ? `${(box.distanceTrav / 1000).toFixed(1)}km` : `${Math.round(box.distanceTrav)}m`) 
                                                            : '—'}
                                                    </Text>
                                                </View>
                                                <View style={styles.listItemMeta}>
                                                    <MaterialCommunityIcons
                                                        name="cloud-upload-outline"
                                                        size={12}
                                                        color={uiTextSec}
                                                    />
                                                    <Text style={[styles.listItemMetaText, { color: uiTextSec }]}>
                                                        {formatDataBytes(box.dataBytes)}
                                                    </Text>
                                                </View>
                                                <View style={styles.listItemMeta}>
                                                    <MaterialCommunityIcons 
                                                        name={box.gpsSource === 'phone' ? 'cellphone' : 'box'} 
                                                        size={12} 
                                                        color={uiTextSec} 
                                                    />
                                                    <Text style={[styles.listItemMetaText, { color: uiTextSec }]}>
                                                        {box.gpsSource === 'phone' ? 'Phone' : 'Box'}
                                                    </Text>
                                                </View>
                                                <Text style={[styles.listItemMetaText, { color: uiTextSec }]}>
                                                    {formatTimeAgo(box.lastUpdated || box.timestamp)}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                </TouchableOpacity>
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
        fontWeight: '900',
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
    topHudStat: {
        fontSize: 12,
        fontWeight: '700',
        color: '#334155',
    },
    topHudStatDanger: {
        fontSize: 12,
        fontWeight: '800',
        color: '#DC2626',
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
        backgroundColor: 'white',
        elevation: 2,
    },
    filterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 2,
        paddingHorizontal: 6,
    },
    filterScrollContent: {
        paddingRight: 8,
        gap: 6,
    },
    filterChip: {
        backgroundColor: '#F8FAFC',
    },
    filterChipSelected: {
        backgroundColor: '#000000',
    },
    filterChipTextSelected: {
        color: '#FFFFFF',
        fontWeight: '700',
    },
    filterActions: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 'auto',
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
        fontWeight: '600',
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
        fontWeight: '600',
        color: '#333',
        marginTop: 1,
    },
    // List panel
    listPanel: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: 280,
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
        flex: 1,
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
});
