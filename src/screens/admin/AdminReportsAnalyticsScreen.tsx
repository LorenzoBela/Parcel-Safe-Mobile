import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View,
} from 'react-native';
import { Searchbar, Text } from 'react-native-paper';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import {
    AdminAnalyticsResponse,
    getAdminAnalyticsReport,
} from '../../services/adminApiService';

const DAY_PRESETS = [7, 30, 90] as const;
const PAGE_SIZE = 8;
const STATUS_OPTIONS = [
    { label: 'All', value: '' },
    { label: 'Pending', value: 'PENDING' },
    { label: 'Assigned', value: 'ASSIGNED' },
    { label: 'In Transit', value: 'IN_TRANSIT' },
    { label: 'Arrived', value: 'ARRIVED' },
    { label: 'Completed', value: 'COMPLETED' },
    { label: 'Cancelled', value: 'CANCELLED' },
] as const;

const lightC = {
    bg: '#F3F3F0',
    card: '#FFFFFF',
    cardSubtle: '#F8F8F4',
    border: '#DEDED8',
    text: '#121212',
    textSec: '#64645F',
    chipBg: '#ECECE8',
    chipBorder: '#D9D9D2',
    chipActive: '#121212',
    chipActiveText: '#FFFFFF',
    accent: '#202020',
    danger: '#9F2626',
};

const darkC = {
    bg: '#090909',
    card: '#121212',
    cardSubtle: '#171717',
    border: '#2A2A2A',
    text: '#F4F4F4',
    textSec: '#B2B2B2',
    chipBg: '#1F1F1F',
    chipBorder: '#313131',
    chipActive: '#ECECEC',
    chipActiveText: '#111111',
    accent: '#E9E9E9',
    danger: '#FF8A8A',
};

type AppliedFilters = {
    fromDate: string;
    toDate: string;
    status: string;
    query: string;
};

function toPhDateKey(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function getTodayKey(): string {
    return toPhDateKey(new Date());
}

function getRangeStartKey(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1));
    return toPhDateKey(date);
}

function formatDateKeyLabel(value: string): string {
    const date = new Date(`${value}T00:00:00+08:00`);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString('en-US', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function formatPeso(value: number): string {
    return `PHP ${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
        return 'N/A';
    }
    return `${value.toFixed(2)}%`;
}

function formatCreatedAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'N/A';
    }

    return date.toLocaleString('en-US', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

export default function AdminReportsAnalyticsScreen() {
    const { isDarkMode } = useAppTheme();
    const insets = useSafeAreaInsets();
    const c = isDarkMode ? darkC : lightC;
    const headerTopPadding = Math.max(insets.top + 8, 18);

    const initialFromDate = useMemo(() => getRangeStartKey(30), []);
    const initialToDate = useMemo(() => getTodayKey(), []);

    const [presetDays, setPresetDays] = useState<number>(30);
    const [draftFromDate, setDraftFromDate] = useState(initialFromDate);
    const [draftToDate, setDraftToDate] = useState(initialToDate);
    const [draftStatus, setDraftStatus] = useState<string>('');
    const [draftQuery, setDraftQuery] = useState<string>('');
    const [filtersExpanded, setFiltersExpanded] = useState(true);

    const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>({
        fromDate: initialFromDate,
        toDate: initialToDate,
        status: '',
        query: '',
    });

    const [page, setPage] = useState(1);
    const [report, setReport] = useState<AdminAnalyticsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [showDatePicker, setShowDatePicker] = useState(false);
    const [datePickerMode, setDatePickerMode] = useState<'from' | 'to'>('from');

    const loadReport = useCallback(async (isRefresh = false) => {
        if (isRefresh) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }

        setError(null);

        try {
            const next = await getAdminAnalyticsReport({
                fromDate: appliedFilters.fromDate,
                toDate: appliedFilters.toDate,
                statuses: appliedFilters.status ? [appliedFilters.status] : undefined,
                q: appliedFilters.query || undefined,
                page,
                pageSize: PAGE_SIZE,
                leaderboardLimit: 8,
            });
            setReport(next);
        } catch (e: any) {
            setError(e?.message || 'Failed to load reports');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [appliedFilters, page]);

    useEffect(() => {
        loadReport(false);
    }, [loadReport]);

    const onRefresh = useCallback(async () => {
        await loadReport(true);
    }, [loadReport]);

    const applyPreset = (days: number) => {
        const nextFrom = getRangeStartKey(days);
        const nextTo = getTodayKey();

        setPresetDays(days);
        setDraftFromDate(nextFrom);
        setDraftToDate(nextTo);
        setPage(1);
        setAppliedFilters((prev) => ({
            ...prev,
            fromDate: nextFrom,
            toDate: nextTo,
        }));
    };

    const applyFilters = () => {
        setPresetDays(0);
        setPage(1);
        setAppliedFilters({
            fromDate: draftFromDate,
            toDate: draftToDate,
            status: draftStatus,
            query: draftQuery.trim(),
        });
    };

    const openDatePicker = (mode: 'from' | 'to') => {
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

        const nextDateKey = toPhDateKey(selectedDate);

        if (datePickerMode === 'from') {
            setDraftFromDate(nextDateKey);
            if (nextDateKey > draftToDate) {
                setDraftToDate(nextDateKey);
            }
            return;
        }

        setDraftToDate(nextDateKey);
        if (nextDateKey < draftFromDate) {
            setDraftFromDate(nextDateKey);
        }
    };

    const trendPreview = useMemo(() => {
        const points = report?.trend || [];
        return points.slice(Math.max(0, points.length - 7));
    }, [report]);

    const maxTrendDeliveries = useMemo(() => {
        return Math.max(1, ...trendPreview.map((point) => Number(point.deliveries || 0)));
    }, [trendPreview]);

    const detailsRows = report?.details.rows || [];
    const detailsPage = report?.details.page || page;
    const detailsTotalPages = report?.details.totalPages || 1;

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}> 
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.text} />}
            >
                <View style={[styles.header, { paddingTop: headerTopPadding }]}> 
                    <Text style={[styles.title, { color: c.text }]}>Reports & Analytics</Text>
                    <Text style={[styles.subtitle, { color: c.textSec }]}>KPI summaries, trends, leaderboard, and paginated delivery analytics.</Text>
                </View>

                <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                    <View style={styles.filterTopRow}>
                        <Text style={[styles.sectionTitle, { color: c.text }]}>Filters</Text>
                        <TouchableOpacity
                            onPress={() => setFiltersExpanded((prev) => !prev)}
                            style={[styles.collapseBtn, { borderColor: c.border, backgroundColor: c.cardSubtle }]}
                        >
                            <MaterialCommunityIcons
                                name={filtersExpanded ? 'chevron-up' : 'chevron-down'}
                                size={18}
                                color={c.textSec}
                            />
                        </TouchableOpacity>
                    </View>

                    {filtersExpanded ? (
                        <>
                            <View style={styles.presetRow}>
                                {DAY_PRESETS.map((days) => {
                                    const active = presetDays === days;
                                    return (
                                        <TouchableOpacity
                                            key={days}
                                            onPress={() => applyPreset(days)}
                                            style={[
                                                styles.presetPill,
                                                {
                                                    backgroundColor: active ? c.chipActive : c.chipBg,
                                                    borderColor: active ? c.chipActive : c.chipBorder,
                                                },
                                            ]}
                                        >
                                            <Text style={[styles.presetText, { color: active ? c.chipActiveText : c.textSec }]}>{days}D</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            <Searchbar
                                value={draftQuery}
                                onChangeText={setDraftQuery}
                                placeholder="Search tracking #, recipient, pickup/dropoff"
                                style={[styles.search, { backgroundColor: c.cardSubtle, borderColor: c.border }]}
                                inputStyle={[styles.searchInput, { color: c.text }]}
                                iconColor={c.textSec}
                                placeholderTextColor={c.textSec}
                            />

                            <View style={styles.dateRow}>
                                <TouchableOpacity
                                    onPress={() => openDatePicker('from')}
                                    style={[styles.datePill, { borderColor: c.chipBorder, backgroundColor: c.chipBg }]}
                                >
                                    <Text style={[styles.dateLabel, { color: c.textSec }]}>From</Text>
                                    <Text style={[styles.dateValue, { color: c.text }]}>{formatDateKeyLabel(draftFromDate)}</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    onPress={() => openDatePicker('to')}
                                    style={[styles.datePill, { borderColor: c.chipBorder, backgroundColor: c.chipBg }]}
                                >
                                    <Text style={[styles.dateLabel, { color: c.textSec }]}>To</Text>
                                    <Text style={[styles.dateValue, { color: c.text }]}>{formatDateKeyLabel(draftToDate)}</Text>
                                </TouchableOpacity>
                            </View>

                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusRow}>
                                {STATUS_OPTIONS.map((option) => {
                                    const active = draftStatus === option.value;
                                    return (
                                        <TouchableOpacity
                                            key={option.value || 'ALL'}
                                            onPress={() => setDraftStatus(option.value)}
                                            style={[
                                                styles.statusPill,
                                                {
                                                    backgroundColor: active ? c.chipActive : c.chipBg,
                                                    borderColor: active ? c.chipActive : c.chipBorder,
                                                },
                                            ]}
                                        >
                                            <Text style={[styles.statusPillText, { color: active ? c.chipActiveText : c.textSec }]}>{option.label}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>

                            <View style={styles.filterActionsRow}>
                                <TouchableOpacity
                                    onPress={() => {
                                        setDraftStatus('');
                                        setDraftQuery('');
                                        setPresetDays(30);
                                        setDraftFromDate(getRangeStartKey(30));
                                        setDraftToDate(getTodayKey());
                                        setPage(1);
                                        setAppliedFilters({
                                            fromDate: getRangeStartKey(30),
                                            toDate: getTodayKey(),
                                            status: '',
                                            query: '',
                                        });
                                    }}
                                    style={[styles.actionBtn, { borderColor: c.chipBorder, backgroundColor: c.chipBg }]}
                                >
                                    <Text style={[styles.actionBtnText, { color: c.textSec }]}>Reset</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    onPress={applyFilters}
                                    style={[styles.actionBtn, styles.actionBtnPrimary, { borderColor: c.accent, backgroundColor: c.accent }]}
                                >
                                    <Text style={[styles.actionBtnText, { color: isDarkMode ? '#0F0F0F' : '#FFFFFF' }]}>Apply</Text>
                                </TouchableOpacity>
                            </View>
                        </>
                    ) : (
                        <Text style={[styles.collapsedSummary, { color: c.textSec }]}>Window {appliedFilters.fromDate} to {appliedFilters.toDate} • {appliedFilters.status || 'All statuses'} • {appliedFilters.query || 'No search'}</Text>
                    )}

                    {showDatePicker ? (
                        <DateTimePicker
                            value={new Date(`${(datePickerMode === 'from' ? draftFromDate : draftToDate)}T00:00:00+08:00`)}
                            mode="date"
                            display="default"
                            onChange={onDateChange}
                        />
                    ) : null}
                </View>

                {loading ? (
                    <View style={styles.loadingWrap}>
                        <ActivityIndicator color={c.text} />
                    </View>
                ) : error ? (
                    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                        <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
                    </View>
                ) : (
                    <>
                        <View style={styles.kpiGrid}>
                            <MetricCard label="Deliveries" value={String(report?.kpis.totalDeliveries || 0)} c={c} />
                            <MetricCard label="Revenue" value={formatPeso(report?.kpis.revenue || 0)} c={c} />
                            <MetricCard label="Trips" value={String(report?.kpis.trips || 0)} c={c} />
                            <MetricCard label="Cancel Rate" value={formatPercent(report?.kpis.cancellationRate || 0)} c={c} />
                        </View>

                        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                            <Text style={[styles.sectionTitle, { color: c.text }]}>Trend Snapshot (Last 7 Days)</Text>
                            <View style={styles.trendBarsRow}>
                                {trendPreview.map((point) => {
                                    const barHeight = Math.max(8, (Number(point.deliveries || 0) / maxTrendDeliveries) * 72);
                                    return (
                                        <View key={point.date} style={styles.trendBarWrap}>
                                            <Text style={[styles.trendBarValue, { color: c.textSec }]}>{point.deliveries}</Text>
                                            <View style={[styles.trendBarTrack, { backgroundColor: c.chipBg, borderColor: c.chipBorder }]}> 
                                                <View style={[styles.trendBarFill, { height: barHeight, backgroundColor: c.accent }]} />
                                            </View>
                                            <Text style={[styles.trendBarLabel, { color: c.textSec }]}>{point.date.slice(5)}</Text>
                                        </View>
                                    );
                                })}
                            </View>
                        </View>

                        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                            <Text style={[styles.sectionTitle, { color: c.text }]}>Status Breakdown</Text>
                            <View style={styles.statusBreakdownWrap}>
                                {(report?.statusBreakdown || []).filter((bucket) => bucket.count > 0).map((bucket) => (
                                    <View key={bucket.status} style={[styles.statusBadge, { borderColor: c.chipBorder, backgroundColor: c.chipBg }]}> 
                                        <Text style={[styles.statusBadgeText, { color: c.textSec }]}>{bucket.status}: {bucket.count}</Text>
                                    </View>
                                ))}
                            </View>
                        </View>

                        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                            <Text style={[styles.sectionTitle, { color: c.text }]}>Rider Leaderboard</Text>
                            {(report?.leaderboard || []).length === 0 ? (
                                <Text style={[styles.mutedText, { color: c.textSec }]}>No rider completions for this filter range.</Text>
                            ) : (
                                report?.leaderboard.map((entry) => (
                                    <View key={entry.riderId} style={[styles.leaderRow, { borderColor: c.chipBorder, backgroundColor: c.cardSubtle }]}> 
                                        <Text style={[styles.leaderName, { color: c.text }]}>#{entry.rank} {entry.riderName}</Text>
                                        <Text style={[styles.leaderMeta, { color: c.textSec }]}>Completed {entry.completedDeliveries} • {formatPeso(entry.revenue)} • Avg {entry.averageCompletionMinutes ?? 'N/A'} min</Text>
                                    </View>
                                ))
                            )}
                        </View>

                        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                            <Text style={[styles.sectionTitle, { color: c.text }]}>Delivery Rows</Text>
                            {(detailsRows || []).length === 0 ? (
                                <Text style={[styles.mutedText, { color: c.textSec }]}>No delivery rows for this filter combination.</Text>
                            ) : (
                                detailsRows.map((row) => (
                                    <View key={row.id} style={[styles.detailRow, { borderColor: c.chipBorder, backgroundColor: c.cardSubtle }]}> 
                                        <View style={styles.detailRowTop}>
                                            <Text style={[styles.detailTracking, { color: c.text }]}>{row.trackingNumber || row.id.slice(0, 8)}</Text>
                                            <Text style={[styles.detailStatus, { color: c.textSec }]}>{row.status}</Text>
                                        </View>
                                        <Text style={[styles.detailMeta, { color: c.textSec }]}>Rider: {row.rider?.fullName || row.rider?.email || 'Unassigned'}</Text>
                                        <Text style={[styles.detailMeta, { color: c.textSec }]}>Recipient: {row.recipientName || row.customer?.fullName || 'N/A'}</Text>
                                        <Text style={[styles.detailMeta, { color: c.textSec }]}>Fare: {row.estimatedFare == null ? 'N/A' : formatPeso(row.estimatedFare)}</Text>
                                        <Text style={[styles.detailMeta, { color: c.textSec }]}>Created: {formatCreatedAt(row.createdAt)}</Text>
                                    </View>
                                ))
                            )}

                            <View style={styles.paginationRow}>
                                <TouchableOpacity
                                    disabled={detailsPage <= 1}
                                    onPress={() => setPage((prev) => Math.max(1, prev - 1))}
                                    style={[
                                        styles.paginationBtn,
                                        {
                                            borderColor: c.chipBorder,
                                            backgroundColor: c.chipBg,
                                            opacity: detailsPage <= 1 ? 0.45 : 1,
                                        },
                                    ]}
                                >
                                    <Text style={[styles.paginationBtnText, { color: c.text }]}>Prev</Text>
                                </TouchableOpacity>

                                <Text style={[styles.paginationMeta, { color: c.textSec }]}>Page {detailsPage} / {detailsTotalPages}</Text>

                                <TouchableOpacity
                                    disabled={detailsPage >= detailsTotalPages}
                                    onPress={() => setPage((prev) => Math.min(detailsTotalPages, prev + 1))}
                                    style={[
                                        styles.paginationBtn,
                                        {
                                            borderColor: c.chipBorder,
                                            backgroundColor: c.chipBg,
                                            opacity: detailsPage >= detailsTotalPages ? 0.45 : 1,
                                        },
                                    ]}
                                >
                                    <Text style={[styles.paginationBtnText, { color: c.text }]}>Next</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </>
                )}
            </ScrollView>
        </View>
    );
}

function MetricCard({
    label,
    value,
    c,
}: {
    label: string;
    value: string;
    c: typeof lightC;
}) {
    return (
        <View style={[styles.metricCard, { backgroundColor: c.card, borderColor: c.border }]}> 
            <Text style={[styles.metricLabel, { color: c.textSec }]}>{label}</Text>
            <Text style={[styles.metricValue, { color: c.text }]}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 24,
    },
    header: {
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    title: {
        fontSize: 24,
        fontFamily: 'Inter_700Bold',
    },
    subtitle: {
        marginTop: 4,
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    card: {
        marginHorizontal: 14,
        marginTop: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        padding: 12,
    },
    filterTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    sectionTitle: {
        fontSize: 15,
        fontFamily: 'Inter_700Bold',
    },
    collapseBtn: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
        justifyContent: 'center',
    },
    presetRow: {
        flexDirection: 'row',
        gap: 8,
    },
    presetPill: {
        flex: 1,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        paddingVertical: 8,
        alignItems: 'center',
    },
    presetText: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
    },
    search: {
        marginTop: 10,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 0,
        borderRadius: 12,
        minHeight: 44,
    },
    searchInput: {
        fontSize: 14,
        fontFamily: 'Inter_500Medium',
    },
    dateRow: {
        marginTop: 8,
        flexDirection: 'row',
        gap: 8,
    },
    datePill: {
        flex: 1,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    dateLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
    },
    dateValue: {
        marginTop: 2,
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
    },
    statusRow: {
        marginTop: 8,
        gap: 8,
        paddingRight: 6,
    },
    statusPill: {
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        paddingVertical: 7,
        paddingHorizontal: 11,
    },
    statusPillText: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
    },
    filterActionsRow: {
        marginTop: 10,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
    },
    actionBtn: {
        minWidth: 84,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        paddingVertical: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionBtnPrimary: {
        minWidth: 96,
    },
    actionBtnText: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
    },
    collapsedSummary: {
        fontSize: 12,
        lineHeight: 18,
        fontFamily: 'Inter_500Medium',
    },
    loadingWrap: {
        marginTop: 28,
        alignItems: 'center',
    },
    errorText: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
    },
    kpiGrid: {
        marginTop: 2,
        paddingHorizontal: 14,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    metricCard: {
        width: '48%',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 10,
    },
    metricLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
    },
    metricValue: {
        marginTop: 3,
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
    },
    trendBarsRow: {
        marginTop: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 6,
    },
    trendBarWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    trendBarValue: {
        fontSize: 10,
        marginBottom: 4,
        fontFamily: 'Inter_600SemiBold',
    },
    trendBarTrack: {
        width: '100%',
        height: 76,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        justifyContent: 'flex-end',
        overflow: 'hidden',
    },
    trendBarFill: {
        width: '100%',
        borderRadius: 8,
    },
    trendBarLabel: {
        marginTop: 4,
        fontSize: 10,
        fontFamily: 'Inter_500Medium',
    },
    statusBreakdownWrap: {
        marginTop: 10,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    statusBadge: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    statusBadgeText: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
    },
    mutedText: {
        marginTop: 8,
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    leaderRow: {
        marginTop: 8,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    leaderName: {
        fontSize: 13,
        fontFamily: 'Inter_700Bold',
    },
    leaderMeta: {
        marginTop: 2,
        fontSize: 11,
        fontFamily: 'Inter_500Medium',
    },
    detailRow: {
        marginTop: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    detailRowTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
    },
    detailTracking: {
        flex: 1,
        fontSize: 13,
        fontFamily: 'Inter_700Bold',
    },
    detailStatus: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
    },
    detailMeta: {
        marginTop: 2,
        fontSize: 11,
        fontFamily: 'Inter_500Medium',
    },
    paginationRow: {
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    paginationBtn: {
        minWidth: 72,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        paddingVertical: 8,
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
});
