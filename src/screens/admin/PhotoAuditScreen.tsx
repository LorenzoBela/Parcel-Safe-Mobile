import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Image, ScrollView, Dimensions, Linking } from 'react-native';
import { Text, Card } from 'react-native-paper';
import {
    subscribeToPhotoAuditLog,
    subscribeToDeliveryProof,
    PhotoAuditState,
    DeliveryProofState,
} from '../../services/firebaseClient';

export default function PhotoAuditScreen({ route }) {
    const { logId } = route.params || {};
    const width = Dimensions.get('window').width;
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

    return (
        <ScrollView style={styles.container}>
            <Text variant="headlineSmall" style={styles.title}>Audit Logs for ID: {logId}</Text>

            <Card style={styles.card}>
                <Card.Content>
                    <Text variant="bodyMedium">Delivery ID: {audit?.delivery_id || logId || 'N/A'}</Text>
                    <Text variant="bodyMedium">Box ID: {audit?.box_id || 'N/A'}</Text>
                    <Text variant="bodyMedium">Object Path: {audit?.latest_photo_object_path || proof?.proof_photo_object_path || 'N/A'}</Text>
                    <Text variant="bodyMedium">Uploaded At: {audit?.latest_photo_uploaded_at || proof?.proof_photo_uploaded_at || 'N/A'}</Text>
                </Card.Content>
            </Card>

            <Text variant="titleMedium" style={styles.sectionTitle}>Captured Photos</Text>
            {photos.length === 0 ? (
                <Text style={styles.emptyText}>No uploaded photo found for this audit log yet.</Text>
            ) : (
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                    {photos.map((photo, index) => (
                        <View key={index} style={{ width, alignItems: 'center' }}>
                            <Image source={{ uri: photo }} style={styles.image} resizeMode="cover" />
                            <Text style={styles.linkText} onPress={() => Linking.openURL(photo)}>
                                Open full image URL
                            </Text>
                        </View>
                    ))}
                </ScrollView>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    title: {
        padding: 16,
    },
    card: {
        margin: 16,
    },
    sectionTitle: {
        padding: 16,
        paddingBottom: 0,
    },
    image: {
        width: Dimensions.get('window').width - 32,
        height: 200,
        borderRadius: 8,
        margin: 16,
    },
    emptyText: {
        paddingHorizontal: 16,
        color: '#666',
    },
    linkText: {
        color: '#1565C0',
        marginBottom: 12,
    },
});
