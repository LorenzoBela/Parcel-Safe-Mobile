import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    RefreshControl,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View,
} from 'react-native';
import { Chip, Searchbar, Text } from 'react-native-paper';
import { listTrackingHistorySessions, TrackingHistorySession } from '../../services/adminApiService';
import { useAppTheme } from '../../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapboxGL, setAccessToken, setTelemetryEnabled } from '../../components/map/MapboxWrapper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const lightC = {
    bg: '#F3F3F0',
    card: '#FFFFFF',
    border: '#DEDED8',
    text: '#121212',
    textSec: '#64645F',
    chipBg: '#ECECE8',
    chipBorder: '#D9D9D2',
    routeCombined: '#1E6FDB',
    routeBox: '#2E7D32',
    routePhone: '#FB8C00',
    mapFallback: '#ECECE8',
    metricBg: '#ECECE8',
    metricText: '#2F2F2A',
};

const darkC = {
    bg: '#090909',
    card: '#121212',
    border: '#2A2A2A',
    text: '#F4F4F4',
    textSec: '#B2B2B2',
    chipBg: '#171717',
    chipBorder: '#2A2A2A',
    routeCombined: '#6BA3FF',
    routeBox: '#7FCB86',
    routePhone: '#FFB55F',
    mapFallback: '#171717',
    metricBg: '#171717',
    metricText: '#CFCFCF',
};

const DAY_PRESETS = [7, 14, 30, 90] as const;
const DEFAULT_CENTER: [number, number] = [121.0244, 14.5547];
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

type RoutePoint = [number, number];

function toNumber(value: unknown): number | null {
    const next = Number(value);
    return Number.isFinite(next) ? next : null;
}

function normalizeRoutePoints(input: unknown): RoutePoint[] {
    if (!Array.isArray(input)) {
        return [];
    }

    const points: RoutePoint[] = [];
    for (const point of input) {
        if (Array.isArray(point) && point.length >= 2) {
            const lng = toNumber(point[0]);
            const lat = toNumber(point[1]);
            if (lng != null && lat != null) {
                points.push([lng, lat]);
            }
            continue;
        }

        if (point && typeof point === 'object') {
            const source = point as Record<string, unknown>;
            const lng = toNumber(source.lng ?? source.longitude);
            const lat = toNumber(source.lat ?? source.latitude);
            if (lng != null && lat != null) {
                points.push([lng, lat]);
            }
        }
    }

    const deduped: RoutePoint[] = [];
    for (const point of points) {
        const last = deduped[deduped.length - 1];
        if (!last || last[0] !== point[0] || last[1] !== point[1]) {
            deduped.push(point);
        }
    }

    return deduped;
}

function formatDistanceKm(distanceMeters?: number): string {
    if (!Number.isFinite(distanceMeters)) {
        return 'N/A';
    }
    const km = Number(distanceMeters) / 1000;
    return `${km.toFixed(2)} km`;
}

function formatDataSize(value?: string | number): string {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 'N/A';
    }

    if (parsed < 1024) return `${parsed.toFixed(0)} B`;

    const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
    let current = parsed / 1024;
    let idx = 0;

    while (current >= 1024 && idx < units.length - 1) {
        current /= 1024;
        idx += 1;
    }

    const decimals = current >= 100 ? 0 : current >= 10 ? 1 : 2;
    return `${current.toFixed(decimals)} ${units[idx]}`;
}

function formatDuration(seconds?: number): string {
    if (!Number.isFinite(seconds) || Number(seconds) <= 0) {
        return 'N/A';
    }

    const total = Math.floor(Number(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;

    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function formatDateLabel(dateStr?: string): string {
    if (!dateStr) {
        return 'N/A';
    }

    const d = new Date(`${dateStr}T00:00:00+08:00`);
    if (Number.isNaN(d.getTime())) {
        return 'N/A';
    }

    return d.toLocaleDateString('en-US', {
        timeZone: 'Asia/Manila',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function formatUpdatedAt(value?: string): string {
    if (!value) {
        return 'N/A';
    }

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
        return 'N/A';
    }

    return d.toLocaleString('en-US', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function getSessionBoxLabel(session: TrackingHistorySession): string {
    const hwMac = session.box?.hardwareMacAddress;
    if (hwMac) return hwMac;
    if (session.boxId) return session.boxId;
    return 'Unknown Box';
}

export default function AdminTrackingHistoryScreen() {
    const { isDarkMode } = useAppTheme();
    const insets = useSafeAreaInsets();
    const c = isDarkMode ? darkC : lightC;
    const headerTopPadding = Math.max(insets.top + 8, 18);

    const [days, setDays] = useState<number>(30);
    const [sessions, setSessions] = useState<TrackingHistorySession[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [boxFilter, setBoxFilter] = useState<string>('ALL');
    const [boxSearch, setBoxSearch] = useState('');
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [cameraCenter, setCameraCenter] = useState<[number, number]>(DEFAULT_CENTER);
    const [cameraZoom, setCameraZoom] = useState(12);

    useEffect(() => {
        if (!MAPBOX_TOKEN) return;
        setAccessToken(MAPBOX_TOKEN);
        setTelemetryEnabled(false);
    }, []);

    const loadSessions = useCallback(async () => {
        setError(null);
        const data = await listTrackingHistorySessions(days);
        setSessions(data);
    }, [days]);

    useEffect(() => {
        let mounted = true;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await listTrackingHistorySessions(days);
                if (mounted) setSessions(data);
            } catch (e: any) {
                if (mounted) setError(e?.message || 'Failed to load tracking history');
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, [days]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await loadSessions();
        } catch (e: any) {
            setError(e?.message || 'Failed to load tracking history');
        } finally {
            setRefreshing(false);
        }
    }, [loadSessions]);

    const validSessions = useMemo(() => {
        return sessions.filter((s) => {
            const paired = Number(s.pairedSeconds || 0);
            const distance = Number(s.distanceMeters || 0);
            return paired > 0 || distance > 0;
        });
    }, [sessions]);

    const boxOptions = useMemo(() => {
        const next = new Set<string>();
        for (const session of validSessions) {
            next.add(getSessionBoxLabel(session));
        }

        return ['ALL', ...Array.from(next).sort((a, b) => a.localeCompare(b))];
    }, [validSessions]);

    const searchedBoxOptions = useMemo(() => {
        const term = boxSearch.trim().toLowerCase();
        if (!term) {
            return boxOptions;
        }

        return boxOptions.filter((box) => box === 'ALL' || box.toLowerCase().includes(term));
    }, [boxOptions, boxSearch]);

    const filteredSessions = useMemo(() => {
        const term = boxSearch.trim().toLowerCase();

        return validSessions.filter((session) => {
            const boxLabel = getSessionBoxLabel(session);
            const matchesFilter = boxFilter === 'ALL' || boxLabel === boxFilter;
            const matchesSearch = !term || boxLabel.toLowerCase().includes(term);
            return matchesFilter && matchesSearch;
        });
    }, [validSessions, boxFilter, boxSearch]);

    useEffect(() => {
        if (boxFilter === 'ALL') {
            return;
        }

        const exists = boxOptions.some((box) => box === boxFilter);
        if (!exists) {
            setBoxFilter('ALL');
        }
    }, [boxFilter, boxOptions]);

    useEffect(() => {
        if (!selectedSessionId) {
            return;
        }

        const stillVisible = filteredSessions.some((session) => session.id === selectedSessionId);
        if (!stillVisible) {
            setSelectedSessionId(null);
        }
    }, [selectedSessionId, filteredSessions]);

    const selectedSession = useMemo(
        () => filteredSessions.find((s) => s.id === selectedSessionId) || null,
        [filteredSessions, selectedSessionId]
    );

    const selectedCombinedRoute = useMemo(() => {
        const combined = normalizeRoutePoints(selectedSession?.routePoints);
        if (combined.length > 0) {
            return combined;
        }

        const boxRoute = normalizeRoutePoints(selectedSession?.boxRoutePoints);
        const phoneRoute = normalizeRoutePoints(selectedSession?.phoneRoutePoints);
        return [...boxRoute, ...phoneRoute];
    }, [selectedSession]);

    const selectedBoxRoute = useMemo(() => normalizeRoutePoints(selectedSession?.boxRoutePoints), [selectedSession]);
    const selectedPhoneRoute = useMemo(() => normalizeRoutePoints(selectedSession?.phoneRoutePoints), [selectedSession]);

    useEffect(() => {
        if (!selectedCombinedRoute.length) {
            setCameraCenter(DEFAULT_CENTER);
            setCameraZoom(12);
            return;
        }

        const first = selectedCombinedRoute[0];
        setCameraCenter(first);
        setCameraZoom(selectedCombinedRoute.length > 20 ? 12 : 14);
    }, [selectedCombinedRoute]);

    const combinedRouteFeature = useMemo(() => {
        if (selectedCombinedRoute.length < 2) return null;
        return {
            type: 'Feature',
            properties: { id: 'combined' },
            geometry: {
                type: 'LineString',
                coordinates: selectedCombinedRoute,
            },
        };
    }, [selectedCombinedRoute]);

    const boxRouteFeature = useMemo(() => {
        if (selectedBoxRoute.length < 2) return null;
        return {
            type: 'Feature',
            properties: { id: 'box' },
            geometry: {
                type: 'LineString',
                coordinates: selectedBoxRoute,
            },
        };
    }, [selectedBoxRoute]);

    const phoneRouteFeature = useMemo(() => {
        if (selectedPhoneRoute.length < 2) return null;
        return {
            type: 'Feature',
            properties: { id: 'phone' },
            geometry: {
                type: 'LineString',
                coordinates: selectedPhoneRoute,
            },
        };
    }, [selectedPhoneRoute]);

    const startPointFeature = useMemo(() => {
        if (!selectedCombinedRoute.length) return null;
        return {
            type: 'Feature',
            properties: { id: 'start' },
            geometry: {
                type: 'Point',
                coordinates: selectedCombinedRoute[0],
            },
        };
    }, [selectedCombinedRoute]);

    const endPointFeature = useMemo(() => {
        if (!selectedCombinedRoute.length) return null;
        return {
            type: 'Feature',
            properties: { id: 'end' },
            geometry: {
                type: 'Point',
                coordinates: selectedCombinedRoute[selectedCombinedRoute.length - 1],
            },
        };
    }, [selectedCombinedRoute]);

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}> 
            <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.border, paddingTop: headerTopPadding }]}> 
                <Text style={[styles.title, { color: c.text }]}>Tracking History</Text>
                <Text style={[styles.subtitle, { color: c.textSec }]}>Historical route/session tracking from backend archives.</Text>
                <View style={styles.chipRow}>
                    {DAY_PRESETS.map((preset) => (
                        <Chip
                            key={preset}
                            selected={days === preset}
                            onPress={() => setDays(preset)}
                            style={styles.chip}
                        >
                            {preset}d
                        </Chip>
                    ))}
                </View>

                <Searchbar
                    value={boxSearch}
                    onChangeText={setBoxSearch}
                    placeholder="Filter by box ID or hardware MAC"
                    style={[styles.search, { backgroundColor: c.chipBg, borderColor: c.border }]}
                    inputStyle={[styles.searchInput, { color: c.text }]}
                    iconColor={c.textSec}
                    placeholderTextColor={c.textSec}
                />

                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterRow}
                >
                    {searchedBoxOptions.map((box) => (
                        <Chip
                            key={box}
                            selected={boxFilter === box}
                            onPress={() => setBoxFilter(box)}
                            style={styles.filterChip}
                        >
                            {box === 'ALL' ? 'All Boxes' : box}
                        </Chip>
                    ))}
                </ScrollView>

                <Text style={[styles.filterMeta, { color: c.textSec }]}>Showing {filteredSessions.length} of {validSessions.length} sessions</Text>
            </View>

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator />
                </View>
            ) : error ? (
                <Text style={styles.error}>{error}</Text>
            ) : (
                <FlatList
                    data={filteredSessions}
                    keyExtractor={(item, index) => String(item.id || index)}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.text} />}
                    contentContainerStyle={styles.listContent}
                    ListEmptyComponent={<Text style={[styles.empty, { color: c.textSec }]}>No tracking sessions found.</Text>}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            activeOpacity={0.88}
                            onPress={() => setSelectedSessionId(item.id)}
                            style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
                        > 
                            <View style={styles.cardTopRow}>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.main, { color: c.text }]}>{formatDateLabel(item.date)}</Text>
                                    <Text style={[styles.meta, { color: c.textSec }]}>Box: {getSessionBoxLabel(item)}</Text>
                                    <Text style={[styles.meta, { color: c.textSec }]}>Updated: {formatUpdatedAt(item.updatedAt)}</Text>
                                </View>

                                <View style={styles.cardTopRight}>
                                    <Text style={[styles.distanceValue, { color: c.text }]}>{formatDistanceKm(item.distanceMeters)}</Text>
                                    <MaterialCommunityIcons name="chevron-right" size={18} color={c.textSec} />
                                </View>
                            </View>

                            <View style={styles.metricRow}>
                                <View style={[styles.metricChip, { backgroundColor: c.metricBg, borderColor: c.chipBorder }]}>
                                    <Text style={[styles.metricChipLabel, { color: c.textSec }]}>Box Data</Text>
                                    <Text style={[styles.metricChipValue, { color: c.metricText }]}>{formatDataSize(item.dataConsumedBox)}</Text>
                                </View>

                                <View style={[styles.metricChip, { backgroundColor: c.metricBg, borderColor: c.chipBorder }]}>
                                    <Text style={[styles.metricChipLabel, { color: c.textSec }]}>Phone Data</Text>
                                    <Text style={[styles.metricChipValue, { color: c.metricText }]}>{formatDataSize(item.dataConsumedPhone)}</Text>
                                </View>

                                <View style={[styles.metricChip, { backgroundColor: c.metricBg, borderColor: c.chipBorder }]}>
                                    <Text style={[styles.metricChipLabel, { color: c.textSec }]}>Duration</Text>
                                    <Text style={[styles.metricChipValue, { color: c.metricText }]}>{formatDuration(item.sessionSeconds)}</Text>
                                </View>
                            </View>
                        </TouchableOpacity>
                    )}
                />
            )}

            <Modal
                visible={Boolean(selectedSession)}
                animationType="slide"
                transparent
                onRequestClose={() => setSelectedSessionId(null)}
            >
                <View style={styles.modalBackdrop}>
                    <View style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}> 
                        <View style={styles.modalHeader}>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.modalTitle, { color: c.text }]}>Route Detail</Text>
                                <Text style={[styles.modalSubtitle, { color: c.textSec }]}>
                                    {selectedSession ? formatDateLabel(selectedSession.date) : 'N/A'} - {selectedSession ? getSessionBoxLabel(selectedSession) : 'N/A'}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={() => setSelectedSessionId(null)} style={[styles.modalClose, { borderColor: c.border }]}> 
                                <MaterialCommunityIcons name="close" size={18} color={c.textSec} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
                            {selectedSession ? (
                                <>
                                    <View style={styles.modalMetricsRow}>
                                        <View style={[styles.modalMetricCard, { backgroundColor: c.metricBg, borderColor: c.chipBorder }]}> 
                                            <Text style={[styles.modalMetricLabel, { color: c.textSec }]}>Distance</Text>
                                            <Text style={[styles.modalMetricValue, { color: c.text }]}>{formatDistanceKm(selectedSession.distanceMeters)}</Text>
                                        </View>
                                        <View style={[styles.modalMetricCard, { backgroundColor: c.metricBg, borderColor: c.chipBorder }]}> 
                                            <Text style={[styles.modalMetricLabel, { color: c.textSec }]}>Session</Text>
                                            <Text style={[styles.modalMetricValue, { color: c.text }]}>{formatDuration(selectedSession.sessionSeconds)}</Text>
                                        </View>
                                        <View style={[styles.modalMetricCard, { backgroundColor: c.metricBg, borderColor: c.chipBorder }]}> 
                                            <Text style={[styles.modalMetricLabel, { color: c.textSec }]}>Paired</Text>
                                            <Text style={[styles.modalMetricValue, { color: c.text }]}>{formatDuration(selectedSession.pairedSeconds)}</Text>
                                        </View>
                                    </View>

                                    <View style={styles.modalMetricsRow}>
                                        <View style={[styles.modalMetricCard, { backgroundColor: c.metricBg, borderColor: c.chipBorder }]}> 
                                            <Text style={[styles.modalMetricLabel, { color: c.textSec }]}>Box Data</Text>
                                            <Text style={[styles.modalMetricValue, { color: c.text }]}>{formatDataSize(selectedSession.dataConsumedBox)}</Text>
                                        </View>
                                        <View style={[styles.modalMetricCard, { backgroundColor: c.metricBg, borderColor: c.chipBorder }]}> 
                                            <Text style={[styles.modalMetricLabel, { color: c.textSec }]}>Phone Data</Text>
                                            <Text style={[styles.modalMetricValue, { color: c.text }]}>{formatDataSize(selectedSession.dataConsumedPhone)}</Text>
                                        </View>
                                        <View style={[styles.modalMetricCard, { backgroundColor: c.metricBg, borderColor: c.chipBorder }]}> 
                                            <Text style={[styles.modalMetricLabel, { color: c.textSec }]}>Points</Text>
                                            <Text style={[styles.modalMetricValue, { color: c.text }]}>{selectedCombinedRoute.length}</Text>
                                        </View>
                                    </View>

                                    <View style={[styles.legendRow, { borderColor: c.border }]}> 
                                        <View style={styles.legendItem}>
                                            <View style={[styles.legendDot, { backgroundColor: c.routeCombined }]} />
                                            <Text style={[styles.legendText, { color: c.textSec }]}>Combined</Text>
                                        </View>
                                        <View style={styles.legendItem}>
                                            <View style={[styles.legendDot, { backgroundColor: c.routeBox }]} />
                                            <Text style={[styles.legendText, { color: c.textSec }]}>Box</Text>
                                        </View>
                                        <View style={styles.legendItem}>
                                            <View style={[styles.legendDot, { backgroundColor: c.routePhone }]} />
                                            <Text style={[styles.legendText, { color: c.textSec }]}>Phone</Text>
                                        </View>
                                    </View>

                                    <View style={[styles.mapFrame, { borderColor: c.border }]}> 
                                        {MAPBOX_TOKEN ? (
                                            selectedCombinedRoute.length > 1 ? (
                                                <MapboxGL.MapView
                                                    style={StyleSheet.absoluteFillObject}
                                                    logoEnabled={false}
                                                    attributionEnabled={false}
                                                >
                                                    <MapboxGL.Camera
                                                        centerCoordinate={cameraCenter}
                                                        zoomLevel={cameraZoom}
                                                        animationDuration={800}
                                                    />

                                                    {combinedRouteFeature ? (
                                                        <MapboxGL.ShapeSource id="history-route-combined" shape={combinedRouteFeature as any}>
                                                            <MapboxGL.LineLayer
                                                                id="history-route-combined-line"
                                                                style={{
                                                                    lineColor: c.routeCombined,
                                                                    lineWidth: 4,
                                                                    lineOpacity: 0.9,
                                                                } as any}
                                                            />
                                                        </MapboxGL.ShapeSource>
                                                    ) : null}

                                                    {boxRouteFeature ? (
                                                        <MapboxGL.ShapeSource id="history-route-box" shape={boxRouteFeature as any}>
                                                            <MapboxGL.LineLayer
                                                                id="history-route-box-line"
                                                                style={{
                                                                    lineColor: c.routeBox,
                                                                    lineWidth: 2,
                                                                    lineOpacity: 0.8,
                                                                } as any}
                                                            />
                                                        </MapboxGL.ShapeSource>
                                                    ) : null}

                                                    {phoneRouteFeature ? (
                                                        <MapboxGL.ShapeSource id="history-route-phone" shape={phoneRouteFeature as any}>
                                                            <MapboxGL.LineLayer
                                                                id="history-route-phone-line"
                                                                style={{
                                                                    lineColor: c.routePhone,
                                                                    lineWidth: 2,
                                                                    lineOpacity: 0.8,
                                                                } as any}
                                                            />
                                                        </MapboxGL.ShapeSource>
                                                    ) : null}

                                                    {startPointFeature ? (
                                                        <MapboxGL.ShapeSource id="history-start-point" shape={startPointFeature as any}>
                                                            <MapboxGL.CircleLayer
                                                                id="history-start-point-layer"
                                                                style={{
                                                                    circleColor: '#22c55e',
                                                                    circleRadius: 6,
                                                                    circleStrokeWidth: 2,
                                                                    circleStrokeColor: isDarkMode ? '#000000' : '#FFFFFF',
                                                                } as any}
                                                            />
                                                        </MapboxGL.ShapeSource>
                                                    ) : null}

                                                    {endPointFeature ? (
                                                        <MapboxGL.ShapeSource id="history-end-point" shape={endPointFeature as any}>
                                                            <MapboxGL.CircleLayer
                                                                id="history-end-point-layer"
                                                                style={{
                                                                    circleColor: '#ef4444',
                                                                    circleRadius: 6,
                                                                    circleStrokeWidth: 2,
                                                                    circleStrokeColor: isDarkMode ? '#000000' : '#FFFFFF',
                                                                } as any}
                                                            />
                                                        </MapboxGL.ShapeSource>
                                                    ) : null}
                                                </MapboxGL.MapView>
                                            ) : (
                                                <View style={[styles.mapFallback, { backgroundColor: c.mapFallback }]}> 
                                                    <Text style={[styles.mapFallbackText, { color: c.textSec }]}>No route points recorded for this session.</Text>
                                                </View>
                                            )
                                        ) : (
                                            <View style={[styles.mapFallback, { backgroundColor: c.mapFallback }]}> 
                                                <Text style={[styles.mapFallbackText, { color: c.textSec }]}>Map unavailable: set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN.</Text>
                                            </View>
                                        )}
                                    </View>
                                </>
                            ) : null}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
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
    chipRow: {
        marginTop: 10,
        flexDirection: 'row',
        gap: 8,
    },
    chip: { marginRight: 8, borderWidth: StyleSheet.hairlineWidth },
    search: {
        marginTop: 10,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 0,
        borderRadius: 12,
        minHeight: 44,
    },
    searchInput: {
        fontFamily: 'Inter_500Medium',
        fontSize: 14,
    },
    filterRow: {
        marginTop: 8,
        paddingRight: 6,
        gap: 8,
    },
    filterChip: {
        borderWidth: StyleSheet.hairlineWidth,
    },
    filterMeta: {
        marginTop: 8,
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    error: {
        color: '#D32F2F',
        marginHorizontal: 16,
        marginTop: 12,
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    empty: { textAlign: 'center', marginTop: 36, fontSize: 13, fontFamily: 'Inter_500Medium' },
    listContent: {
        padding: 14,
        paddingBottom: 28,
    },
    card: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        padding: 13,
        marginBottom: 10,
    },
    cardTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 8,
    },
    cardTopRight: {
        alignItems: 'flex-end',
        gap: 2,
    },
    main: { fontSize: 15, fontFamily: 'Inter_700Bold' },
    meta: { marginTop: 2, fontSize: 12, fontFamily: 'Inter_500Medium' },
    distanceValue: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    metricRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 10,
    },
    metricChip: {
        flex: 1,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    metricChipLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
    },
    metricChipValue: {
        marginTop: 3,
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.42)',
        justifyContent: 'flex-end',
    },
    modalCard: {
        maxHeight: '90%',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 8,
    },
    modalTitle: {
        fontSize: 18,
        fontFamily: 'Inter_700Bold',
    },
    modalSubtitle: {
        marginTop: 2,
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    modalClose: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalBody: {
        paddingHorizontal: 14,
    },
    modalBodyContent: {
        paddingBottom: 16,
    },
    modalMetricsRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 8,
    },
    modalMetricCard: {
        flex: 1,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    modalMetricLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
    },
    modalMetricValue: {
        marginTop: 3,
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
    },
    legendRow: {
        marginTop: 2,
        marginBottom: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingVertical: 8,
        paddingHorizontal: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    legendDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    legendText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    mapFrame: {
        height: 320,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
    },
    mapFallback: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    mapFallbackText: {
        textAlign: 'center',
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
});
