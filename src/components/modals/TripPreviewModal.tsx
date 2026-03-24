import React from 'react';
import { View, StyleSheet, Modal, Linking, Platform } from 'react-native';
import { Text, Button, Surface, useTheme, Divider, IconButton, Avatar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface TripPreviewModalProps {
    visible: boolean;
    onDismiss: () => void;
    onStartTrip: () => void;
    tripDetails: {
        pickupAddress: string;
        dropoffAddress: string;
        estimatedFare: number;
        distance: string; // e.g. "5.2 km"
        duration: string; // e.g. "15 min"
        pickupLat: number;
        pickupLng: number;
        dropoffLat: number;
        dropoffLng: number;
        customerName?: string; // EC-Fix: Added
    } | null;
}

export default function TripPreviewModal({ visible, onDismiss, onStartTrip, tripDetails }: TripPreviewModalProps) {
    const theme = useTheme();

    if (!tripDetails) return null;

    const handleOpenMaps = async () => {
        const { pickupLat, pickupLng } = tripDetails;

        const label = encodeURIComponent(tripDetails.pickupAddress);
        const latLng = `${pickupLat},${pickupLng}`;
        const browserUrl = `https://www.google.com/maps/dir/?api=1&destination=${latLng}&travelmode=driving`;

        // Primary: google.navigation for turn-by-turn (Android), Apple Maps (iOS)
        const primaryUrl = Platform.select({
            ios: `maps:?ll=${latLng}&q=${label}`,
            android: `google.navigation:q=${latLng}&mode=d`,
        })!;

        // Fallback: geo: scheme (Android), Apple Maps HTTPS (iOS)
        const fallbackUrl = Platform.select({
            ios: `https://maps.apple.com/?ll=${latLng}&q=${label}`,
            android: `geo:${latLng}?q=${latLng}(${label})`,
        })!;

        try {
            const supported = await Linking.canOpenURL(primaryUrl);
            if (supported) {
                await Linking.openURL(primaryUrl);
            } else {
                await Linking.openURL(fallbackUrl);
            }
        } catch (error) {
            console.error('[TripPreviewModal] Failed to open maps:', error);
            try {
                await Linking.openURL(browserUrl);
            } catch (browserError) {
                console.error('[TripPreviewModal] Browser fallback also failed:', browserError);
            }
        }
    };

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="slide"
            onRequestClose={onDismiss}
        >
            <View style={styles.modalOverlay}>
                <Surface style={[styles.modalContent, { backgroundColor: theme.colors.elevation.level3 }]} elevation={5}>
                    <View style={styles.header}>
                        <Text variant="titleMedium" style={styles.title}>New Request Accepted!</Text>
                        <IconButton icon="close" size={24} onPress={onDismiss} />
                    </View>

                    <Divider style={styles.divider} />

                    {/* Customer Name */}
                    {tripDetails.customerName && (
                        <View style={[styles.customerContainer, { backgroundColor: theme.colors.elevation.level1 }]}>
                            <Avatar.Text
                                size={40}
                                label={tripDetails.customerName.charAt(0).toUpperCase()}
                                style={{ backgroundColor: theme.colors.primaryContainer }}
                                color={theme.colors.onPrimaryContainer}
                            />
                            <View style={{ marginLeft: 12 }}>
                                <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold' }}>{tripDetails.customerName}</Text>
                                <Text variant="bodySmall" style={{ color: theme.colors.outline }}>Customer</Text>
                            </View>
                        </View>
                    )}

                    <Divider style={styles.divider} />

                    <View style={styles.detailsContainer}>
                        {/* Pickup */}
                        <View style={styles.row}>
                            <MaterialCommunityIcons name="map-marker-outline" size={24} color={theme.colors.primary} />
                            <View style={styles.textContainer}>
                                <Text variant="labelMedium" style={{ color: theme.colors.outline }}>PICKUP</Text>
                                <Text variant="bodyMedium" numberOfLines={2}>{tripDetails.pickupAddress}</Text>
                            </View>
                        </View>

                        {/* Connector Line */}
                        <View style={[styles.connectorLine, { backgroundColor: theme.colors.outlineVariant }]} />

                        {/* Dropoff */}
                        <View style={styles.row}>
                            <MaterialCommunityIcons name="flag-checkered" size={24} color={theme.colors.error} />
                            <View style={styles.textContainer}>
                                <Text variant="labelMedium" style={{ color: theme.colors.outline }}>DROPOFF</Text>
                                <Text variant="bodyMedium" numberOfLines={2}>{tripDetails.dropoffAddress}</Text>
                            </View>
                        </View>
                    </View>

                    <View style={[styles.statsContainer, { backgroundColor: theme.colors.elevation.level1 }]}>
                        <View style={styles.statItem}>
                            <Text variant="headlineSmall" style={{ color: theme.colors.primary, fontFamily: 'Inter_700Bold' }}>
                                ₱{tripDetails.estimatedFare.toFixed(2)}
                            </Text>
                            <Text variant="bodySmall">Est. Fare</Text>
                        </View>
                        <View style={[styles.verticalDivider, { backgroundColor: theme.colors.outlineVariant }]} />
                        <View style={styles.statItem}>
                            <Text variant="titleMedium">{tripDetails.distance}</Text>
                            <Text variant="bodySmall">Distance</Text>
                        </View>
                        {/* Duration is optional if not available immediately */}
                        <View style={[styles.verticalDivider, { backgroundColor: theme.colors.outlineVariant }]} />
                        <View style={styles.statItem}>
                            <Text variant="titleMedium">{tripDetails.duration || '-- min'}</Text>
                            <Text variant="bodySmall">Est. Time</Text>
                        </View>
                    </View>

                    <View style={styles.actionButtons}>
                        <Button
                            mode="outlined"
                            icon="google-maps"
                            onPress={handleOpenMaps}
                            style={[styles.mapButton, { borderColor: theme.colors.outline }]}
                        >
                            Open Maps
                        </Button>
                        <Button
                            mode="contained"
                            icon="bike"
                            onPress={onStartTrip}
                            contentStyle={{ height: 48 }}
                            style={styles.startButton}
                        >
                            Start Trip
                        </Button>
                    </View>
                </Surface>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 20,
        paddingBottom: 40,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    title: {
        fontFamily: 'Inter_700Bold',
    },
    divider: {
        marginBottom: 20,
    },
    detailsContainer: {
        marginBottom: 20,
    },
    customerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderRadius: 12,
        paddingHorizontal: 12,
        marginBottom: 16
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 0,
    },
    textContainer: {
        marginLeft: 12,
        flex: 1,
    },
    connectorLine: {
        width: 2,
        height: 30, // Adjust based on spacing
        marginLeft: 11, // Align with icon center (24/2 - 1)
        marginVertical: 4,
    },
    statsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderRadius: 12,
        padding: 16,
        marginBottom: 24,
    },
    statItem: {
        alignItems: 'center',
        flex: 1,
    },
    verticalDivider: {
        width: 1,
        height: 24,
    },
    actionButtons: {
        gap: 12,
    },
    mapButton: {
    },
    startButton: {
        // Primary button style
    }
});
