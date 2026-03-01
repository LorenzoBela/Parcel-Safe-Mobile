import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
    View, StyleSheet, Dimensions, ScrollView, TouchableOpacity,
    Animated, TextInput as RNTextInput, Platform, Easing,
} from 'react-native';
import { Text, Surface, Card, Chip, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import MapboxGL from '../../components/map/MapboxWrapper';
import {
    HardwareByBoxId,
    HardwareDiagnostics,
    LocationsByBoxId,
    subscribeToAllHardware,
    subscribeToAllLocations,
} from '../../services/firebaseClient';

// ==================== Constants ====================

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DEFAULT_CENTER: [number, number] = [121.0244, 14.5547];
const ANIMATION_DURATION = 1000;

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
};

type AnimationState = {
    current: [number, number];
    target: [number, number];
    startTime: number;
    start: [number, number];
};

type FleetFilter = 'ALL' | 'TAMPER' | 'ACTIVE' | 'OFFLINE';

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
        backgroundColor: '#F0F4FF', alignItems: 'center', justifyContent: 'center', marginBottom: 3,
    },
    tileLabel: { fontSize: 9, color: '#90A4AE', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
    tileValue: { fontSize: 12, fontWeight: '700', color: '#263238' },
});

// ==================== Component ====================

export default function GlobalMapScreen() {
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const [locationsByBox, setLocationsByBox] = useState<LocationsByBoxId | null>(null);
    const [hardwareByBox, setHardwareByBox] = useState<HardwareByBoxId | null>(null);

    const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
    const [listVisible, setListVisible] = useState(false);
    const [fleetFilter, setFleetFilter] = useState<FleetFilter>('ALL');

    const [cameraCenter, setCameraCenter] = useState<[number, number]>(DEFAULT_CENTER);
    const [cameraZoom, setCameraZoom] = useState<number>(12);

    // Optimizations
    const shapeSourceRef = useRef<any>(null);
    const animationStates = useRef<Map<string, AnimationState>>(new Map());
    const animationFrameId = useRef<number | null>(null);

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

    // Animation Loop
    useEffect(() => {
        const updateAnimationTargets = () => {
            filteredBoxes.forEach(box => {
                const target: [number, number] = [box.lng, box.lat];
                let state = animationStates.current.get(box.id);

                if (!state) {
                    // New marker
                    animationStates.current.set(box.id, {
                        current: target,
                        target: target,
                        start: target,
                        startTime: Date.now()
                    });
                } else if (state.target[0] !== target[0] || state.target[1] !== target[1]) {
                    // Update target
                    // Teleport if too far (> 500m approx 0.005 deg)
                    const dist = Math.abs(state.current[0] - target[0]) + Math.abs(state.current[1] - target[1]);
                    if (dist > 0.005) {
                        state.current = target;
                        state.start = target;
                        state.target = target;
                        state.startTime = Date.now();
                    } else {
                        state.start = state.current;
                        state.target = target;
                        state.startTime = Date.now();
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

                state.current = [currentLng, currentLat];

                // 2. Build Feature
                features.push({
                    type: 'Feature',
                    id: id,
                    properties: {
                        id: id,
                        status: box.status,
                        alert: box.alert,
                        color: getStatusColor(box.status, box.alert),
                        selected: id === selectedBoxId
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
                <Card style={styles.infoCardHint}>
                    <Card.Content style={styles.infoHintContent}>
                        <MaterialCommunityIcons name="gesture-tap" size={14} color="#64748B" />
                        <Text variant="bodySmall" style={{ color: '#64748B' }}>
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
            <Card style={styles.infoCard}>
                <Card.Content style={styles.diagCompactContent}>
                    <View style={styles.diagHeaderCompact}>
                        <Text variant="titleSmall" style={{ fontWeight: 'bold', flex: 1 }}>
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
                        <View style={styles.diagPill}>
                            <MaterialCommunityIcons name={selectedBox.connection === 'WiFi' ? 'wifi' : 'antenna'} size={14} color="#3F51B5" />
                            <Text style={styles.diagPillText}>{selectedBox.connection ?? '—'}</Text>
                        </View>
                        <View style={styles.diagPill}>
                            <MaterialCommunityIcons name={sigIcon as any} size={14} color={sigColor} />
                            <Text style={[styles.diagPillText, { color: sigColor }]}>{selectedBox.rssi != null ? `${selectedBox.rssi} dBm` : '—'}</Text>
                        </View>
                        <View style={styles.diagPill}>
                            <MaterialCommunityIcons name={selectedBox.gpsFix ? 'crosshairs-gps' : 'crosshairs-off'} size={14} color={selectedBox.gpsFix ? '#16A34A' : '#DC2626'} />
                            <Text style={styles.diagPillText}>{selectedBox.gpsFix ? 'GPS Fix' : 'No Fix'}</Text>
                        </View>
                        <View style={styles.diagPill}>
                            <MaterialCommunityIcons name="clock-outline" size={14} color="#F59E0B" />
                            <Text style={styles.diagPillText}>{formatTimeAgo(selectedBox.lastUpdated || selectedBox.timestamp)}</Text>
                        </View>
                    </View>
                </Card.Content>
            </Card>
        );
    };

    return (
        <View style={styles.container}>
            {MAPBOX_TOKEN ? (
                <MapboxGL.MapView
                    style={styles.map}
                    logoEnabled={false}
                    attributionEnabled={false}
                    onPress={() => setSelectedBoxId(null)}
                >
                    <MapboxGL.Camera zoomLevel={cameraZoom} centerCoordinate={cameraCenter} />

                    {/* Performance Optimized ShapeSource + CircleLayer */}
                    <MapboxGL.ShapeSource
                        id="hardware-source"
                        ref={shapeSourceRef}
                        shape={{ type: 'FeatureCollection', features: [] }}
                        onPress={(e) => {
                            // Handle press on a feature
                            const feature = e.features[0];
                            if (feature && feature.properties?.id) {
                                selectBox(feature.properties.id);
                            }
                        }}
                    >
                        <MapboxGL.CircleLayer
                            id="hardware-circles"
                            style={{
                                circleColor: ['get', 'color'],
                                circleRadius: [
                                    'interpolate', ['linear'], ['zoom'],
                                    10, 5,
                                    15, ['case', ['get', 'selected'], 18, 12]
                                ],
                                circleStrokeWidth: 2,
                                circleStrokeColor: '#ffffff',
                                circlePitchAlignment: 'map'
                            }}
                        />
                    </MapboxGL.ShapeSource>

                </MapboxGL.MapView>
            ) : (
                <View style={[styles.map, styles.mapFallback]}>
                    <Text style={{ color: '#666' }}>Map unavailable: set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env</Text>
                </View>
            )}

            {/* Top summary banner */}
            <View style={styles.overlayTop}>
                <Card style={styles.topCard}>
                    <Card.Content style={styles.topHudContent}>
                        <LivePulseDot color="#22C55E" />
                        <View style={{ flex: 1 }}>
                            <Text variant="titleSmall" style={{ fontWeight: '800' }}>Live Fleet</Text>
                            <Text variant="labelSmall" style={{ color: '#64748B' }}>
                                {filteredBoxes.length}/{activeBoxes.length} boxes visible
                            </Text>
                        </View>
                        <View style={styles.topHudStats}>
                            <Text style={styles.topHudStatDanger}>T {tamperAlertCount}</Text>
                            <Text style={styles.topHudStat}>A {activeMoveCount}</Text>
                            <Text style={styles.topHudStat}>O {offlineCount}</Text>
                        </View>
                    </Card.Content>
                </Card>

                <Card style={styles.filterCard}>
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
                                    style={[styles.filterChip, fleetFilter === filterKey ? styles.filterChipSelected : null]}
                                    textStyle={fleetFilter === filterKey ? styles.filterChipTextSelected : undefined}
                                >
                                    {filterKey}
                                </Chip>
                            ))}
                        </ScrollView>

                        <View style={styles.filterActions}>
                            <IconButton icon="crosshairs-gps" size={20} onPress={recenterToFleet} />
                            <IconButton
                                icon={listVisible ? 'chevron-down' : 'format-list-bulleted'}
                                size={20}
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
                <View style={styles.listPanel}>
                    <View style={styles.listHeader}>
                        <Text variant="titleMedium" style={{ flex: 1 }}>
                            Box Feed • {fleetFilter} ({filteredBoxes.length})
                        </Text>
                        <IconButton icon="close" size={20} onPress={() => setListVisible(false)} />
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
                                    style={[styles.listItem, isSelected ? styles.listItemSelected : null]}
                                >
                                    <View style={styles.listItemLeft}>
                                        <View style={[styles.listItemDot, { backgroundColor: color }]} />
                                        <View style={{ flex: 1 }}>
                                            <View style={styles.listItemTitleRow}>
                                                <Text variant="titleSmall" style={{ flex: 1 }}>
                                                    {box.id}
                                                </Text>
                                                <Text variant="bodySmall" style={{ color: '#666' }}>
                                                    {box.alert ? 'TAMPER' : box.status}
                                                </Text>
                                            </View>
                                            <View style={styles.listItemMetaRow}>
                                                {/* Signal indicator */}
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
                                                {/* Connection type */}
                                                <View style={styles.listItemMeta}>
                                                    <MaterialCommunityIcons
                                                        name={box.connection === 'WiFi' ? 'wifi' : 'antenna'}
                                                        size={12}
                                                        color="#666"
                                                    />
                                                    <Text style={styles.listItemMetaText}>
                                                        {box.connection ?? '—'}
                                                    </Text>
                                                </View>
                                                {/* GPS fix */}
                                                <View style={styles.listItemMeta}>
                                                    <MaterialCommunityIcons
                                                        name={box.gpsFix ? 'crosshairs-gps' : 'crosshairs-off'}
                                                        size={12}
                                                        color={box.gpsFix ? '#4CAF50' : '#999'}
                                                    />
                                                    <Text style={styles.listItemMetaText}>
                                                        {box.gpsFix ? 'Fix' : 'No Fix'}
                                                    </Text>
                                                </View>
                                                {/* Last update */}
                                                {/* Data consumed */}
                                                <View style={styles.listItemMeta}>
                                                    <MaterialCommunityIcons
                                                        name="cloud-upload-outline"
                                                        size={12}
                                                        color="#666"
                                                    />
                                                    <Text style={styles.listItemMetaText}>
                                                        {formatDataBytes(box.dataBytes)}
                                                    </Text>
                                                </View>
                                                <Text style={[styles.listItemMetaText, { color: '#999' }]}>
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
                                <Text variant="bodySmall" style={{ color: '#999' }}>No boxes match this filter</Text>
                            </View>
                        ) : null}
                    </ScrollView>
                </View>
            ) : null}
        </View>
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
        backgroundColor: '#1D4ED8',
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
