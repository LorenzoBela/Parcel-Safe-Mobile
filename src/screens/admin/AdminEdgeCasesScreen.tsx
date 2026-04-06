import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Searchbar, SegmentedButtons, Text } from 'react-native-paper';
import { getFirebaseDatabase, onValue, ref, update } from '../../services/firebaseClient';
import { WaitTimerState, RescheduleRequest } from '../../services/customerNotHomeService';
import { useAppTheme } from '../../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type EdgeWaitItem = WaitTimerState & { deliveryId: string };
type EdgeRescheduleItem = RescheduleRequest & { deliveryId: string; status?: string };
type EdgeQueue = 'all' | 'waits' | 'reschedules';

type EdgeSectionItem =
    | { kind: 'wait'; payload: EdgeWaitItem }
    | { kind: 'reschedule'; payload: EdgeRescheduleItem };

type EdgeSection = {
    key: string;
    title: string;
    emptyMessage: string;
    data: EdgeSectionItem[];
};

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
};

type Tone = { bg: string; text: string };

function normalizeStatus(status?: string): string {
    return String(status || '').trim().toUpperCase();
}

function formatEta(expiresAt?: number): string {
    if (!expiresAt) return 'N/A';
    const diff = Math.max(0, expiresAt - Date.now());
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatRequestedAt(timestamp?: number): string {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
}

function getWaitStatusTone(status: string, c: typeof lightC | typeof darkC): Tone {
    const normalized = normalizeStatus(status);
    if (normalized === 'WAITING') return { bg: c.badgeWarn, text: c.badgeWarnText };
    if (normalized === 'EXPIRED') return { bg: c.badgeDanger, text: c.badgeDangerText };
    if (normalized === 'CUSTOMER_ARRIVED') return { bg: c.badgeGood, text: c.badgeGoodText };
    return { bg: c.badgeNeutral, text: c.badgeNeutralText };
}

function getRescheduleTone(status: string, c: typeof lightC | typeof darkC): Tone {
    const normalized = normalizeStatus(status);
    if (normalized === 'PENDING') return { bg: c.badgeWarn, text: c.badgeWarnText };
    if (normalized === 'REJECTED') return { bg: c.badgeDanger, text: c.badgeDangerText };
    if (normalized === 'APPROVED') return { bg: c.badgeGood, text: c.badgeGoodText };
    return { bg: c.badgeNeutral, text: c.badgeNeutralText };
}

export default function AdminEdgeCasesScreen() {
    const { isDarkMode } = useAppTheme();
    const insets = useSafeAreaInsets();
    const c = isDarkMode ? darkC : lightC;
    const headerTopPadding = Math.max(insets.top + 8, 18);

    const [waitItems, setWaitItems] = useState<EdgeWaitItem[]>([]);
    const [reschedules, setReschedules] = useState<EdgeRescheduleItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshTick, setRefreshTick] = useState(0);
    const [search, setSearch] = useState('');
    const [queue, setQueue] = useState<EdgeQueue>('all');
    const [busyKey, setBusyKey] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        const db = getFirebaseDatabase();
        const deliveriesRef = ref(db, 'deliveries');

        const unsubscribe = onValue(deliveriesRef, (snapshot) => {
            const source = snapshot.val() || {};
            const nextWaits: EdgeWaitItem[] = [];
            const nextReschedules: EdgeRescheduleItem[] = [];

            Object.entries<any>(source).forEach(([deliveryId, payload]) => {
                if (payload?.customer_not_home) {
                    nextWaits.push({ ...payload.customer_not_home, deliveryId });
                }
                if (payload?.reschedule_request) {
                    nextReschedules.push({ ...payload.reschedule_request, deliveryId });
                }
            });

            setWaitItems(nextWaits);
            setReschedules(nextReschedules);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [refreshTick]);

    const onRefresh = async () => {
        setRefreshing(true);
        setRefreshTick((prev) => prev + 1);
        await new Promise((resolve) => setTimeout(resolve, 450));
        setRefreshing(false);
    };

    const activeWaits = useMemo(() => {
        const term = search.trim().toLowerCase();
        return waitItems
            .filter((item) => item.status === 'WAITING' || item.status === 'EXPIRED')
            .filter((item) => {
                if (!term) return true;
                const haystack = `${item.deliveryId} ${item.status} ${formatEta(item.expiresAt)}`.toLowerCase();
                return haystack.includes(term);
            })
            .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    }, [waitItems, search]);

    const pendingReschedules = useMemo(() => {
        const term = search.trim().toLowerCase();
        return reschedules
            .filter((item) => normalizeStatus(item.status) !== 'APPROVED')
            .filter((item) => {
                if (!term) return true;
                const haystack = `${item.deliveryId} ${item.newDate} ${item.newTimeSlot} ${item.customerNotes || ''} ${normalizeStatus(item.status) || 'PENDING'}`.toLowerCase();
                return haystack.includes(term);
            })
            .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
    }, [reschedules, search]);

    const sections = useMemo<EdgeSection[]>(() => {
        const waitSection: EdgeSection = {
            key: 'waits',
            title: 'Active Wait Timers',
            emptyMessage: 'No active wait timers found.',
            data: activeWaits.map((item) => ({ kind: 'wait', payload: item })),
        };

        const rescheduleSection: EdgeSection = {
            key: 'reschedules',
            title: 'Reschedule Requests',
            emptyMessage: 'No pending reschedules found.',
            data: pendingReschedules.map((item) => ({ kind: 'reschedule', payload: item })),
        };

        if (queue === 'waits') return [waitSection];
        if (queue === 'reschedules') return [rescheduleSection];
        return [waitSection, rescheduleSection];
    }, [activeWaits, pendingReschedules, queue]);

    const totalVisible = useMemo(() => sections.reduce((sum, section) => sum + section.data.length, 0), [sections]);

    const setWaitStatus = async (deliveryId: string, status: string) => {
        setError(null);
        setBusyKey(`wait-${deliveryId}-${status}`);
        try {
            const db = getFirebaseDatabase();
            await update(ref(db, `deliveries/${deliveryId}/customer_not_home`), {
                status,
                updated_at: Date.now(),
            });
        } catch (e: any) {
            setError(e?.message || 'Failed to update wait timer status');
        } finally {
            setBusyKey(null);
        }
    };

    const setRescheduleStatus = async (deliveryId: string, status: 'APPROVED' | 'REJECTED') => {
        setError(null);
        setBusyKey(`reschedule-${deliveryId}-${status}`);
        try {
            const db = getFirebaseDatabase();
            await update(ref(db, `deliveries/${deliveryId}/reschedule_request`), {
                status,
                reviewedAt: Date.now(),
            });
        } catch (e: any) {
            setError(e?.message || 'Failed to update reschedule status');
        } finally {
            setBusyKey(null);
        }
    };

    const renderWaitItem = (item: EdgeWaitItem) => {
        const waitTone = getWaitStatusTone(item.status, c);
        return (
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                <View style={styles.cardTopRow}>
                    <Text style={[styles.main, { color: c.text }]}>{item.deliveryId}</Text>
                    <View style={[styles.badge, { backgroundColor: waitTone.bg }]}>
                        <Text style={[styles.badgeText, { color: waitTone.text }]}>{item.status}</Text>
                    </View>
                </View>

                <Text style={[styles.meta, { color: c.textSec }]}>Remaining: {formatEta(item.expiresAt)}</Text>
                <Text style={[styles.meta, { color: c.textSec }]}>Started: {formatRequestedAt(item.startedAt)}</Text>

                <View style={styles.rowActions}>
                    <Button
                        compact
                        mode="contained"
                        onPress={() => setWaitStatus(item.deliveryId, 'CUSTOMER_ARRIVED')}
                        style={styles.actionBtn}
                        disabled={busyKey !== null}
                    >
                        Arrived
                    </Button>
                    <Button
                        compact
                        mode="outlined"
                        onPress={() => setWaitStatus(item.deliveryId, 'RETURNED')}
                        style={styles.actionBtn}
                        disabled={busyKey !== null}
                    >
                        Return
                    </Button>
                </View>
            </View>
        );
    };

    const renderRescheduleItem = (item: EdgeRescheduleItem) => {
        const rescheduleStatus = normalizeStatus(item.status) || 'PENDING';
        const rescheduleTone = getRescheduleTone(rescheduleStatus, c);

        return (
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                <View style={styles.cardTopRow}>
                    <Text style={[styles.main, { color: c.text }]}>{item.deliveryId}</Text>
                    <View style={[styles.badge, { backgroundColor: rescheduleTone.bg }]}>
                        <Text style={[styles.badgeText, { color: rescheduleTone.text }]}>{rescheduleStatus}</Text>
                    </View>
                </View>

                <Text style={[styles.meta, { color: c.textSec }]}>Requested Date: {item.newDate || 'N/A'}</Text>
                <Text style={[styles.meta, { color: c.textSec }]}>Time Slot: {item.newTimeSlot || 'N/A'}</Text>
                <Text style={[styles.meta, { color: c.textSec }]}>Requested At: {formatRequestedAt(item.requestedAt)}</Text>
                <Text style={[styles.meta, { color: c.textSec }]}>Notes: {item.customerNotes || 'N/A'}</Text>

                <View style={styles.rowActions}>
                    <Button
                        compact
                        mode="contained"
                        onPress={() => setRescheduleStatus(item.deliveryId, 'APPROVED')}
                        style={styles.actionBtn}
                        disabled={busyKey !== null}
                    >
                        Approve
                    </Button>
                    <Button
                        compact
                        mode="outlined"
                        onPress={() => setRescheduleStatus(item.deliveryId, 'REJECTED')}
                        style={styles.actionBtn}
                        disabled={busyKey !== null}
                    >
                        Reject
                    </Button>
                </View>
            </View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}> 
            <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.border, paddingTop: headerTopPadding }]}> 
                <Text style={[styles.title, { color: c.text }]}>Edge Cases</Text>
                <Text style={[styles.subtitle, { color: c.textSec }]}>Track waits and review reschedules with faster actions.</Text>
            </View>

            <Searchbar
                value={search}
                onChangeText={setSearch}
                placeholder="Search by delivery, status, note"
                style={[styles.search, { backgroundColor: c.search, borderColor: c.border }]}
                inputStyle={[styles.searchInput, { color: c.text }]}
                iconColor={c.textSec}
                placeholderTextColor={c.textSec}
            />

            <View style={styles.listHeaderRow}>
                <Text style={[styles.listHeaderTitle, { color: c.text }]}>Case Queue</Text>
                <Text style={[styles.listHeaderCount, { color: c.textSec }]}>{totalVisible} visible</Text>
            </View>

            <View style={styles.queueToggleWrap}>
                <SegmentedButtons
                    value={queue}
                    onValueChange={(value) => setQueue(value as EdgeQueue)}
                    style={[styles.queueToggle, { backgroundColor: c.search, borderColor: c.border }]}
                    buttons={[
                        { value: 'all', label: 'All' },
                        { value: 'waits', label: 'Waits' },
                        { value: 'reschedules', label: 'Reschedules' },
                    ]}
                />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator color={c.text} />
                </View>
            ) : (
                <SectionList
                    sections={sections}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.text} />}
                    keyExtractor={(item) => {
                        if (item.kind === 'wait') {
                            return `${item.payload.deliveryId}-${item.payload.startedAt}-wait`;
                        }
                        return `${item.payload.deliveryId}-${item.payload.requestedAt}-reschedule`;
                    }}
                    contentContainerStyle={styles.listContent}
                    stickySectionHeadersEnabled={false}
                    keyboardShouldPersistTaps="handled"
                    renderSectionHeader={({ section }) => (
                        <View style={styles.sectionHeaderRow}>
                            <Text style={[styles.sectionTitle, { color: c.text }]}>{section.title}</Text>
                            <Text style={[styles.sectionCount, { color: c.textSec }]}>{section.data.length}</Text>
                        </View>
                    )}
                    renderSectionFooter={({ section }) => {
                        if (section.data.length > 0) return null;
                        return <Text style={[styles.emptyInline, { color: c.textSec }]}>{section.emptyMessage}</Text>;
                    }}
                    renderItem={({ item }) => {
                        if (item.kind === 'wait') return renderWaitItem(item.payload);
                        return renderRescheduleItem(item.payload);
                    }}
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
    search: {
        marginHorizontal: 14,
        marginTop: 10,
        marginBottom: 4,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 0,
        borderRadius: 12,
        minHeight: 44,
    },
    searchInput: {
        fontFamily: 'Inter_500Medium',
        fontSize: 14,
    },
    listHeaderRow: {
        marginHorizontal: 14,
        marginTop: 8,
        marginBottom: 6,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    listHeaderTitle: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    listHeaderCount: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    queueToggleWrap: {
        marginHorizontal: 14,
        marginBottom: 6,
    },
    queueToggle: {
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
    },
    error: {
        color: '#D32F2F',
        marginHorizontal: 16,
        marginTop: 6,
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    listContent: {
        paddingBottom: 24,
    },
    sectionHeaderRow: {
        marginTop: 10,
        marginHorizontal: 14,
        marginBottom: 6,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    sectionTitle: {
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
    },
    sectionCount: {
        fontSize: 12,
        fontFamily: 'Inter_600SemiBold',
    },
    card: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        padding: 12,
        marginHorizontal: 14,
        marginBottom: 10,
    },
    cardTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    badge: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
        alignSelf: 'flex-start',
    },
    badgeText: {
        fontSize: 11,
        letterSpacing: 0.4,
        fontFamily: 'Inter_700Bold',
    },
    main: { fontSize: 14, fontFamily: 'Inter_700Bold' },
    meta: { marginTop: 4, fontSize: 13, fontFamily: 'Inter_500Medium' },
    rowActions: {
        marginTop: 12,
        flexDirection: 'row',
        gap: 8,
    },
    actionBtn: {
        flex: 1,
        borderRadius: 10,
    },
    emptyInline: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
});
