import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    Modal,
    RefreshControl,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';
import { Button, Searchbar, SegmentedButtons, Text } from 'react-native-paper';
import {
    listAdminDeliveryRecords,
    listReceiptSendHistory,
    AdminDeliveryRecord,
    ReceiptSendHistorySummary,
} from '../../services/supabaseClient';
import { sendAdminReceipt, SendReceiptPayload } from '../../services/adminApiService';
import { useAppTheme } from '../../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type SortMode = 'latest' | 'fare';
type ReceiptHistoryById = Record<string, ReceiptSendHistorySummary>;

const lightC = {
    bg: '#F3F3F0',
    card: '#FFFFFF',
    border: '#DEDED8',
    text: '#121212',
    textSec: '#64645F',
    muted: '#8A8A84',
    accent: '#121212',
    accentText: '#FFFFFF',
    search: '#ECECE8',
    success: '#2E7D32',
    sentBg: '#E2EFE5',
    sentText: '#2B6A3A',
};

const darkC = {
    bg: '#090909',
    card: '#121212',
    border: '#2A2A2A',
    text: '#F4F4F4',
    textSec: '#B2B2B2',
    muted: '#7A7A7A',
    accent: '#FFFFFF',
    accentText: '#000000',
    search: '#171717',
    success: '#8DD5A0',
    sentBg: '#223429',
    sentText: '#9CDAB0',
};

function formatDate(value?: string | null): string {
    if (!value) return 'N/A';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return 'N/A';
    return dt.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function toCurrency(value?: number | null): string {
    if (value == null) return 'N/A';
    return `PHP ${Number(value).toFixed(2)}`;
}

function toDistanceKm(record: AdminDeliveryRecord): string {
    if (record.distance != null) return `${Number(record.distance).toFixed(2)} km`;
    return 'N/A';
}

function toDuration(record: AdminDeliveryRecord): string {
    if (record.delivered_at && record.created_at) {
        const start = new Date(record.created_at).getTime();
        const end = new Date(record.delivered_at).getTime();
        if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
            const mins = Math.round((end - start) / 60000);
            if (mins < 60) return `${mins} mins`;
            return `${Math.floor(mins / 60)}h ${mins % 60}m`;
        }
    }
    return 'N/A';
}

function toSortTimestamp(record: AdminDeliveryRecord): number {
    const target = record.delivered_at || record.created_at;
    const time = new Date(target).getTime();
    return Number.isFinite(time) ? time : 0;
}

function formatSentAt(value?: string | null): string {
    if (!value) return 'N/A';
    return new Date(value).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function buildReceiptPayload(item: AdminDeliveryRecord): SendReceiptPayload {
    return {
        deliveryId: item.id,
        email: item.profiles?.email || '',
        trackingNumber: item.tracking_number,
        date: formatDate(item.delivered_at || item.created_at),
        distance: toDistanceKm(item),
        duration: toDuration(item),
        fare: toCurrency(item.estimated_fare),
        customerName: item.profiles?.full_name || 'Customer',
        senderName: item.profiles?.full_name || 'Sender',
        senderPhone: 'N/A',
        pickupAddress: item.pickup_address || 'N/A',
        dropoffAddress: item.dropoff_address || 'N/A',
        pickupPhotoUrl: item.pickup_photo_url || undefined,
        pickupPhotoTime: item.created_at ? formatDate(item.created_at) : undefined,
        proofPhotoUrl: item.proof_of_delivery_url || undefined,
        proofPhotoTime: item.delivered_at ? formatDate(item.delivered_at) : undefined,
        websiteUrl: 'https://parcel-safe.vercel.app',
    };
}

export default function AdminReceiptsScreen() {
    const { isDarkMode } = useAppTheme();
    const insets = useSafeAreaInsets();
    const c = isDarkMode ? darkC : lightC;
    const headerTopPadding = Math.max(insets.top + 8, 18);

    const [items, setItems] = useState<AdminDeliveryRecord[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [sendingId, setSendingId] = useState<string | null>(null);
    const [sortMode, setSortMode] = useState<SortMode>('latest');
    const [historyById, setHistoryById] = useState<ReceiptHistoryById>({});
    const [previewItem, setPreviewItem] = useState<AdminDeliveryRecord | null>(null);

    const load = useCallback(async () => {
        setError(null);
        const result = await listAdminDeliveryRecords({
            page: 1,
            pageSize: 200,
            status: ['COMPLETED'],
        });

        if (result.error) {
            setError(result.error);
            setItems([]);
            setHistoryById({});
            return;
        }

        const nextItems = result.data || [];
        setItems(nextItems);

        const history = await listReceiptSendHistory(nextItems.map((entry) => entry.id));
        setHistoryById(history);
    }, []);

    useEffect(() => {
        let mounted = true;
        (async () => {
            setLoading(true);
            await load();
            if (mounted) setLoading(false);
        })();
        return () => {
            mounted = false;
        };
    }, [load]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return items;
        return items.filter((item) => {
            const tracking = item.tracking_number?.toLowerCase() ?? '';
            const name = item.profiles?.full_name?.toLowerCase() ?? '';
            const email = item.profiles?.email?.toLowerCase() ?? '';
            const rider = item.rider_profile?.full_name?.toLowerCase() ?? '';
            return tracking.includes(term) || name.includes(term) || email.includes(term) || rider.includes(term);
        });
    }, [items, search]);

    const visibleItems = useMemo(() => {
        const next = [...filtered];
        if (sortMode === 'fare') {
            next.sort((a, b) => Number(b.estimated_fare || 0) - Number(a.estimated_fare || 0));
            return next;
        }

        next.sort((a, b) => toSortTimestamp(b) - toSortTimestamp(a));
        return next;
    }, [filtered, sortMode]);

    const totalFare = useMemo(
        () => visibleItems.reduce((sum, item) => sum + Number(item.estimated_fare || 0), 0),
        [visibleItems]
    );

    const sentCount = useMemo(
        () => visibleItems.filter((item) => Number(historyById[item.id]?.sendCount || 0) > 0).length,
        [visibleItems, historyById]
    );

    const onRefresh = async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
    };

    const onSendReceipt = async (item: AdminDeliveryRecord) => {
        const payload = buildReceiptPayload(item);
        const email = payload.email;

        if (!email) {
            setError('Selected delivery has no customer email.');
            setNotice(null);
            return;
        }

        setSendingId(item.id);
        setError(null);
        setNotice(null);
        try {
            await sendAdminReceipt(payload);

            const persistedHistory = await listReceiptSendHistory([item.id]);
            const persistedEntry = persistedHistory[item.id];

            setHistoryById((prev) => {
                if (persistedEntry) {
                    return {
                        ...prev,
                        [item.id]: persistedEntry,
                    };
                }

                const nowIso = new Date().toISOString();
                const previous = prev[item.id];
                return {
                    ...prev,
                    [item.id]: {
                        deliveryId: item.id,
                        sendCount: (previous?.sendCount || 0) + 1,
                        lastSentAt: nowIso,
                    },
                };
            });

            setNotice(`Receipt sent to ${email}.`);
        } catch (e: any) {
            setError(e?.message || 'Failed to send receipt.');
        } finally {
            setSendingId(null);
        }
    };

    const onSendFromPreview = async () => {
        if (!previewItem) {
            return;
        }

        const target = previewItem;
        setPreviewItem(null);
        await onSendReceipt(target);
    };

    const previewPayload = useMemo(() => {
        if (!previewItem) {
            return null;
        }
        return buildReceiptPayload(previewItem);
    }, [previewItem]);

    const previewHasEmail = Boolean(previewPayload?.email);
    const previewIsSending = Boolean(previewItem && sendingId === previewItem.id);
    const previewWasSent = Boolean(previewItem && (historyById[previewItem.id]?.sendCount || 0) > 0);

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}> 
            <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.border, paddingTop: headerTopPadding }]}> 
                <Text style={[styles.title, { color: c.text }]}>Receipts</Text>
                <Text style={[styles.subtitle, { color: c.textSec }]}>Review completed jobs and dispatch customer receipts.</Text>
            </View>

            <Searchbar
                value={search}
                onChangeText={setSearch}
                placeholder="Search by tracking, customer name, email"
                style={[styles.search, { backgroundColor: c.search, borderColor: c.border }]}
                inputStyle={[styles.searchInput, { color: c.text }]}
                iconColor={c.textSec}
                placeholderTextColor={c.textSec}
            />

            <View style={styles.listHeaderRow}>
                <Text style={[styles.listHeaderTitle, { color: c.text }]}>Completed Deliveries</Text>
                <Text style={[styles.listHeaderCount, { color: c.textSec }]}>{visibleItems.length} visible</Text>
            </View>

            <View style={styles.summaryRow}>
                <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}> 
                    <Text style={[styles.summaryLabel, { color: c.textSec }]}>TOTAL</Text>
                    <Text style={[styles.summaryValue, { color: c.text }]}>{visibleItems.length}</Text>
                </View>

                <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}> 
                    <Text style={[styles.summaryLabel, { color: c.textSec }]}>FARE</Text>
                    <Text style={[styles.summaryValue, { color: c.text }]}>{toCurrency(totalFare)}</Text>
                </View>

                <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}> 
                    <Text style={[styles.summaryLabel, { color: c.textSec }]}>SENT</Text>
                    <Text style={[styles.summaryValue, { color: c.text }]}>{sentCount}</Text>
                </View>
            </View>

            <View style={styles.sortWrap}>
                <SegmentedButtons
                    value={sortMode}
                    onValueChange={(value) => setSortMode(value as SortMode)}
                    style={[styles.sortToggle, { backgroundColor: c.search, borderColor: c.border }]}
                    buttons={[
                        { value: 'latest', label: 'Newest' },
                        { value: 'fare', label: 'Highest Fare' },
                    ]}
                />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {notice ? <Text style={[styles.notice, { color: c.success }]}>{notice}</Text> : null}

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator color={c.accent} />
                </View>
            ) : (
                <FlatList
                    data={visibleItems}
                    keyExtractor={(item) => item.id}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
                    contentContainerStyle={styles.listContent}
                    ListEmptyComponent={
                        <View style={styles.emptyWrap}>
                            <MaterialCommunityIcons name="file-document-outline" size={36} color={c.textSec} />
                            <Text style={[styles.empty, { color: c.textSec }]}>No completed deliveries found.</Text>
                        </View>
                    }
                    renderItem={({ item }) => {
                        const history = historyById[item.id];
                        const sendCountForItem = Number(history?.sendCount || 0);
                        const lastSentAt = history?.lastSentAt;
                        const sentBadgeVisible = sendCountForItem > 0;

                        return (
                            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                                <View style={styles.rowBetween}>
                                    <View style={styles.trackingCol}>
                                        <Text style={[styles.tracking, { color: c.text }]}>{item.tracking_number || item.id}</Text>
                                        <Text style={[styles.date, { color: c.textSec }]}>{formatDate(item.delivered_at || item.created_at)}</Text>
                                    </View>

                                    {sentBadgeVisible ? (
                                        <View style={[styles.sentBadge, { backgroundColor: c.sentBg }]}>
                                            <Text style={[styles.sentBadgeText, { color: c.sentText }]}>SENT</Text>
                                        </View>
                                    ) : null}
                                </View>

                                <Text style={[styles.meta, { color: c.textSec }]}>Customer: {item.profiles?.full_name || 'N/A'}</Text>
                                <Text style={[styles.meta, { color: c.textSec }]}>Email: {item.profiles?.email || 'N/A'}</Text>
                                <Text style={[styles.meta, { color: c.textSec }]}>Rider: {item.rider_profile?.full_name || 'N/A'}</Text>

                                <View style={styles.metricRow}>
                                    <View style={[styles.metricCard, { borderColor: c.border, backgroundColor: c.search }]}> 
                                        <Text style={[styles.metricLabel, { color: c.textSec }]}>Fare</Text>
                                        <Text style={[styles.metricValue, { color: c.text }]}>{toCurrency(item.estimated_fare)}</Text>
                                    </View>

                                    <View style={[styles.metricCard, { borderColor: c.border, backgroundColor: c.search }]}> 
                                        <Text style={[styles.metricLabel, { color: c.textSec }]}>Distance</Text>
                                        <Text style={[styles.metricValue, { color: c.text }]}>{toDistanceKm(item)}</Text>
                                    </View>

                                    <View style={[styles.metricCard, { borderColor: c.border, backgroundColor: c.search }]}> 
                                        <Text style={[styles.metricLabel, { color: c.textSec }]}>Duration</Text>
                                        <Text style={[styles.metricValue, { color: c.text }]}>{toDuration(item)}</Text>
                                    </View>
                                </View>

                                <View style={styles.addressBlock}>
                                    <Text numberOfLines={2} style={[styles.addressText, { color: c.textSec }]}>Pickup: {item.pickup_address || 'N/A'}</Text>
                                    <Text numberOfLines={2} style={[styles.addressText, { color: c.textSec }]}>Drop-off: {item.dropoff_address || 'N/A'}</Text>
                                </View>

                                <View style={styles.actionRow}>
                                    <Button
                                        mode="outlined"
                                        onPress={() => setPreviewItem(item)}
                                        style={[styles.previewBtn, { borderColor: c.border }]}
                                        contentStyle={{ height: 42 }}
                                        textColor={c.text}
                                    >
                                        Preview
                                    </Button>

                                    <Button
                                        mode="contained"
                                        onPress={() => onSendReceipt(item)}
                                        loading={sendingId === item.id}
                                        disabled={sendingId === item.id || !item.profiles?.email}
                                        style={[styles.sendBtn, styles.actionSendBtn]}
                                        contentStyle={{ height: 42 }}
                                        buttonColor={c.accent}
                                        textColor={c.accentText}
                                    >
                                        {sendCountForItem > 0 ? 'Resend Receipt' : 'Send Receipt'}
                                    </Button>
                                </View>

                                {!item.profiles?.email ? (
                                    <Text style={[styles.noEmailNote, { color: '#D32F2F' }]}>No customer email on file for this delivery.</Text>
                                ) : null}

                                {lastSentAt ? (
                                    <Text style={[styles.sentNote, { color: c.muted }]}>
                                        Last sent {formatSentAt(lastSentAt)} - {sendCountForItem} total
                                    </Text>
                                ) : null}
                            </View>
                        );
                    }}
                />
            )}

            <Modal
                visible={Boolean(previewItem)}
                animationType="slide"
                transparent
                onRequestClose={() => setPreviewItem(null)}
            >
                <View style={styles.modalBackdrop}>
                    <View style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: c.text }]}>Receipt Preview</Text>
                            <Button compact onPress={() => setPreviewItem(null)} textColor={c.textSec}>Close</Button>
                        </View>

                        <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
                            <Text style={[styles.modalTracking, { color: c.text }]}>
                                {previewItem?.tracking_number || previewItem?.id || 'N/A'}
                            </Text>
                            <Text style={[styles.modalDate, { color: c.textSec }]}>{previewPayload?.date || 'N/A'}</Text>

                            <View style={styles.metricRow}>
                                <View style={[styles.metricCard, { borderColor: c.border, backgroundColor: c.search }]}> 
                                    <Text style={[styles.metricLabel, { color: c.textSec }]}>Fare</Text>
                                    <Text style={[styles.metricValue, { color: c.text }]}>{previewPayload?.fare || 'N/A'}</Text>
                                </View>

                                <View style={[styles.metricCard, { borderColor: c.border, backgroundColor: c.search }]}> 
                                    <Text style={[styles.metricLabel, { color: c.textSec }]}>Distance</Text>
                                    <Text style={[styles.metricValue, { color: c.text }]}>{previewPayload?.distance || 'N/A'}</Text>
                                </View>

                                <View style={[styles.metricCard, { borderColor: c.border, backgroundColor: c.search }]}> 
                                    <Text style={[styles.metricLabel, { color: c.textSec }]}>Duration</Text>
                                    <Text style={[styles.metricValue, { color: c.text }]}>{previewPayload?.duration || 'N/A'}</Text>
                                </View>
                            </View>

                            <View style={styles.previewSection}>
                                <Text style={[styles.previewSectionLabel, { color: c.textSec }]}>Customer</Text>
                                <Text style={[styles.previewSectionValue, { color: c.text }]}>{previewPayload?.customerName || 'N/A'}</Text>
                                <Text style={[styles.previewLine, { color: c.textSec }]}>Email: {previewPayload?.email || 'N/A'}</Text>
                            </View>

                            <View style={styles.previewSection}>
                                <Text style={[styles.previewSectionLabel, { color: c.textSec }]}>Route</Text>
                                <Text style={[styles.previewLine, { color: c.textSec }]}>Pickup: {previewPayload?.pickupAddress || 'N/A'}</Text>
                                <Text style={[styles.previewLine, { color: c.textSec }]}>Drop-off: {previewPayload?.dropoffAddress || 'N/A'}</Text>
                            </View>

                            <View style={styles.previewSection}>
                                <Text style={[styles.previewSectionLabel, { color: c.textSec }]}>Pickup Photo</Text>
                                {previewPayload?.pickupPhotoUrl ? (
                                    <Image
                                        source={{ uri: previewPayload.pickupPhotoUrl }}
                                        style={[styles.previewImage, { borderColor: c.border }]}
                                        resizeMode="cover"
                                    />
                                ) : (
                                    <Text style={[styles.previewImageFallback, { color: c.textSec }]}>No pickup photo attached.</Text>
                                )}
                            </View>

                            <View style={styles.previewSection}>
                                <Text style={[styles.previewSectionLabel, { color: c.textSec }]}>Proof of Delivery</Text>
                                {previewPayload?.proofPhotoUrl ? (
                                    <Image
                                        source={{ uri: previewPayload.proofPhotoUrl }}
                                        style={[styles.previewImage, { borderColor: c.border }]}
                                        resizeMode="cover"
                                    />
                                ) : (
                                    <Text style={[styles.previewImageFallback, { color: c.textSec }]}>No proof photo attached.</Text>
                                )}
                            </View>
                        </ScrollView>

                        <View style={[styles.modalFooter, { borderTopColor: c.border }]}>
                            <Button
                                mode="outlined"
                                onPress={() => setPreviewItem(null)}
                                style={[styles.modalFooterButton, { borderColor: c.border }]}
                                contentStyle={{ height: 42 }}
                                textColor={c.text}
                            >
                                Close
                            </Button>
                            <Button
                                mode="contained"
                                onPress={onSendFromPreview}
                                loading={previewIsSending}
                                disabled={previewIsSending || !previewHasEmail}
                                style={styles.modalFooterButton}
                                contentStyle={{ height: 42 }}
                                buttonColor={c.accent}
                                textColor={c.accentText}
                            >
                                {previewWasSent ? 'Resend Receipt' : 'Send Receipt'}
                            </Button>
                        </View>
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
    searchInput: {
        fontSize: 14,
        fontFamily: 'Inter_500Medium',
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
    summaryRow: {
        marginHorizontal: 14,
        marginBottom: 8,
        flexDirection: 'row',
        gap: 8,
    },
    summaryCard: {
        flex: 1,
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
    sortWrap: {
        marginHorizontal: 14,
        marginBottom: 6,
    },
    sortToggle: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
    },
    error: {
        color: '#D32F2F',
        marginHorizontal: 16,
        marginTop: 6,
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    notice: {
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
        padding: 14,
        paddingBottom: 30,
    },
    emptyWrap: {
        alignItems: 'center',
        paddingTop: 34,
        gap: 8,
    },
    empty: {
        textAlign: 'center',
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
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
    trackingCol: {
        flex: 1,
    },
    tracking: { fontSize: 15, fontFamily: 'Inter_700Bold' },
    date: { fontSize: 12, marginTop: 2, fontFamily: 'Inter_500Medium' },
    sentBadge: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    sentBadgeText: {
        fontSize: 10,
        letterSpacing: 0.6,
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
    addressBlock: {
        marginTop: 9,
        gap: 3,
    },
    addressText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    actionRow: {
        marginTop: 10,
        flexDirection: 'row',
        gap: 8,
    },
    previewBtn: {
        flex: 1,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
    },
    sendBtn: { marginTop: 10, borderRadius: 10 },
    actionSendBtn: {
        flex: 1,
        marginTop: 0,
    },
    noEmailNote: {
        marginTop: 6,
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    sentNote: {
        marginTop: 6,
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.42)',
        justifyContent: 'flex-end',
    },
    modalCard: {
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        maxHeight: '88%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 8,
    },
    modalTitle: {
        fontSize: 18,
        fontFamily: 'Inter_700Bold',
    },
    modalBody: {
        paddingHorizontal: 14,
    },
    modalBodyContent: {
        paddingBottom: 12,
    },
    modalTracking: {
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
    },
    modalDate: {
        marginTop: 2,
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    previewSection: {
        marginTop: 14,
        gap: 4,
    },
    previewSectionLabel: {
        fontSize: 11,
        letterSpacing: 0.4,
        fontFamily: 'Inter_600SemiBold',
        textTransform: 'uppercase',
    },
    previewSectionValue: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    previewLine: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    previewImage: {
        marginTop: 4,
        width: '100%',
        height: 170,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        backgroundColor: '#111111',
    },
    previewImageFallback: {
        marginTop: 4,
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    modalFooter: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 14,
        flexDirection: 'row',
        gap: 8,
    },
    modalFooterButton: {
        flex: 1,
        borderRadius: 10,
    },
});
