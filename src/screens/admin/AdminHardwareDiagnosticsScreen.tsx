import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Searchbar, SegmentedButtons, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
    HardwareByBoxId,
    HardwareDiagnostics,
    subscribeToAllHardware,
} from '../../services/firebaseClient';
import { useAppTheme } from '../../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type DiagnosticsFilter = 'all' | 'alerts' | 'stale';

type DiagnosticsRow = {
    boxId: string;
    hw: HardwareDiagnostics;
    status: string;
    theftState: string;
    isStale: boolean;
    hasAlert: boolean;
    lastUpdatedEpoch: number;
};

const STALE_AFTER_MS = 2 * 60 * 1000;

const lightC = {
    bg: '#F3F3F0',
    card: '#FFFFFF',
    border: '#DEDED8',
    text: '#121212',
    textSec: '#64645F',
    muted: '#8A8A84',
    search: '#ECECE8',
    badgeNeutral: '#ECECE8',
    badgeNeutralText: '#53534E',
    badgeWarn: '#F6E8D9',
    badgeWarnText: '#8A5B22',
    badgeDanger: '#F6DDDD',
    badgeDangerText: '#943636',
    badgeGood: '#DFF1E3',
    badgeGoodText: '#26603A',
    success: '#2E7D32',
};

const darkC = {
    bg: '#090909',
    card: '#121212',
    border: '#2A2A2A',
    text: '#F4F4F4',
    textSec: '#B2B2B2',
    muted: '#7A7A7A',
    search: '#171717',
    badgeNeutral: '#212121',
    badgeNeutralText: '#B9B9B9',
    badgeWarn: '#3D3023',
    badgeWarnText: '#F5BE7A',
    badgeDanger: '#422727',
    badgeDangerText: '#F19999',
    badgeGood: '#223428',
    badgeGoodText: '#9CDAB0',
    success: '#8DD5A0',
};

function parseEpochFromString(value?: string): number {
    if (!value) return 0;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function resolveHeartbeatEpoch(hw: HardwareDiagnostics): number {
    const raw = Number(hw.last_updated || 0);
    if (Number.isFinite(raw) && raw > 1_600_000_000_000) {
        return raw;
    }
    return parseEpochFromString(hw.last_updated_str);
}

function isStaleHeartbeat(hw: HardwareDiagnostics): boolean {
    const epoch = resolveHeartbeatEpoch(hw);
    if (epoch <= 0) {
        return true;
    }
    return Date.now() - epoch > STALE_AFTER_MS;
}

function formatLastSeen(hw: HardwareDiagnostics): string {
    const lastUpdated = Number(hw.last_updated || 0);

    if (lastUpdated > 1_600_000_000_000) {
        const diff = Date.now() - lastUpdated;
        if (diff < 0) return 'just now';

        const sec = Math.floor(diff / 1000);
        if (sec < 60) return `${sec}s ago`;
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min}m ago`;
        const hrs = Math.floor(min / 60);
        if (hrs < 24) return `${hrs}h ${min % 60}m ago`;

        return new Date(lastUpdated).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        });
    }

    if (typeof hw.uptime_ms === 'number' && hw.uptime_ms > 0) {
        const secs = Math.floor(hw.uptime_ms / 1000);
        if (secs < 60) return `${secs}s uptime`;
        const mins = Math.floor(secs / 60);
        if (mins < 60) return `${mins}m uptime`;
        const hrs = Math.floor(mins / 60);
        return `${hrs}h ${mins % 60}m uptime`;
    }

    return hw.last_updated_str || 'N/A';
}

function formatBytes(bytes?: number): string {
    if (!Number.isFinite(bytes) || (bytes as number) < 0) return 'N/A';
    const safe = Number(bytes);
    if (safe < 1024) return `${safe} B`;
    if (safe < 1_048_576) return `${(safe / 1024).toFixed(1)} KB`;
    return `${(safe / 1_048_576).toFixed(2)} MB`;
}

function formatSignal(hw: HardwareDiagnostics): string {
    if (typeof hw.rssi === 'number' && hw.rssi > -999) {
        return `${hw.rssi} dBm`;
    }
    if (typeof hw.csq === 'number' && hw.csq >= 0 && hw.csq <= 31) {
        return `CSQ ${hw.csq}/31`;
    }
    return 'N/A';
}

function formatBattery(hw: HardwareDiagnostics): string {
    if (typeof hw.batt_pct === 'number') return `${Math.round(hw.batt_pct)}%`;
    if (typeof hw.batt_v === 'number') return `${hw.batt_v.toFixed(2)} V`;
    return 'N/A';
}

function formatGeo(hw: HardwareDiagnostics): string {
    const geoState = String(hw.geo_state || 'N/A').toUpperCase();
    const dist = typeof hw.geo_dist_m === 'number' ? `${Math.round(hw.geo_dist_m)} m` : 'N/A';
    return `${geoState} (${dist})`;
}

function formatExactTimestamp(value?: number): string {
    if (!Number.isFinite(value) || (value as number) <= 0) return 'N/A';
    const raw = Number(value);
    const ms = raw > 1_600_000_000_000 ? raw : raw * 1000;
    return new Date(ms).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    });
}

function yesNoUnknown(value?: boolean): string {
    if (value === true) return 'YES';
    if (value === false) return 'NO';
    return 'N/A';
}

function normalizeStatus(hw: HardwareDiagnostics): string {
    const raw = String(hw.status || 'UNKNOWN').trim().toUpperCase();
    return raw || 'UNKNOWN';
}

function normalizeTheftState(hw: HardwareDiagnostics): string {
    const raw = String(hw.theft_state || 'NORMAL').trim().toUpperCase();
    return raw || 'NORMAL';
}

function hasSecurityAlert(hw: HardwareDiagnostics, theftState: string): boolean {
    if (hw.tamper?.detected || hw.tamper?.lockdown) return true;
    return theftState === 'SUSPICIOUS' || theftState === 'STOLEN' || theftState === 'LOCKDOWN';
}

export default function AdminHardwareDiagnosticsScreen() {
    const { isDarkMode } = useAppTheme();
    const insets = useSafeAreaInsets();
    const c = isDarkMode ? darkC : lightC;
    const headerTopPadding = Math.max(insets.top + 8, 18);

    const [hardware, setHardware] = useState<HardwareByBoxId | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshTick, setRefreshTick] = useState(0);
    const [search, setSearch] = useState('');
    const [filterMode, setFilterMode] = useState<DiagnosticsFilter>('all');
    const [isFleetHealthExpanded, setIsFleetHealthExpanded] = useState(true);
    const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        const unsubscribe = subscribeToAllHardware((snapshot) => {
            setHardware(snapshot);
            setLoading(false);
        });
        return unsubscribe;
    }, [refreshTick]);

    const onRefresh = async () => {
        setRefreshing(true);
        setRefreshTick((prev) => prev + 1);
        await new Promise((resolve) => setTimeout(resolve, 450));
        setRefreshing(false);
    };

    const rows = useMemo<DiagnosticsRow[]>(() => {
        return Object.entries(hardware || {})
            .map(([boxId, hw]) => {
                const status = normalizeStatus(hw);
                const theftState = normalizeTheftState(hw);
                const stale = isStaleHeartbeat(hw);
                const securityAlert = hasSecurityAlert(hw, theftState);
                const powerAlert = hw.batt_low === true || (typeof hw.batt_pct === 'number' && hw.batt_pct <= 15);

                return {
                    boxId,
                    hw,
                    status,
                    theftState,
                    isStale: stale,
                    hasAlert: securityAlert || powerAlert || stale,
                    lastUpdatedEpoch: resolveHeartbeatEpoch(hw),
                };
            })
            .sort((a, b) => {
                if (a.lastUpdatedEpoch !== b.lastUpdatedEpoch) {
                    return b.lastUpdatedEpoch - a.lastUpdatedEpoch;
                }
                return a.boxId.localeCompare(b.boxId);
            });
    }, [hardware]);

    const entries = useMemo(() => {
        const term = search.trim().toLowerCase();

        return rows.filter((row) => {
            if (filterMode === 'alerts' && !row.hasAlert) return false;
            if (filterMode === 'stale' && !row.isStale) return false;

            if (!term) return true;

            const conn = String(row.hw.connection || '').toLowerCase();
            const theft = String(row.theftState || '').toLowerCase();
            const status = String(row.status || '').toLowerCase();
            const op = String(row.hw.op || '').toLowerCase();

            return (
                row.boxId.toLowerCase().includes(term) ||
                conn.includes(term) ||
                theft.includes(term) ||
                status.includes(term) ||
                op.includes(term)
            );
        });
    }, [rows, search, filterMode]);

    const alertCount = useMemo(() => rows.filter((row) => row.hasAlert).length, [rows]);
    const onlineCount = useMemo(() => rows.filter((row) => !row.isStale).length, [rows]);
    const avgBattery = useMemo(() => {
        const batteries = rows
            .map((row) => row.hw.batt_pct)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

        if (batteries.length === 0) {
            return 'N/A';
        }

        const avg = batteries.reduce((sum, value) => sum + value, 0) / batteries.length;
        return `${Math.round(avg)}%`;
    }, [rows]);

    const selectedRow = useMemo(
        () => rows.find((row) => row.boxId === selectedBoxId) || null,
        [rows, selectedBoxId]
    );

    const getStatusBadgeStyle = (status: string) => {
        if (status === 'ACTIVE' || status === 'IN_TRANSIT') {
            return { bg: c.badgeGood, text: c.badgeGoodText };
        }
        if (status === 'ARRIVED' || status === 'STANDBY') {
            return { bg: c.badgeWarn, text: c.badgeWarnText };
        }
        if (status === 'LOCKED') {
            return { bg: c.badgeDanger, text: c.badgeDangerText };
        }
        return { bg: c.badgeNeutral, text: c.badgeNeutralText };
    };

    const getHealthBadgeStyle = (row: DiagnosticsRow) => {
        if (row.hasAlert) {
            return { bg: c.badgeDanger, text: c.badgeDangerText, label: 'ALERT' };
        }
        if (row.isStale) {
            return { bg: c.badgeWarn, text: c.badgeWarnText, label: 'STALE' };
        }
        return { bg: c.badgeGood, text: c.badgeGoodText, label: 'HEALTHY' };
    };

    const getTheftBadgeStyle = (theftState: string) => {
        if (theftState === 'STOLEN' || theftState === 'LOCKDOWN') {
            return { bg: c.badgeDanger, text: c.badgeDangerText };
        }
        if (theftState === 'SUSPICIOUS') {
            return { bg: c.badgeWarn, text: c.badgeWarnText };
        }
        return { bg: c.badgeNeutral, text: c.badgeNeutralText };
    };

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}> 
            <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.border, paddingTop: headerTopPadding }]}> 
                <Text style={[styles.title, { color: c.text }]}>Hardware Diagnostics</Text>
                <Text style={[styles.subtitle, { color: c.textSec }]}>Realtime component telemetry for registered boxes.</Text>
            </View>

            <Searchbar
                value={search}
                onChangeText={setSearch}
                placeholder="Search by box id, connection, theft state"
                style={[styles.search, { backgroundColor: c.search, borderColor: c.border }]}
                inputStyle={{ color: c.text }}
                iconColor={c.textSec}
                placeholderTextColor={c.textSec}
            />

            <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setIsFleetHealthExpanded((prev) => !prev)}
                style={[styles.listHeaderRow, { backgroundColor: c.card, borderColor: c.border }]}
            >
                <View>
                    <Text style={[styles.listHeaderTitle, { color: c.text }]}>Fleet Health</Text>
                    <Text style={[styles.listHeaderCount, { color: c.textSec }]}>{entries.length} visible</Text>
                </View>

                <View style={styles.collapseMeta}>
                    <Text style={[styles.collapseLabel, { color: c.textSec }]}>{isFleetHealthExpanded ? 'Hide' : 'Show'}</Text>
                    <MaterialCommunityIcons
                        name={isFleetHealthExpanded ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color={c.textSec}
                    />
                </View>
            </TouchableOpacity>

            {isFleetHealthExpanded ? (
                <>
                    <View style={styles.summaryGrid}>
                        <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}> 
                            <Text style={[styles.summaryLabel, { color: c.textSec }]}>BOXES</Text>
                            <Text style={[styles.summaryValue, { color: c.text }]}>{rows.length}</Text>
                        </View>

                        <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}> 
                            <Text style={[styles.summaryLabel, { color: c.textSec }]}>ALERTS</Text>
                            <Text style={[styles.summaryValue, { color: c.text }]}>{alertCount}</Text>
                        </View>

                        <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}> 
                            <Text style={[styles.summaryLabel, { color: c.textSec }]}>ONLINE</Text>
                            <Text style={[styles.summaryValue, { color: c.text }]}>{onlineCount}</Text>
                        </View>

                        <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}> 
                            <Text style={[styles.summaryLabel, { color: c.textSec }]}>AVG BATT</Text>
                            <Text style={[styles.summaryValue, { color: c.text }]}>{avgBattery}</Text>
                        </View>
                    </View>

                    <View style={styles.filterWrap}>
                        <SegmentedButtons
                            value={filterMode}
                            onValueChange={(value) => setFilterMode(value as DiagnosticsFilter)}
                            style={[styles.filterToggle, { backgroundColor: c.search, borderColor: c.border }]}
                            buttons={[
                                { value: 'all', label: 'All' },
                                { value: 'alerts', label: 'Alerts' },
                                { value: 'stale', label: 'Stale' },
                            ]}
                        />
                    </View>
                </>
            ) : null}

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator color={c.success} />
                </View>
            ) : (
                <FlatList
                    data={entries}
                    keyExtractor={(item) => item.boxId}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.success} />}
                    contentContainerStyle={styles.listContent}
                    ListEmptyComponent={
                        <View style={styles.emptyWrap}>
                            <MaterialCommunityIcons name="router-wireless-off" size={36} color={c.textSec} />
                            <Text style={[styles.empty, { color: c.textSec }]}>No hardware diagnostics found.</Text>
                        </View>
                    }
                    renderItem={({ item }) => {
                        const hw = item.hw;
                        const statusBadge = getStatusBadgeStyle(item.status);
                        const healthBadge = getHealthBadgeStyle(item);
                        const theftBadge = getTheftBadgeStyle(item.theftState);
                        const connectionLabel = hw.connection || 'N/A';
                        const opLabel = hw.op ? ` | ${hw.op}` : '';

                        return (
                            <TouchableOpacity
                                activeOpacity={0.88}
                                onPress={() => setSelectedBoxId(item.boxId)}
                                style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
                            > 
                                <View style={styles.rowBetween}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.box, { color: c.text }]}>{item.boxId}</Text>
                                        <Text style={[styles.meta, { color: c.textSec }]}>Last Seen: {formatLastSeen(hw)}</Text>
                                    </View>

                                    <View style={styles.rowRightCol}>
                                        <View style={[styles.badge, { backgroundColor: statusBadge.bg }]}>
                                            <Text style={[styles.badgeText, { color: statusBadge.text }]}>{item.status}</Text>
                                        </View>
                                        <MaterialCommunityIcons name="chevron-right" size={18} color={c.textSec} />
                                    </View>
                                </View>

                                <View style={styles.badgeRow}>
                                    <View style={[styles.badge, { backgroundColor: healthBadge.bg }]}>
                                        <Text style={[styles.badgeText, { color: healthBadge.text }]}>{healthBadge.label}</Text>
                                    </View>

                                    <View style={[styles.badge, { backgroundColor: theftBadge.bg }]}>
                                        <Text style={[styles.badgeText, { color: theftBadge.text }]}>THEFT {item.theftState}</Text>
                                    </View>
                                </View>

                                <Text style={[styles.meta, { color: c.textSec }]}>Connection: {connectionLabel}{opLabel}</Text>
                                <Text style={[styles.meta, { color: c.textSec }]}>Tamper: {hw.tamper?.detected ? 'DETECTED' : 'CLEAR'} | Lockdown: {hw.tamper?.lockdown ? 'ON' : 'OFF'}</Text>

                                <View style={styles.metricRow}>
                                    <View style={[styles.metricCard, { borderColor: c.border, backgroundColor: c.search }]}> 
                                        <Text style={[styles.metricLabel, { color: c.textSec }]}>Battery</Text>
                                        <Text style={[styles.metricValue, { color: c.text }]}>{formatBattery(hw)}</Text>
                                    </View>

                                    <View style={[styles.metricCard, { borderColor: c.border, backgroundColor: c.search }]}> 
                                        <Text style={[styles.metricLabel, { color: c.textSec }]}>Signal</Text>
                                        <Text style={[styles.metricValue, { color: c.text }]}>{formatSignal(hw)}</Text>
                                    </View>

                                    <View style={[styles.metricCard, { borderColor: c.border, backgroundColor: c.search }]}> 
                                        <Text style={[styles.metricLabel, { color: c.textSec }]}>GPS</Text>
                                        <Text style={[styles.metricValue, { color: c.text }]}>{hw.gps_fix ? 'FIXED' : 'NO FIX'}</Text>
                                    </View>

                                    <View style={[styles.metricCard, { borderColor: c.border, backgroundColor: c.search }]}> 
                                        <Text style={[styles.metricLabel, { color: c.textSec }]}>Data</Text>
                                        <Text style={[styles.metricValue, { color: c.text }]}>{formatBytes(hw.data_bytes)}</Text>
                                    </View>
                                </View>

                                <Text style={[styles.meta, { color: c.textSec }]}>Geofence: {formatGeo(hw)}</Text>
                                <Text style={[styles.meta, { color: c.textSec }]}>Phone Link: {hw.phone_status?.is_connected ? 'CONNECTED' : 'OFFLINE'} ({formatBytes(hw.phone_status?.data_bytes)})</Text>
                            </TouchableOpacity>
                        );
                    }}
                />
            )}

            <Modal
                visible={Boolean(selectedRow)}
                animationType="slide"
                transparent
                onRequestClose={() => setSelectedBoxId(null)}
            >
                <View style={styles.modalBackdrop}>
                    <View style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}>
                        <View style={styles.modalHeader}>
                            <View>
                                <Text style={[styles.modalTitle, { color: c.text }]}>Hardware Detail</Text>
                                <Text style={[styles.modalSubtitle, { color: c.textSec }]}>{selectedRow?.boxId || 'N/A'}</Text>
                            </View>
                            <TouchableOpacity onPress={() => setSelectedBoxId(null)} style={[styles.modalCloseBtn, { borderColor: c.border }]}> 
                                <MaterialCommunityIcons name="close" size={18} color={c.textSec} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
                            {selectedRow ? (
                                <>
                                    <View style={[styles.detailSection, { borderColor: c.border, backgroundColor: c.search }]}> 
                                        <Text style={[styles.detailSectionTitle, { color: c.text }]}>Status</Text>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Health</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{getHealthBadgeStyle(selectedRow).label}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Status</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{selectedRow.status}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Theft State</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{selectedRow.theftState}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Last Seen</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{formatLastSeen(selectedRow.hw)}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Stale</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{selectedRow.isStale ? 'YES' : 'NO'}</Text>
                                        </View>
                                    </View>

                                    <View style={[styles.detailSection, { borderColor: c.border, backgroundColor: c.search }]}> 
                                        <Text style={[styles.detailSectionTitle, { color: c.text }]}>Network & GPS</Text>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Connection</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{String(selectedRow.hw.connection || 'N/A')}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Carrier</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{String(selectedRow.hw.op || 'N/A')}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>RSSI</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{typeof selectedRow.hw.rssi === 'number' ? `${selectedRow.hw.rssi} dBm` : 'N/A'}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>CSQ</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{typeof selectedRow.hw.csq === 'number' ? `${selectedRow.hw.csq}` : 'N/A'}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>GPS Fix</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{yesNoUnknown(selectedRow.hw.gps_fix)}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Geofence</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{formatGeo(selectedRow.hw)}</Text>
                                        </View>
                                    </View>

                                    <View style={[styles.detailSection, { borderColor: c.border, backgroundColor: c.search }]}> 
                                        <Text style={[styles.detailSectionTitle, { color: c.text }]}>Power & Security</Text>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Battery %</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{typeof selectedRow.hw.batt_pct === 'number' ? `${Math.round(selectedRow.hw.batt_pct)}%` : 'N/A'}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Battery V</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{typeof selectedRow.hw.batt_v === 'number' ? `${selectedRow.hw.batt_v.toFixed(2)} V` : 'N/A'}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Low Battery</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{yesNoUnknown(selectedRow.hw.batt_low)}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Tamper</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{yesNoUnknown(selectedRow.hw.tamper?.detected)}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Lockdown</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{yesNoUnknown(selectedRow.hw.tamper?.lockdown)}</Text>
                                        </View>
                                    </View>

                                    <View style={[styles.detailSection, { borderColor: c.border, backgroundColor: c.search }]}> 
                                        <Text style={[styles.detailSectionTitle, { color: c.text }]}>Telemetry</Text>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Firmware Data</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{formatBytes(selectedRow.hw.data_bytes)}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Phone Link</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{yesNoUnknown(selectedRow.hw.phone_status?.is_connected)}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Phone Source</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{String(selectedRow.hw.phone_status?.source || 'N/A')}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Phone Data</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{formatBytes(selectedRow.hw.phone_status?.data_bytes)}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Phone Timestamp</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{formatExactTimestamp(selectedRow.hw.phone_status?.timestamp)}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Uptime</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{typeof selectedRow.hw.uptime_ms === 'number' ? `${Math.floor(selectedRow.hw.uptime_ms / 1000)}s` : 'N/A'}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Time Synced</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{yesNoUnknown(selectedRow.hw.time_synced)}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Last Update</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{formatExactTimestamp(selectedRow.hw.last_updated)}</Text>
                                        </View>
                                        <View style={styles.detailLine}>
                                            <Text style={[styles.detailKey, { color: c.textSec }]}>Last Update (str)</Text>
                                            <Text style={[styles.detailValue, { color: c.text }]}>{selectedRow.hw.last_updated_str || 'N/A'}</Text>
                                        </View>
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
    search: {
        marginHorizontal: 14,
        marginTop: 10,
        marginBottom: 4,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 0,
        borderRadius: 12,
        minHeight: 44,
    },
    listHeaderRow: {
        marginHorizontal: 14,
        marginTop: 8,
        marginBottom: 6,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    listHeaderTitle: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    listHeaderCount: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    collapseMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    collapseLabel: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
    },
    summaryGrid: {
        marginHorizontal: 14,
        marginBottom: 8,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    summaryCard: {
        flexBasis: '48%',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        paddingVertical: 9,
        paddingHorizontal: 10,
    },
    summaryLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: 0.4,
    },
    summaryValue: {
        marginTop: 4,
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    filterWrap: {
        marginHorizontal: 14,
        marginBottom: 6,
    },
    filterToggle: {
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
    },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    listContent: {
        padding: 14,
        paddingBottom: 26,
    },
    emptyWrap: {
        alignItems: 'center',
        paddingTop: 34,
        gap: 8,
    },
    empty: { textAlign: 'center', fontSize: 13, fontFamily: 'Inter_500Medium' },
    card: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
    },
    rowBetween: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 6,
        gap: 8,
    },
    rowRightCol: {
        alignItems: 'flex-end',
        gap: 4,
    },
    box: { fontSize: 15, fontFamily: 'Inter_700Bold' },
    badgeRow: {
        flexDirection: 'row',
        gap: 6,
        marginBottom: 6,
    },
    badge: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    badgeText: {
        fontSize: 10,
        letterSpacing: 0.5,
        fontFamily: 'Inter_700Bold',
    },
    meta: { fontSize: 13, marginTop: 2, fontFamily: 'Inter_500Medium' },
    metricRow: {
        marginTop: 10,
        flexDirection: 'row',
        gap: 8,
    },
    metricCard: {
        flex: 1,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    metricLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
    },
    metricValue: {
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
        maxHeight: '88%',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
    },
    modalHeader: {
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
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
    modalCloseBtn: {
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
        paddingBottom: 20,
    },
    detailSection: {
        marginBottom: 10,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        paddingVertical: 10,
    },
    detailSectionTitle: {
        fontSize: 13,
        fontFamily: 'Inter_700Bold',
        marginBottom: 6,
    },
    detailLine: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 3,
    },
    detailKey: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
        flex: 1,
    },
    detailValue: {
        fontSize: 12,
        fontFamily: 'Inter_700Bold',
        flex: 1,
        textAlign: 'right',
    },
});
