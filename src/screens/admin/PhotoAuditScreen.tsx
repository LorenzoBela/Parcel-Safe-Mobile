import React, { useEffect, useMemo, useState } from 'react';
import { View, Animated, StyleSheet, Image, ScrollView, Linking, RefreshControl, StatusBar, useWindowDimensions } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { ActivityIndicator, Button, Chip, Text } from 'react-native-paper';
import {
    subscribeToPhotoAuditLog,
    subscribeToDeliveryProof,
    PhotoAuditState,
    DeliveryProofState,
} from '../../services/firebaseClient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const lightC = {
    bg: '#F3F3F0',
    card: '#FFFFFF',
    border: '#DEDED8',
    text: '#121212',
    textSec: '#64645F',
    muted: '#8A8A84',
    accent: '#1E6FDB',
    danger: '#D32F2F',
    chipBg: '#ECECE8',
    chipText: '#52524D',
};
const darkC = {
    bg: '#090909',
    card: '#121212',
    border: '#2A2A2A',
    text: '#F4F4F4',
    textSec: '#B2B2B2',
    muted: '#7A7A7A',
    accent: '#6BA3FF',
    danger: '#FF7C7C',
    chipBg: '#1B1B1B',
    chipText: '#B7B7B7',
};

type AuditPhotoItem = {
    id: string;
    label: string;
    url: string;
    uploadedAt?: number;
    objectPath?: string;
};

function formatTimestamp(timestamp?: number): string {
    if (!timestamp || !Number.isFinite(timestamp)) return 'N/A';
    return new Date(timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function PhotoAuditScreen({ route }: any) {
    const deliveryId = route?.params?.logId || route?.params?.deliveryId || route?.params?.id || null;
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const headerTopPadding = Math.max(insets.top + 8, 18);

    const [audit, setAudit] = useState<PhotoAuditState | null>(null);
    const [proof, setProof] = useState<DeliveryProofState | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshTick, setRefreshTick] = useState(0);
    const [auditReady, setAuditReady] = useState(!deliveryId);
    const [proofReady, setProofReady] = useState(!deliveryId);
    const [activePhotoIndex, setActivePhotoIndex] = useState(0);
    const [linkError, setLinkError] = useState<string | null>(null);

    useEffect(() => {
        if (!deliveryId) {
            setAuditReady(true);
            setProofReady(true);
            setAudit(null);
            setProof(null);
            return;
        }

        setAuditReady(false);
        setProofReady(false);

        const unsubAudit = subscribeToPhotoAuditLog(deliveryId, (state) => {
            setAudit(state);
            setAuditReady(true);
        });

        const unsubProof = subscribeToDeliveryProof(deliveryId, (state) => {
            setProof(state);
            setProofReady(true);
        });

        return () => {
            unsubAudit();
            unsubProof();
        };
    }, [deliveryId, refreshTick]);

    const onRefresh = async () => {
        setRefreshing(true);
        setRefreshTick((prev) => prev + 1);
        await new Promise((resolve) => setTimeout(resolve, 450));
        setRefreshing(false);
    };

    const photos = useMemo<AuditPhotoItem[]>(() => {
        const next: AuditPhotoItem[] = [];
        const seen = new Set<string>();

        const dropoffUrl = proof?.proof_photo_url || audit?.latest_photo_url;
        const dropoffUploadedAt = proof?.proof_photo_uploaded_at || audit?.latest_photo_uploaded_at;
        const dropoffPath = proof?.proof_photo_object_path || audit?.latest_photo_object_path;

        const add = (label: string, url?: string, uploadedAt?: number, objectPath?: string) => {
            const normalized = String(url || '').trim();
            if (!normalized || seen.has(normalized)) return;

            seen.add(normalized);
            next.push({
                id: `${label}-${next.length}`,
                label,
                url: normalized,
                uploadedAt,
                objectPath,
            });
        };

        add('Pickup Photo', proof?.pickup_photo_url, proof?.pickup_photo_uploaded_at, proof?.pickup_photo_storage_path);
        add('Drop-off Photo', dropoffUrl, dropoffUploadedAt, dropoffPath);
        add('Return Photo', proof?.return_photo_url, proof?.return_photo_uploaded_at);

        return next;
    }, [audit, proof]);

    useEffect(() => {
        if (activePhotoIndex < photos.length) return;
        setActivePhotoIndex(photos.length > 0 ? photos.length - 1 : 0);
    }, [activePhotoIndex, photos.length]);

    const isLoading = !!deliveryId && (!auditReady || !proofReady);
    const currentPhoto = photos[activePhotoIndex] || null;

    const uploadedAtText = formatTimestamp(
        currentPhoto?.uploadedAt ||
            audit?.latest_photo_uploaded_at ||
            proof?.proof_photo_uploaded_at ||
            proof?.pickup_photo_uploaded_at ||
            proof?.return_photo_uploaded_at
    );

    const objectPathText =
        currentPhoto?.objectPath ||
        audit?.latest_photo_object_path ||
        proof?.proof_photo_object_path ||
        proof?.pickup_photo_storage_path ||
        'N/A';

    const openPhoto = async (url: string) => {
        setLinkError(null);
        try {
            await Linking.openURL(url);
        } catch {
            setLinkError('Unable to open image link on this device.');
        }
    };

    const InfoRow = ({ label, value }: { label: string; value: string }) => (
        <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: c.textSec }]}>{label}</Text>
            <Text style={[styles.infoValue, { color: c.text }]}>{value}</Text>
        </View>
    );

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.screen, { backgroundColor: c.bg }, screenAnim.style]}>
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />

            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
            >
                <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.border, paddingTop: headerTopPadding }]}>
                    <Text style={[styles.title, { color: c.text }]}>Photo Audit</Text>
                    <Text style={[styles.subtitle, { color: c.textSec }]}>
                        {deliveryId
                            ? `Delivery ID: ${deliveryId} · Review pickup and drop-off proof photos.`
                            : 'Review pickup and drop-off proof photos.'}
                    </Text>

                    <View style={styles.chipRow}>
                        <Chip compact icon="camera-outline" style={[styles.chip, { backgroundColor: c.chipBg }]} textStyle={[styles.chipText, { color: c.chipText }]}>
                            Pickup + Drop-off
                        </Chip>
                        <Chip compact icon="image-multiple" style={[styles.chip, { backgroundColor: c.chipBg }]} textStyle={[styles.chipText, { color: c.chipText }]}>
                            {photos.length} Photos
                        </Chip>
                    </View>
                </View>

                {!deliveryId ? (
                    <View style={styles.emptyWrap}>
                        <MaterialCommunityIcons name="alert-circle-outline" size={36} color={c.textSec} />
                        <Text style={[styles.emptyText, { color: c.textSec }]}>No delivery selected yet. Open Photo Audit from a delivery to review pickup and drop-off photos.</Text>
                    </View>
                ) : isLoading ? (
                    <View style={styles.loadingWrap}>
                        <ActivityIndicator color={c.accent} />
                        <Text style={[styles.loadingText, { color: c.textSec }]}>Loading pickup and drop-off photos...</Text>
                    </View>
                ) : (
                    <>
                        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
                            <InfoRow label="Delivery ID" value={audit?.delivery_id || deliveryId || 'Not provided'} />
                            <InfoRow label="Box ID" value={audit?.box_id || 'N/A'} />
                            <InfoRow label="Object Path" value={objectPathText} />
                            <InfoRow label="Uploaded At" value={uploadedAtText} />
                        </View>

                        <Text style={[styles.sectionTitle, { color: c.text }]}>Pickup & Drop-off Photos</Text>

                        {photos.length === 0 ? (
                            <View style={styles.emptyWrap}>
                                <MaterialCommunityIcons name="camera-off-outline" size={36} color={c.textSec} />
                                <Text style={[styles.emptyText, { color: c.textSec }]}>No pickup/drop-off photos uploaded yet.</Text>
                            </View>
                        ) : (
                            <>
                                <ScrollView
                                    horizontal
                                    pagingEnabled
                                    showsHorizontalScrollIndicator={false}
                                    onMomentumScrollEnd={(event) => {
                                        const index = Math.round(event.nativeEvent.contentOffset.x / width);
                                        const nextIndex = Math.max(0, Math.min(index, photos.length - 1));
                                        setActivePhotoIndex(nextIndex);
                                    }}
                                >
                                    {photos.map((photo) => (
                                        <View key={photo.id} style={[styles.slide, { width }]}> 
                                            <View style={[styles.photoCard, { backgroundColor: c.card, borderColor: c.border }]}> 
                                                <Image source={{ uri: photo.url }} style={styles.image} resizeMode="cover" />

                                                <View style={styles.photoMetaRow}>
                                                    <View style={styles.photoMetaCol}>
                                                        <Text style={[styles.photoLabel, { color: c.text }]}>{photo.label}</Text>
                                                        <Text style={[styles.photoCaption, { color: c.textSec }]}>Uploaded: {formatTimestamp(photo.uploadedAt)}</Text>
                                                    </View>

                                                    <Button mode="text" compact onPress={() => openPhoto(photo.url)} textColor={c.accent}>
                                                        Open Full
                                                    </Button>
                                                </View>
                                            </View>
                                        </View>
                                    ))}
                                </ScrollView>

                                <View style={styles.paginationRow}>
                                    {photos.map((item, index) => (
                                        <View
                                            key={`${item.id}-dot`}
                                            style={[
                                                styles.dot,
                                                { backgroundColor: index === activePhotoIndex ? c.accent : c.border },
                                            ]}
                                        />
                                    ))}
                                </View>

                                {linkError ? <Text style={[styles.errorText, { color: c.danger }]}>{linkError}</Text> : null}
                            </>
                        )}
                    </>
                )}
            </ScrollView>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    container: { flex: 1 },
    scrollContent: { paddingBottom: 24 },
    header: {
        paddingTop: 18,
        paddingHorizontal: 16,
        paddingBottom: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    title: {
        fontSize: 22,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -0.3,
    },
    subtitle: {
        marginTop: 4,
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    chipRow: {
        marginTop: 10,
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
    },
    chip: {
        borderRadius: 999,
    },
    chipText: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
    },
    loadingWrap: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 32,
        gap: 8,
    },
    loadingText: {
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    card: {
        marginHorizontal: 14,
        marginTop: 12,
        borderRadius: 14,
        padding: 16,
        borderWidth: StyleSheet.hairlineWidth,
    },
    infoRow: {
        marginBottom: 12,
    },
    infoLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    infoValue: {
        fontSize: 14,
        fontFamily: 'Inter_500Medium',
    },
    sectionTitle: {
        fontSize: 17,
        fontFamily: 'Inter_700Bold',
        marginHorizontal: 14,
        marginTop: 14,
        marginBottom: 8,
    },
    slide: {
        alignItems: 'center',
    },
    photoCard: {
        width: '100%',
        marginHorizontal: 14,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        padding: 12,
    },
    image: {
        width: '100%',
        height: 240,
        borderRadius: 12,
    },
    photoMetaRow: {
        marginTop: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    photoMetaCol: {
        flex: 1,
    },
    photoLabel: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    photoCaption: {
        marginTop: 3,
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    paginationRow: {
        marginTop: 10,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
    },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
    },
    emptyWrap: {
        alignItems: 'center',
        paddingTop: 30,
        gap: 10,
    },
    emptyText: {
        textAlign: 'center',
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    errorText: {
        marginTop: 8,
        marginHorizontal: 14,
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
});
