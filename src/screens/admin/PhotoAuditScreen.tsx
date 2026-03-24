import React, { useEffect, useState } from 'react';
import { View, Animated, StyleSheet, Image, ScrollView, Dimensions, Linking, TouchableOpacity, StatusBar } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text } from 'react-native-paper';
import {
    subscribeToPhotoAuditLog,
    subscribeToDeliveryProof,
    PhotoAuditState,
    DeliveryProofState,
} from '../../services/firebaseClient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../context/ThemeContext';

const lightC = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA', text: '#000000',
    textSec: '#6B6B6B', accent: '#000000',
};
const darkC = {
    bg: '#000000', card: '#141414', border: '#2C2C2E', text: '#FFFFFF',
    textSec: '#8E8E93', accent: '#FFFFFF',
};

export default function PhotoAuditScreen({ route }: any) {
    const { logId } = route.params || {};
    const width = Dimensions.get('window').width;
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;

    const [audit, setAudit] = useState<PhotoAuditState | null>(null);
    const [proof, setProof] = useState<DeliveryProofState | null>(null);

    useEffect(() => {
        if (!logId) return;
        const unsubAudit = subscribeToPhotoAuditLog(logId, setAudit);
        const unsubProof = subscribeToDeliveryProof(logId, setProof);
        return () => {
            unsubAudit();
            unsubProof();
        };
    }, [logId]);

    const resolvedPhotoUrl = audit?.latest_photo_url || proof?.proof_photo_url;
    const photos = resolvedPhotoUrl ? [resolvedPhotoUrl] : [];

    const InfoRow = ({ label, value }: { label: string; value: string }) => (
        <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: c.textSec }]}>{label}</Text>
            <Text style={[styles.infoValue, { color: c.text }]}>{value}</Text>
        </View>
    );

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[{ flex: 1 }, screenAnim.style]}>
        <ScrollView style={[styles.container, { backgroundColor: c.bg }]}>
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />

            <Text style={[styles.title, { color: c.text }]}>Audit Logs for ID: {logId}</Text>

            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
                <InfoRow label="Delivery ID" value={audit?.delivery_id || logId || 'N/A'} />
                <InfoRow label="Box ID" value={audit?.box_id || 'N/A'} />
                <InfoRow label="Object Path" value={audit?.latest_photo_object_path || proof?.proof_photo_object_path || 'N/A'} />
                <InfoRow label="Uploaded At" value={String(audit?.latest_photo_uploaded_at || proof?.proof_photo_uploaded_at || 'N/A')} />
            </View>

            <Text style={[styles.sectionTitle, { color: c.text }]}>Captured Photos</Text>
            {photos.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <MaterialCommunityIcons name="camera-off-outline" size={36} color={c.textSec} />
                    <Text style={[styles.emptyText, { color: c.textSec }]}>No uploaded photo found yet.</Text>
                </View>
            ) : (
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                    {photos.map((photo, index) => (
                        <View key={index} style={{ width, alignItems: 'center' }}>
                            <Image source={{ uri: photo }} style={styles.image} resizeMode="cover" />
                            <TouchableOpacity onPress={() => Linking.openURL(photo)}>
                                <Text style={[styles.linkText, { color: c.accent }]}>Open full image</Text>
                            </TouchableOpacity>
                        </View>
                    ))}
                </ScrollView>
            )}
        </ScrollView>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    title: {
        fontSize: 22,
        fontFamily: 'Inter_700Bold',
        padding: 20,
        paddingBottom: 12,
        letterSpacing: -0.3,
    },
    card: {
        marginHorizontal: 20,
        borderRadius: 14,
        padding: 16,
        borderWidth: 1,
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
        padding: 20,
        paddingBottom: 8,
    },
    image: {
        width: Dimensions.get('window').width - 40,
        height: 220,
        borderRadius: 14,
        margin: 20,
        marginTop: 8,
    },
    emptyWrap: {
        alignItems: 'center',
        paddingTop: 30,
        gap: 10,
    },
    emptyText: {
        textAlign: 'center',
    },
    linkText: {
        fontSize: 14,
        fontFamily: 'Inter_600SemiBold',
        marginBottom: 12,
    },
});
