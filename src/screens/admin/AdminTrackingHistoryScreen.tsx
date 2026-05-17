import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View,
} from 'react-native';
import { Searchbar, Text } from 'react-native-paper';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
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
    filterPanel: '#F8F8F5',
    rangeRail: '#EEEEE9',
    rangeRailBorder: '#DCDCD5',
    rangePill: '#F7F7F3',
    rangePillBorder: '#D5D5CE',
    rangePillActive: '#121212',
    rangePillActiveText: '#FFFFFF',
    rangePillText: '#4D4D47',
    searchBg: '#F8F8F4',
    searchBorder: '#D9D9D2',
    boxPill: '#F2F2ED',
    boxPillBorder: '#D7D7D0',
    boxPillActive: '#151515',
    boxPillActiveText: '#FFFFFF',
    boxPillText: '#44443F',
    countBadgeBg: '#E9E9E3',
    countBadgeText: '#34342F',
    resetBg: '#ECECE8',
    resetText: '#2F2F2A',
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
    filterPanel: '#151515',
    rangeRail: '#1F1F1F',
    rangeRailBorder: '#303030',
    rangePill: '#232323',
    rangePillBorder: '#353535',
    rangePillActive: '#F0F0F0',
    rangePillActiveText: '#111111',
    rangePillText: '#CBCBCB',
    searchBg: '#1B1B1B',
    searchBorder: '#303030',
    boxPill: '#202020',
    boxPillBorder: '#323232',
    boxPillActive: '#E9E9E9',
    boxPillActiveText: '#101010',
    boxPillText: '#C8C8C8',
    countBadgeBg: '#222222',
    countBadgeText: '#D6D6D6',
    resetBg: '#1F1F1F',
    resetText: '#D0D0D0',
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
const PAGE_SIZE = 8;

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

function parseSessionDate(session: TrackingHistorySession): Date | null {
    if (session.date) {
        const fromDate = new Date(`${session.date}T00:00:00+08:00`);
        if (!Number.isNaN(fromDate.getTime())) {
            return fromDate;
        }
    }

    if (session.updatedAt) {
        const fromUpdated = new Date(session.updatedAt);
        if (!Number.isNaN(fromUpdated.getTime())) {
            return fromUpdated;
        }
    }

    return null;
}

function formatFilterDateLabel(value: Date | null): string {
    if (!value) return 'Any date';
    return value.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
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
    const [startDate, setStartDate] = useState<Date | null>(null);
    const [endDate, setEndDate] = useState<Date | null>(null);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [datePickerMode, setDatePickerMode] = useState<'start' | 'end'>('start');
    const [filtersExpanded, setFiltersExpanded] = useState(true);
    const [showTraffic, setShowTraffic] = useState(false);
    const [page, setPage] = useState(1);
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

        const from = startDate ? new Date(startDate) : null;
        const to = endDate ? new Date(endDate) : null;
        if (from) from.setHours(0, 0, 0, 0);
        if (to) to.setHours(23, 59, 59, 999);

        return validSessions.filter((session) => {
            const boxLabel = getSessionBoxLabel(session);
            const matchesFilter = boxFilter === 'ALL' || boxLabel === boxFilter;
            const matchesSearch = !term || boxLabel.toLowerCase().includes(term);

            let matchesDate = true;
            if (from || to) {
                const sessionDate = parseSessionDate(session);
                if (!sessionDate) {
                    matchesDate = false;
                } else {
                    if (from && sessionDate < from) matchesDate = false;
                    if (to && sessionDate > to) matchesDate = false;
                }
            }

            return matchesFilter && matchesSearch && matchesDate;
        });
    }, [validSessions, boxFilter, boxSearch, startDate, endDate]);

    useEffect(() => {
        setPage(1);
    }, [days, boxFilter, boxSearch, startDate, endDate]);

    const totalPages = useMemo(
        () => Math.max(1, Math.ceil(filteredSessions.length / PAGE_SIZE)),
        [filteredSessions.length]
    );

    useEffect(() => {
        if (page > totalPages) {
            setPage(totalPages);
        }
    }, [page, totalPages]);

    const paginatedSessions = useMemo(() => {
        const startIndex = (page - 1) * PAGE_SIZE;
        return filteredSessions.slice(startIndex, startIndex + PAGE_SIZE);
    }, [filteredSessions, page]);

    const pageRangeLabel = useMemo(() => {
        if (filteredSessions.length === 0) return '0-0';
        const from = (page - 1) * PAGE_SIZE + 1;
        const to = Math.min(page * PAGE_SIZE, filteredSessions.length);
        return `${from}-${to}`;
    }, [filteredSessions.length, page]);

    const collapsedFilterSummary = useMemo(() => {
        const summary = [`Window: ${days}D`];

        if (boxFilter !== 'ALL') {
            summary.push(`Box: ${boxFilter}`);
        }

        if (startDate || endDate) {
            summary.push(`Dates: ${formatFilterDateLabel(startDate)} - ${formatFilterDateLabel(endDate)}`);
        }

        const term = boxSearch.trim();
        if (term.length > 0) {
            summary.push(`Search: ${term}`);
        }

        return summary.join(' • ');
    }, [days, boxFilter, startDate, endDate, boxSearch]);

    const showDateMode = (mode: 'start' | 'end') => {
        setDatePickerMode(mode);
        setShowDatePicker(true);
    };

    const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
        if (Platform.OS !== 'ios') {
            setShowDatePicker(false);
        }

        if (event.type === 'dismissed' || !selectedDate) {
            return;
        }

        if (datePickerMode === 'start') {
            setStartDate(selectedDate);
            if (endDate && selectedDate > endDate) {
                setEndDate(selectedDate);
            }
            return;
        }

        setEndDate(selectedDate);
        if (startDate && selectedDate < startDate) {
            setStartDate(selectedDate);
        }
    };

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

                <View style={[styles.filterPanel, { backgroundColor: c.filterPanel, borderColor: c.border }]}>
                    <View style={styles.filterHeaderRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.filterSectionLabel, { color: c.textSec }]}>Session Window</Text>
                            <Text style={[styles.filterSectionTitle, { color: c.text }]}>Range and Box Filters</Text>
                        </View>

                        <View style={styles.filterHeaderActions}>
                            <View style={[styles.resultsBadge, { backgroundColor: c.countBadgeBg, borderColor: c.border }]}>
                                <Text style={[styles.resultsBadgeText, { color: c.countBadgeText }]}>{filteredSessions.length}</Text>
                            </View>

                            <TouchableOpacity
                                activeOpacity={0.85}
                                onPress={() => {
                                    setFiltersExpanded((prev) => {
                                        const next = !prev;
                                        if (!next) {
                                            setShowDatePicker(false);
                                        }
                                        return next;
                                    });
                                }}
                                style={[styles.filterToggleBtn, { backgroundColor: c.searchBg, borderColor: c.searchBorder }]}
                            >
                                <MaterialCommunityIcons
                                    name={filtersExpanded ? 'chevron-up' : 'chevron-down'}
                                    size={18}
                                    color={c.textSec}
                                />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {filtersExpanded ? (
                        <>
                            <View style={[styles.rangeRail, { backgroundColor: c.rangeRail, borderColor: c.rangeRailBorder }]}>
                                {DAY_PRESETS.map((preset) => {
                                    const active = days === preset;
                                    return (
                                        <TouchableOpacity
                                            key={preset}
                                            activeOpacity={0.9}
                                            onPress={() => setDays(preset)}
                                            style={[
                                                styles.rangePill,
                                                {
                                                    backgroundColor: active ? c.rangePillActive : c.rangePill,
                                                    borderColor: active ? c.rangePillActive : c.rangePillBorder,
                                                },
                                            ]}
                                        >
                                            <Text style={[styles.rangePillText, { color: active ? c.rangePillActiveText : c.rangePillText }]}>
                                                {preset}D
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            <Searchbar
                                value={boxSearch}
                                onChangeText={setBoxSearch}
                                placeholder="Search box ID or hardware MAC"
                                style={[styles.search, { backgroundColor: c.searchBg, borderColor: c.searchBorder }]}
                                inputStyle={[styles.searchInput, { color: c.text }]}
                                iconColor={c.textSec}
                                placeholderTextColor={c.textSec}
                            />

                            <View style={styles.dateFilterRow}>
                                <TouchableOpacity
                                    activeOpacity={0.9}
                                    onPress={() => showDateMode('start')}
                                    style={[styles.datePill, { backgroundColor: c.boxPill, borderColor: c.boxPillBorder }]}
                                >
                                    <Text style={[styles.datePillLabel, { color: c.textSec }]}>Start</Text>
                                    <Text style={[styles.datePillValue, { color: c.text }]}>{formatFilterDateLabel(startDate)}</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    activeOpacity={0.9}
                                    onPress={() => showDateMode('end')}
                                    style={[styles.datePill, { backgroundColor: c.boxPill, borderColor: c.boxPillBorder }]}
                                >
                                    <Text style={[styles.datePillLabel, { color: c.textSec }]}>End</Text>
                                    <Text style={[styles.datePillValue, { color: c.text }]}>{formatFilterDateLabel(endDate)}</Text>
                                </TouchableOpacity>
                            </View>

                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.filterPillRow}
                            >
                                {searchedBoxOptions.map((box) => {
                                    const active = boxFilter === box;

                                    return (
                                        <TouchableOpacity
                                            key={box}
                                            activeOpacity={0.9}
                                            onPress={() => setBoxFilter(box)}
                                            style={[
                                                styles.boxPill,
                                                {
                                                    backgroundColor: active ? c.boxPillActive : c.boxPill,
                                                    borderColor: active ? c.boxPillActive : c.boxPillBorder,
                                                },
                                            ]}
                                        >
                                            <Text
                                                numberOfLines={1}
                                                style={[styles.boxPillText, { color: active ? c.boxPillActiveText : c.boxPillText }]}
                                            >
                                                {box === 'ALL' ? 'All Boxes' : box}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>

                            <View style={styles.filterFooterRow}>
                                <Text style={[styles.filterMeta, { color: c.textSec }]}>Showing {filteredSessions.length} of {validSessions.length} sessions</Text>
                                {(boxFilter !== 'ALL' || boxSearch.trim().length > 0 || startDate || endDate) ? (
                                    <TouchableOpacity
                                        activeOpacity={0.85}
                                        onPress={() => {
                                            setBoxFilter('ALL');
                                            setBoxSearch('');
                                            setStartDate(null);
                                            setEndDate(null);
                                        }}
                                        style={[styles.resetPill, { backgroundColor: c.resetBg, borderColor: c.searchBorder }]}
                                    >
                                        <Text style={[styles.resetPillText, { color: c.resetText }]}>Reset</Text>
                                    </TouchableOpacity>
                                ) : null}
                            </View>
                        </>
                    ) : (
                        <Text style={[styles.collapsedSummary, { color: c.textSec }]}>{collapsedFilterSummary}</Text>
                    )}
                </View>

                {showDatePicker && filtersExpanded ? (
                    <DateTimePicker
                        value={datePickerMode === 'start' ? (startDate || new Date()) : (endDate || startDate || new Date())}
                        mode="date"
                        is24Hour
                        display="default"
                        onChange={onDateChange}
                    />
                ) : null}
            </View>

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator />
                </View>
            ) : error ? (
                <Text style={styles.error}>{error}</Text>
            ) : (
                <FlatList
                    data={paginatedSessions}
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

            {!loading && !error && filteredSessions.length > 0 ? (
                <View style={[styles.paginationBar, { backgroundColor: c.card, borderTopColor: c.border }]}>
                    <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => setPage((prev) => Math.max(1, prev - 1))}
                        disabled={page <= 1}
                        style={[
                            styles.paginationBtn,
                            {
                                backgroundColor: c.boxPill,
                                borderColor: c.boxPillBorder,
                                opacity: page <= 1 ? 0.45 : 1,
                            },
                        ]}
                    >
                        <Text style={[styles.paginationBtnText, { color: c.text }]}>Prev</Text>
                    </TouchableOpacity>

                    <Text style={[styles.paginationMeta, { color: c.textSec }]}>
                        Page {page} / {totalPages} • {pageRangeLabel} of {filteredSessions.length}
                    </Text>

                    <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                        disabled={page >= totalPages}
                        style={[
                            styles.paginationBtn,
                            {
                                backgroundColor: c.boxPill,
                                borderColor: c.boxPillBorder,
                                opacity: page >= totalPages ? 0.45 : 1,
                            },
                        ]}
                    >
                        <Text style={[styles.paginationBtnText, { color: c.text }]}>Next</Text>
                    </TouchableOpacity>
                </View>
            ) : null}

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
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <TouchableOpacity 
                                    onPress={() => setShowTraffic(prev => !prev)} 
                                    style={[styles.modalClose, { borderColor: c.border, backgroundColor: showTraffic ? 'rgba(76, 175, 80, 0.1)' : 'transparent' }]}
                                >
                                    <MaterialCommunityIcons 
                                        name={showTraffic ? "road-variant" : "road"} 
                                        size={18} 
                                        color={showTraffic ? "#4CAF50" : c.textSec} 
                                    />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => setSelectedSessionId(null)} style={[styles.modalClose, { borderColor: c.border }]}> 
                                    <MaterialCommunityIcons name="close" size={18} color={c.textSec} />
                                </TouchableOpacity>
                            </View>
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

                                                    {showTraffic && (
                                                        <MapboxGL.VectorSource id="traffic-source" url="mapbox://mapbox.mapbox-traffic-v1">
                                                            <MapboxGL.LineLayer
                                                                id="traffic-layer"
                                                                sourceLayerID="traffic"
                                                                style={{
                                                                    lineColor: [
                                                                        'match',
                                                                        ['get', 'congestion'],
                                                                        'low', '#10B981',
                                                                        'moderate', '#F59E0B',
                                                                        'heavy', '#EF4444',
                                                                        'severe', '#991B1B',
                                                                        '#6B7280'
                                                                    ],
                                                                    lineWidth: 3,
                                                                    lineOpacity: 0.75,
                                                                } as any}
                                                            />
                                                        </MapboxGL.VectorSource>
                                                    )}

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
    filterPanel: {
        marginTop: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        padding: 10,
    },
    filterHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 8,
    },
    filterHeaderActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    filterSectionLabel: {
        fontSize: 11,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        fontFamily: 'Inter_600SemiBold',
    },
    filterSectionTitle: {
        marginTop: 2,
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    resultsBadge: {
        minWidth: 34,
        height: 28,
        paddingHorizontal: 8,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
        justifyContent: 'center',
    },
    resultsBadgeText: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
    },
    filterToggleBtn: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rangeRail: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        padding: 4,
        flexDirection: 'row',
        gap: 6,
    },
    rangePill: {
        flex: 1,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        paddingVertical: 7,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rangePillText: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
        letterSpacing: 0.5,
    },
    search: {
        marginTop: 10,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 0,
        borderRadius: 14,
        minHeight: 44,
    },
    searchInput: {
        fontFamily: 'Inter_500Medium',
        fontSize: 14,
    },
    dateFilterRow: {
        marginTop: 8,
        flexDirection: 'row',
        gap: 8,
    },
    datePill: {
        flex: 1,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    datePillLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
    },
    datePillValue: {
        marginTop: 2,
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
    },
    filterPillRow: {
        marginTop: 8,
        paddingRight: 6,
        gap: 8,
    },
    boxPill: {
        maxWidth: 220,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        paddingVertical: 7,
        paddingHorizontal: 11,
    },
    boxPillText: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
    },
    filterFooterRow: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    collapsedSummary: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
        lineHeight: 18,
    },
    resetPill: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    resetPillText: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
    },
    filterMeta: {
        flex: 1,
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
        paddingBottom: 16,
    },
    paginationBar: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    paginationBtn: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 7,
        minWidth: 64,
        alignItems: 'center',
    },
    paginationBtnText: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
    },
    paginationMeta: {
        flex: 1,
        textAlign: 'center',
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
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
