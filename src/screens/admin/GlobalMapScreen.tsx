import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Dimensions, ScrollView, TouchableOpacity } from 'react-native';
import { Card, Text, IconButton } from 'react-native-paper';
import MapboxGL from '../../components/map/MapboxWrapper';
import {
    HardwareByBoxId,
    LocationsByBoxId,
    subscribeToAllHardware,
    subscribeToAllLocations,
} from '../../services/firebaseClient';

type BoxMarker = {
    id: string;
    lat: number;
    lng: number;
    alert: boolean;
    status: string;
    gpsSource?: string;
    timestamp?: number;
};

const DEFAULT_CENTER: [number, number] = [121.0244, 14.5547]; // Manila

export default function GlobalMapScreen() {
    const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const [locationsByBox, setLocationsByBox] = useState<LocationsByBoxId | null>(null);
    const [hardwareByBox, setHardwareByBox] = useState<HardwareByBoxId | null>(null);

    const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
    const [listVisible, setListVisible] = useState(false);

    const [cameraCenter, setCameraCenter] = useState<[number, number]>(DEFAULT_CENTER);
    const [cameraZoom, setCameraZoom] = useState<number>(12);

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
                const hw = (hardwareByBox && (hardwareByBox as any)[boxId]) || null;
                const tamper = hw?.tamper;
                const alert = Boolean(tamper?.lockdown || tamper?.detected);
                const status = typeof hw?.status === 'string' ? hw.status : alert ? 'TAMPER' : 'UNKNOWN';

                return {
                    id: boxId,
                    lat: typeof location?.latitude === 'number' ? location.latitude : NaN,
                    lng: typeof location?.longitude === 'number' ? location.longitude : NaN,
                    alert,
                    status,
                    gpsSource: location?.source,
                    timestamp: location?.timestamp,
                };
            })
            .filter((b) => isValidLat(b.lat) && isValidLng(b.lng));
    }, [locationsByBox, hardwareByBox]);

    const tamperAlertCount = useMemo(() => activeBoxes.filter((b) => b.alert).length, [activeBoxes]);

    useEffect(() => {
        if (activeBoxes.length === 0) return;
        if (cameraCenter[0] !== DEFAULT_CENTER[0] || cameraCenter[1] !== DEFAULT_CENTER[1]) return;
        setCameraCenter([activeBoxes[0].lng, activeBoxes[0].lat]);
        setCameraZoom(13);
    }, [activeBoxes, cameraCenter]);

    const selectedBox = useMemo(() => {
        if (!selectedBoxId) return null;
        const location = (locationsByBox && (locationsByBox as any)[selectedBoxId]) as any;
        const hardware = (hardwareByBox && (hardwareByBox as any)[selectedBoxId]) as any;

        const status = typeof hardware?.status === 'string' ? hardware.status : 'UNKNOWN';
        const tamper = hardware?.tamper;
        const tamperActive = Boolean(tamper?.lockdown || tamper?.detected);

        return {
            id: selectedBoxId,
            status,
            tamperActive,
            gpsSource: location?.source,
            timestamp: location?.timestamp,
        };
    }, [selectedBoxId, locationsByBox, hardwareByBox]);

    const formatTimestamp = (timestamp?: number) => {
        if (!timestamp || !Number.isFinite(timestamp)) return '—';
        if (timestamp < 1600000000000) return '—';
        try {
            return new Date(timestamp).toLocaleString();
        } catch {
            return '—';
        }
    };

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

                    {activeBoxes.map((box) => {
                        const isSelected = selectedBoxId === box.id;
                        const color = getStatusColor(box.status, box.alert);

                        return (
                            <MapboxGL.PointAnnotation
                                key={box.id}
                                id={`box-${box.id}`}
                                coordinate={[box.lng, box.lat]}
                                title={box.id}
                                onSelected={() => selectBox(box.id)}
                            >
                                <View
                                    style={[
                                        styles.markerDot,
                                        {
                                            backgroundColor: color,
                                            transform: [{ scale: isSelected ? 1.15 : 1 }],
                                        },
                                    ]}
                                />
                            </MapboxGL.PointAnnotation>
                        );
                    })}
                </MapboxGL.MapView>
            ) : (
                <View style={[styles.map, styles.mapFallback]}>
                    <Text style={{ color: '#666' }}>Map unavailable: set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env</Text>
                </View>
            )}

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

            <View style={styles.overlayInfo}>
                <Card>
                    <Card.Content>
                        {selectedBox ? (
                            <>
                                <Text variant="titleSmall">Selected: {selectedBox.id}</Text>
                                <Text variant="bodySmall">Status: {selectedBox.tamperActive ? 'TAMPER' : selectedBox.status}</Text>
                                <Text variant="bodySmall">GPS: {selectedBox.gpsSource ?? '—'}</Text>
                                <Text variant="bodySmall">Last update: {formatTimestamp(selectedBox.timestamp)}</Text>
                            </>
                        ) : (
                            <Text variant="bodySmall" style={{ color: '#666' }}>Tap a marker to view live status</Text>
                        )}
                    </Card.Content>
                </Card>
            </View>

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
                                            <Text variant="titleSmall">{box.id}</Text>
                                            <Text variant="bodySmall" style={{ color: '#666' }}>
                                                {box.alert ? 'TAMPER' : box.status}
                                            </Text>
                                            <Text variant="bodySmall" style={{ color: '#999', fontSize: 11 }}>
                                                GPS: {box.gpsSource ?? '—'} • {formatTimestamp(box.timestamp)}
                                            </Text>
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
        left: 20,
        right: 20,
    },
    topCardContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
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
});
