import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, StyleSheet, Dimensions, ScrollView, TouchableOpacity } from 'react-native';
import { Card, Text, IconButton, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MapboxGL from '../../components/map/MapboxWrapper';
import {
    HardwareByBoxId,
    HardwareDiagnostics,
    LocationsByBoxId,
    subscribeToAllHardware,
    subscribeToAllLocations,
} from '../../services/firebaseClient';

// ==================== Types ====================

type BoxMarker = {
    id: string;
    lat: number;
    lng: number;
    alert: boolean;
    status: string;
    gpsSource?: string;
    timestamp?: number;
    // Diagnostics fields from hardware node
    connection?: string;
    rssi?: number;
    csq?: number;
    op?: string;
    gpsFix?: boolean;
    lastUpdated?: number;
    dataBytes?: number;
};

// Animation Types
type AnimationState = {
    current: [number, number];
    target: [number, number];
    startTime: number;
    start: [number, number];
};

const DEFAULT_CENTER: [number, number] = [121.0244, 14.5547]; // Manila
const ANIMATION_DURATION = 1000;

// ==================== Helpers ====================

/** Convert CSQ (0-31) to a 0–4 bar level for display */
function getSignalBars(csq?: number): number {
    if (csq == null || csq === 99 || csq <= 0) return 0;
    if (csq <= 5) return 1;
    if (csq <= 12) return 2;
    if (csq <= 20) return 3;
    return 4;
}

/** Pick the right signal-bars icon name */
function getSignalIcon(bars: number): string {
    switch (bars) {
        case 0: return 'signal-off';
        case 1: return 'signal-cellular-1';
        case 2: return 'signal-cellular-2';
        case 3: return 'signal-cellular-3';
        default: return 'signal-cellular-outline';
    }
}

/** Get a tint color for signal quality */
function getSignalColor(bars: number): string {
    switch (bars) {
        case 0: return '#9E9E9E';
        case 1: return '#F44336';
        case 2: return '#FF9800';
        case 3: return '#4CAF50';
        default: return '#2E7D32';
    }
}

/** Format byte count as human-readable (KB / MB) */
function formatDataBytes(bytes?: number): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
}

/** Derive a meaningful status when the firmware doesn't send one */
function deriveStatus(hw: HardwareDiagnostics | null): string {
    if (!hw) return 'OFFLINE';
    // If firmware sent an explicit status, use it
    if (typeof hw.status === 'string' && hw.status.length > 0) return hw.status;
    // Derive from connection + GPS state
    if (hw.gps_fix) return 'ACTIVE';
    if (hw.connection) return 'STANDBY';
    return 'IDLE';
}

/** Format a timestamp as relative "X ago" or absolute fallback */
function formatTimeAgo(timestamp?: number): string {
    if (!timestamp || !Number.isFinite(timestamp)) return '—';
    // Device sends millis() which resets on reboot — detect invalid epoch
    if (timestamp < 1600000000000) {
        // millis() value — show as uptime instead
        const totalSec = Math.floor(timestamp / 1000);
        if (totalSec < 60) return `${totalSec}s uptime`;
        const mins = Math.floor(totalSec / 60);
        if (mins < 60) return `${mins}m uptime`;
        const hours = Math.floor(mins / 60);
        const remMins = mins % 60;
        return `${hours}h ${remMins}m uptime`;
    }
    const now = Date.now();
    const diffMs = now - timestamp;
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

// ==================== Component ====================

export default function GlobalMapScreen() {
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const [locationsByBox, setLocationsByBox] = useState<LocationsByBoxId | null>(null);
    const [hardwareByBox, setHardwareByBox] = useState<HardwareByBoxId | null>(null);

    const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
    const [listVisible, setListVisible] = useState(false);

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

    // Initial center
    useEffect(() => {
        if (activeBoxes.length === 0) return;
        if (cameraCenter[0] === DEFAULT_CENTER[0] && cameraCenter[1] === DEFAULT_CENTER[1]) {
            setCameraCenter([activeBoxes[0].lng, activeBoxes[0].lat]);
            setCameraZoom(13);
        }
    }, [activeBoxes, cameraCenter]);

    // Animation Loop
    useEffect(() => {
        const updateAnimationTargets = () => {
            activeBoxes.forEach(box => {
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
                // Check if box still exists in activeBoxes (handle removal)
                const box = activeBoxes.find(b => b.id === id);
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
    }, [activeBoxes, selectedBoxId]); // Re-run when list changes or selection changes (to update styling props)

    const selectedBox = useMemo(() => {
        if (!selectedBoxId) return null;
        return activeBoxes.find((b) => b.id === selectedBoxId) ?? null;
    }, [selectedBoxId, activeBoxes]);

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
                <Card style={styles.infoCard}>
                    <Card.Content>
                        <Text variant="bodySmall" style={{ color: '#666' }}>
                            Tap a marker to view live diagnostics
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
                <Card.Content>
                    {/* Header row */}
                    <View style={styles.diagHeader}>
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

                    {/* Diagnostics grid */}
                    <View style={styles.diagGrid}>
                        {/* Connection */}
                        <View style={styles.diagItem}>
                            <MaterialCommunityIcons
                                name={selectedBox.connection === 'WiFi' ? 'wifi' : 'antenna'}
                                size={16}
                                color="#3F51B5"
                            />
                            <Text style={styles.diagLabel}>Connection</Text>
                            <Text style={styles.diagValue}>
                                {selectedBox.connection ?? '—'}
                            </Text>
                        </View>

                        {/* Signal Strength */}
                        <View style={styles.diagItem}>
                            <MaterialCommunityIcons
                                name={sigIcon as any}
                                size={16}
                                color={sigColor}
                            />
                            <Text style={styles.diagLabel}>Signal</Text>
                            <Text style={[styles.diagValue, { color: sigColor }]}>
                                {selectedBox.rssi != null ? `${selectedBox.rssi} dBm` : '—'}
                            </Text>
                        </View>

                        {/* Operator */}
                        <View style={styles.diagItem}>
                            <MaterialCommunityIcons name="cellphone-wireless" size={16} color="#607D8B" />
                            <Text style={styles.diagLabel}>Operator</Text>
                            <Text style={styles.diagValue} numberOfLines={1}>
                                {selectedBox.op ?? '—'}
                            </Text>
                        </View>

                        {/* GPS Fix */}
                        <View style={styles.diagItem}>
                            <MaterialCommunityIcons
                                name={selectedBox.gpsFix ? 'crosshairs-gps' : 'crosshairs-off'}
                                size={16}
                                color={selectedBox.gpsFix ? '#4CAF50' : '#F44336'}
                            />
                            <Text style={styles.diagLabel}>GPS Fix</Text>
                            <Text
                                style={[
                                    styles.diagValue,
                                    { color: selectedBox.gpsFix ? '#4CAF50' : '#F44336' },
                                ]}
                            >
                                {selectedBox.gpsFix != null
                                    ? selectedBox.gpsFix ? 'Yes' : 'No'
                                    : '—'}
                            </Text>
                        </View>

                        {/* GPS Source */}
                        <View style={styles.diagItem}>
                            <MaterialCommunityIcons name="satellite-uplink" size={16} color="#795548" />
                            <Text style={styles.diagLabel}>GPS Src</Text>
                            <Text style={styles.diagValue}>
                                {selectedBox.gpsSource ?? '—'}
                            </Text>
                        </View>

                        {/* Data Consumed */}
                        <View style={styles.diagItem}>
                            <MaterialCommunityIcons name="cloud-upload-outline" size={16} color="#3F51B5" />
                            <Text style={styles.diagLabel}>Data Out</Text>
                            <Text style={styles.diagValue}>
                                {formatDataBytes(selectedBox.dataBytes)}
                            </Text>
                        </View>

                        {/* Last Update */}
                        <View style={styles.diagItem}>
                            <MaterialCommunityIcons name="clock-outline" size={16} color="#FF9800" />
                            <Text style={styles.diagLabel}>Updated</Text>
                            <Text style={styles.diagValue}>
                                {formatTimeAgo(selectedBox.lastUpdated || selectedBox.timestamp)}
                            </Text>
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
                <Card>
                    <Card.Content style={styles.topCardContent}>
                        <View style={{ flex: 1 }}>
                            <Text variant="titleMedium">Active Fleet: {activeBoxes.length}</Text>
                            <Text variant="bodySmall" style={{ color: 'red' }}>
                                {tamperAlertCount} Tamper Alert{tamperAlertCount === 1 ? '' : 's'} Active
                            </Text>
                        </View>
                        <IconButton
                            icon={listVisible ? 'chevron-down' : 'format-list-bulleted'}
                            size={24}
                            onPress={() => setListVisible((v) => !v)}
                        />
                    </Card.Content>
                </Card>
            </View>

            {/* Diagnostics info panel */}
            <View style={styles.overlayInfo}>
                {renderDiagnosticsCard()}
            </View>

            {/* Box list panel */}
            {listVisible ? (
                <View style={styles.listPanel}>
                    <View style={styles.listHeader}>
                        <Text variant="titleMedium" style={{ flex: 1 }}>
                            All Boxes ({activeBoxes.length})
                        </Text>
                        <IconButton icon="close" size={20} onPress={() => setListVisible(false)} />
                    </View>
                    <ScrollView style={styles.listScroll}>
                        {activeBoxes.map((box) => {
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

                        {activeBoxes.length === 0 ? (
                            <View style={{ padding: 20, alignItems: 'center' }}>
                                <Text variant="bodySmall" style={{ color: '#999' }}>No active boxes detected</Text>
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
        top: 50,
        left: 20,
        right: 20,
    },
    overlayInfo: {
        position: 'absolute',
        top: 130,
        left: 12,
        right: 12,
    },
    infoCard: {
        borderRadius: 14,
        elevation: 4,
    },
    topCardContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
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
        maxHeight: 320,
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
