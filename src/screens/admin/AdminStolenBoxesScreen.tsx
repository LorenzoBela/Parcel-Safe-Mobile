import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { MapboxGL, setAccessToken, setTelemetryEnabled } from '../../components/map/MapboxWrapper';
import {
    HardwareByBoxId,
    LocationsByBoxId,
    setTheftState,
    subscribeToAllHardware,
    subscribeToAllLocations,
    TheftState,
} from '../../services/firebaseClient';
import { useAppTheme } from '../../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ALERT_STATES = new Set(['SUSPICIOUS', 'STOLEN', 'LOCKDOWN']);
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
const DEFAULT_CENTER: [number, number] = [121.0244, 14.5547];
const TRACK_HISTORY_LIMIT = 80;

type StolenRow = {
    boxId: string;
    state: string;
    locked: boolean;
    tampered: boolean;
    lat?: number;
    lng?: number;
    updatedAt?: number;
};

function hasCoordinates(item: { lat?: number; lng?: number }): item is { lat: number; lng: number } {
    return Number.isFinite(item.lat) && Number.isFinite(item.lng);
}

function formatLastSeen(timestamp?: number): string {
    if (!timestamp || !Number.isFinite(timestamp)) return 'N/A';
    return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

const lightC = {
    bg: '#F3F3F0',
    card: '#FFFFFF',
    border: '#DEDED8',
    text: '#121212',
    textSec: '#64645F',
    muted: '#8A8A84',
    search: '#ECECE8',
    danger: '#D32F2F',
    warn: '#D97706',
    track: '#1E6FDB',
    mapFallback: '#ECECE8',
    badgeNeutral: '#ECECE8',
    badgeNeutralText: '#53534E',
    badgeWarn: '#F6E8D9',
    badgeWarnText: '#8A5B22',
    badgeDanger: '#F6DDDD',
    badgeDangerText: '#943636',
};

const darkC = {
    bg: '#090909',
    card: '#121212',
    border: '#2A2A2A',
    text: '#F4F4F4',
    textSec: '#B2B2B2',
    muted: '#7A7A7A',
    search: '#171717',
    danger: '#FF5A5A',
    warn: '#F7A845',
    track: '#6BA3FF',
    mapFallback: '#171717',
    badgeNeutral: '#212121',
    badgeNeutralText: '#B9B9B9',
    badgeWarn: '#3D3023',
    badgeWarnText: '#F5BE7A',
    badgeDanger: '#422727',
    badgeDangerText: '#F19999',
};

export default function AdminStolenBoxesScreen() {
    const { isDarkMode } = useAppTheme();
    const insets = useSafeAreaInsets();
    const c = isDarkMode ? darkC : lightC;
    const headerTopPadding = Math.max(insets.top + 8, 18);

    const [hardware, setHardware] = useState<HardwareByBoxId | null>(null);
    const [locations, setLocations] = useState<LocationsByBoxId | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshTick, setRefreshTick] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
    const [followSelected, setFollowSelected] = useState(true);
    const [cameraCenter, setCameraCenter] = useState<[number, number]>(DEFAULT_CENTER);
    const [cameraZoom, setCameraZoom] = useState(12);
    const [trackHistory, setTrackHistory] = useState<Record<string, [number, number][]>>({});

    useEffect(() => {
        setLoading(true);
        if (MAPBOX_TOKEN) {
            setAccessToken(MAPBOX_TOKEN);
            setTelemetryEnabled(false);
        }

        const unsubHw = subscribeToAllHardware((snapshot) => {
            setHardware(snapshot);
            setLoading(false);
        });
        const unsubLoc = subscribeToAllLocations((snapshot) => {
            setLocations(snapshot);
        });
        return () => {
            unsubHw();
            unsubLoc();
        };
    }, [refreshTick]);

    const onRefresh = async () => {
        setRefreshing(true);
        setRefreshTick((prev) => prev + 1);
        await new Promise((resolve) => setTimeout(resolve, 450));
        setRefreshing(false);
    };

    const rows = useMemo<StolenRow[]>(() => {
        const source = hardware || {};
        return Object.entries(source)
            .map(([boxId, hw]) => {
                const theftState = String(hw.theft_state || 'NORMAL').toUpperCase();
                const locked = Boolean(hw.tamper?.lockdown);
                const tampered = Boolean(hw.tamper?.detected);
                const state = theftState === 'NORMAL' && tampered ? 'TAMPER' : theftState;
                const loc = locations?.[boxId];
                return {
                    boxId,
                    state,
                    locked,
                    tampered,
                    lat: loc?.latitude,
                    lng: loc?.longitude,
                    updatedAt: typeof loc?.timestamp === 'number' ? loc.timestamp : hw.last_updated,
                };
            })
            .filter((item) => ALERT_STATES.has(item.state) || item.locked || item.tampered)
            .sort((a, b) => a.boxId.localeCompare(b.boxId));
    }, [hardware, locations]);

    const selectedRow = useMemo(
        () => rows.find((item) => item.boxId === selectedBoxId) || null,
        [rows, selectedBoxId]
    );

    const mapRows = useMemo(
        () => rows.filter((item): item is StolenRow & { lat: number; lng: number } => hasCoordinates(item)),
        [rows]
    );

    const selectedTrack = useMemo(() => {
        if (!selectedBoxId) return [] as [number, number][];
        return trackHistory[selectedBoxId] || [];
    }, [selectedBoxId, trackHistory]);

    const selectedRowKey = selectedRow?.boxId || null;
    const selectedLat = selectedRow?.lat;
    const selectedLng = selectedRow?.lng;
    const selectedHasCoordinates = Number.isFinite(selectedLat) && Number.isFinite(selectedLng);

    useEffect(() => {
        if (rows.length === 0) {
            setSelectedBoxId(null);
            return;
        }

        if (!selectedBoxId || !rows.some((item) => item.boxId === selectedBoxId)) {
            setSelectedBoxId(rows[0].boxId);
        }
    }, [rows, selectedBoxId]);

    useEffect(() => {
        if (!selectedRowKey || !Number.isFinite(selectedLat) || !Number.isFinite(selectedLng)) return;

        const nextPoint: [number, number] = [selectedLng, selectedLat];
        setTrackHistory((prev) => {
            const existing = prev[selectedRowKey] || [];
            const last = existing[existing.length - 1];
            if (last && Math.abs(last[0] - nextPoint[0]) < 0.00001 && Math.abs(last[1] - nextPoint[1]) < 0.00001) {
                return prev;
            }

            const next = [...existing, nextPoint].slice(-TRACK_HISTORY_LIMIT);
            return { ...prev, [selectedRowKey]: next };
        });
    }, [selectedRowKey, selectedLat, selectedLng]);

    useEffect(() => {
        if (!Number.isFinite(selectedLat) || !Number.isFinite(selectedLng)) return;
        if (!followSelected) return;

        setCameraCenter([selectedLng, selectedLat]);
        setCameraZoom(15);
    }, [followSelected, selectedLat, selectedLng]);

    const markerFeatureCollection = useMemo(() => ({
        type: 'FeatureCollection',
        features: mapRows.map((item) => ({
            type: 'Feature',
            id: item.boxId,
            properties: {
                id: item.boxId,
                selected: item.boxId === selectedBoxId,
                state: item.state,
            },
            geometry: {
                type: 'Point',
                coordinates: [item.lng, item.lat],
            },
        })),
    }), [mapRows, selectedBoxId]);

    const selectedTrackFeature = useMemo(() => {
        if (selectedTrack.length < 2) return null;
        return {
            type: 'Feature',
            properties: { id: selectedBoxId || '' },
            geometry: {
                type: 'LineString',
                coordinates: selectedTrack,
            },
        };
    }, [selectedBoxId, selectedTrack]);

    const focusOnBox = (boxId: string, enableFollow: boolean) => {
        setSelectedBoxId(boxId);
        if (enableFollow) {
            setFollowSelected(true);
        }

        const row = rows.find((item) => item.boxId === boxId);
        if (row && hasCoordinates(row)) {
            setCameraCenter([row.lng, row.lat]);
            setCameraZoom(15);
        }
    };

    const applyState = async (boxId: string, state: TheftState) => {
        setBusyId(boxId);
        setError(null);
        try {
            await setTheftState(boxId, state);
        } catch (e: any) {
            setError(e?.message || 'Failed to update theft state');
        } finally {
            setBusyId(null);
        }
    };

    const getStateBadgeStyle = (state: string) => {
        if (state === 'LOCKDOWN' || state === 'STOLEN') {
            return { bg: c.badgeDanger, text: c.badgeDangerText };
        }
        if (state === 'SUSPICIOUS' || state === 'TAMPER') {
            return { bg: c.badgeWarn, text: c.badgeWarnText };
        }
        return { bg: c.badgeNeutral, text: c.badgeNeutralText };
    };

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}> 
            <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.border, paddingTop: headerTopPadding }]}> 
                <Text style={[styles.title, { color: c.text }]}>Stolen Boxes</Text>
                <Text style={[styles.subtitle, { color: c.textSec }]}>Threat-state watchlist and lockdown actions.</Text>
            </View>

            <View style={[styles.mapPanel, { backgroundColor: c.card, borderColor: c.border }]}> 
                <View style={styles.mapTopRow}>
                    <Text style={[styles.mapTitle, { color: c.text }]}>Live Map Preview</Text>
                    <Button
                        compact
                        mode={followSelected ? 'contained' : 'outlined'}
                        buttonColor={followSelected ? c.track : undefined}
                        textColor={followSelected ? '#FFFFFF' : c.track}
                        onPress={() => setFollowSelected((prev) => !prev)}
                        disabled={!selectedHasCoordinates}
                    >
                        {followSelected ? 'Following' : 'Track Live'}
                    </Button>
                </View>

                <View style={[styles.mapFrame, { borderColor: c.border }]}> 
                    {MAPBOX_TOKEN ? (
                        <View style={styles.mapLayerWrap}>
                            <MapboxGL.MapView
                                style={StyleSheet.absoluteFillObject}
                                styleURL={isDarkMode ? MapboxGL.StyleURL.Dark : MapboxGL.StyleURL.Street}
                                logoEnabled={false}
                                attributionEnabled={false}
                            >
                                <MapboxGL.Camera
                                    centerCoordinate={cameraCenter}
                                    zoomLevel={cameraZoom}
                                    animationDuration={900}
                                />

                                {selectedTrackFeature ? (
                                    <MapboxGL.ShapeSource id="stolen-track-source" shape={selectedTrackFeature as any}>
                                        <MapboxGL.LineLayer
                                            id="stolen-track-line"
                                            style={{
                                                lineColor: c.track,
                                                lineWidth: 3,
                                                lineOpacity: 0.9,
                                            } as any}
                                        />
                                    </MapboxGL.ShapeSource>
                                ) : null}

                                {mapRows.length > 0 ? (
                                    <MapboxGL.ShapeSource
                                        id="stolen-markers-source"
                                        shape={markerFeatureCollection as any}
                                        onPress={(event: any) => {
                                            const feature = event?.features?.[0];
                                            const id = feature?.properties?.id;
                                            if (typeof id === 'string' && id.length > 0) {
                                                focusOnBox(id, false);
                                            }
                                        }}
                                    >
                                        <MapboxGL.CircleLayer
                                            id="stolen-markers-layer"
                                            style={{
                                                circleColor: [
                                                    'case',
                                                    ['==', ['get', 'id'], selectedBoxId || ''],
                                                    c.danger,
                                                    ['==', ['get', 'state'], 'LOCKDOWN'],
                                                    c.danger,
                                                    ['==', ['get', 'state'], 'STOLEN'],
                                                    c.danger,
                                                    c.warn,
                                                ],
                                                circleRadius: [
                                                    'case',
                                                    ['==', ['get', 'id'], selectedBoxId || ''],
                                                    10,
                                                    7,
                                                ],
                                                circleStrokeWidth: 2,
                                                circleStrokeColor: isDarkMode ? '#000000' : '#FFFFFF',
                                            } as any}
                                        />
                                    </MapboxGL.ShapeSource>
                                ) : null}
                            </MapboxGL.MapView>

                            {mapRows.length === 0 ? (
                                <View
                                    pointerEvents="none"
                                    style={[
                                        styles.mapEmptyOverlay,
                                        { backgroundColor: isDarkMode ? 'rgba(9,9,9,0.72)' : 'rgba(243,243,240,0.76)' },
                                    ]}
                                >
                                    <Text style={[styles.mapFallbackText, { color: c.textSec }]}>No live coordinates available yet.</Text>
                                </View>
                            ) : null}
                        </View>
                    ) : (
                        <View style={[styles.mapFallback, { backgroundColor: c.mapFallback }]}>
                            <Text style={[styles.mapFallbackText, { color: c.textSec }]}>Map unavailable: set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN.</Text>
                        </View>
                    )}
                </View>

                <View style={styles.mapMetaRow}>
                    <Text style={[styles.mapMetaText, { color: c.text }]}> 
                        {selectedRow ? `Selected: ${selectedRow.boxId}` : 'Select a box to track'}
                    </Text>
                    <Text style={[styles.mapMetaText, { color: c.textSec }]}> 
                        {selectedRow && hasCoordinates(selectedRow)
                            ? `${selectedRow.lat.toFixed(5)}, ${selectedRow.lng.toFixed(5)}`
                            : 'GPS unavailable'}
                    </Text>
                </View>

                <Text style={[styles.trackMeta, { color: c.textSec }]}> 
                    Track points: {selectedTrack.length}
                </Text>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator />
                </View>
            ) : (
                <FlatList
                    data={rows}
                    keyExtractor={(item) => item.boxId}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.track} />}
                    contentContainerStyle={{ padding: 14, paddingBottom: 26 }}
                    ListEmptyComponent={<Text style={[styles.empty, { color: c.textSec }]}>No stolen/suspicious boxes currently flagged.</Text>}
                    renderItem={({ item }) => (
                        <View
                            style={[
                                styles.card,
                                { backgroundColor: c.card, borderColor: c.border },
                                item.boxId === selectedBoxId ? { borderColor: c.track } : null,
                            ]}
                        > 
                            <View style={styles.cardTopRow}>
                                <Text style={[styles.box, { color: c.text }]}>{item.boxId}</Text>
                                <View style={[styles.stateBadge, { backgroundColor: getStateBadgeStyle(item.state).bg }]}>
                                    <Text style={[styles.stateBadgeText, { color: getStateBadgeStyle(item.state).text }]}>{item.state}</Text>
                                </View>
                            </View>

                            <Text style={[styles.meta, { color: c.textSec }]}>Lockdown: {item.locked ? 'ACTIVE' : 'INACTIVE'}</Text>
                            <Text style={[styles.meta, { color: c.textSec }]}>Last Seen: {formatLastSeen(item.updatedAt)}</Text>
                            <Text style={[styles.meta, { color: c.textSec }]}>Location: {hasCoordinates(item) ? `${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}` : 'N/A'}</Text>

                            <View style={styles.actions}>
                                <Button
                                    mode={item.boxId === selectedBoxId && followSelected ? 'contained' : 'outlined'}
                                    compact
                                    onPress={() => focusOnBox(item.boxId, true)}
                                    disabled={!hasCoordinates(item)}
                                    buttonColor={item.boxId === selectedBoxId && followSelected ? c.track : undefined}
                                    textColor={item.boxId === selectedBoxId && followSelected ? '#FFFFFF' : undefined}
                                    style={styles.actionBtn}
                                >
                                    {item.boxId === selectedBoxId && followSelected ? 'Tracking' : 'Track'}
                                </Button>
                                <Button
                                    mode="contained"
                                    compact
                                    onPress={() => applyState(item.boxId, 'LOCKDOWN')}
                                    disabled={busyId === item.boxId}
                                    buttonColor={c.danger}
                                    textColor="#FFFFFF"
                                    style={styles.actionBtn}
                                >
                                    Lockdown
                                </Button>
                                <Button
                                    mode="outlined"
                                    compact
                                    onPress={() => applyState(item.boxId, 'NORMAL')}
                                    disabled={busyId === item.boxId}
                                    style={styles.actionBtn}
                                >
                                    Clear
                                </Button>
                            </View>
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        paddingTop: 18,
        paddingHorizontal: 16,
        paddingBottom: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    title: { fontSize: 24, fontFamily: 'Inter_700Bold' },
    subtitle: { marginTop: 4, fontSize: 13, fontFamily: 'Inter_500Medium' },
    mapPanel: {
        marginHorizontal: 14,
        marginTop: 10,
        marginBottom: 6,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        padding: 12,
    },
    mapTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    mapTitle: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    mapFrame: {
        height: 210,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
    },
    mapFallback: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    mapLayerWrap: {
        flex: 1,
    },
    mapEmptyOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    mapFallbackText: {
        textAlign: 'center',
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    mapMetaRow: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
    },
    mapMetaText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    trackMeta: {
        marginTop: 4,
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    error: {
        color: '#D32F2F',
        marginHorizontal: 16,
        marginTop: 6,
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    empty: { textAlign: 'center', marginTop: 36, fontSize: 13, fontFamily: 'Inter_500Medium' },
    card: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        padding: 12,
        marginBottom: 10,
    },
    cardTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
    },
    stateBadge: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    stateBadgeText: {
        fontSize: 11,
        letterSpacing: 0.4,
        fontFamily: 'Inter_700Bold',
    },
    box: { fontSize: 14, fontFamily: 'Inter_700Bold' },
    meta: { marginTop: 4, fontSize: 13, fontFamily: 'Inter_500Medium' },
    actions: {
        marginTop: 12,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    actionBtn: {
        borderRadius: 10,
    },
});
