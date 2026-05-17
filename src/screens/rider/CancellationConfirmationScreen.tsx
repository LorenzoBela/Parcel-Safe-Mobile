/**
 * EC-32: Cancellation Confirmation Screen
 * 
 * Shown to riders after successfully cancelling a delivery.
 * Displays next steps for returning the package.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, ScrollView, BackHandler } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, Surface, Button, Avatar, useTheme } from 'react-native-paper';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import {
    formatCancellationReason,
    CancellationReason,
} from '../../services/cancellationService';

interface RouteParams {
    deliveryId: string;
    reason: CancellationReason;
    reasonDetails?: string;
    senderName?: string;
    pickupAddress?: string;
    pickupLat?: number;
    pickupLng?: number;
    boxId?: string;
    isPickedUp?: boolean;
}

export default function CancellationConfirmationScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute();
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const params = route.params as RouteParams;

    const {
        deliveryId = 'TRK-XXXX-XXXX',
        reason = CancellationReason.OTHER,
        reasonDetails = '',
        senderName = 'Sender',
        pickupAddress = 'Return to pickup location',
        pickupLat,
        pickupLng,
        boxId,
        isPickedUp = false,
    } = params || {};

    // Prevent accidental back navigation
    useFocusEffect(
        useCallback(() => {
            const onBackPress = () => {
                navigation.navigate('RiderApp');
                return true;
            };

            const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
            return () => subscription.remove();
        }, [navigation])
    );

    const handleStartReturn = () => {
        navigation.navigate('Arrival', {
            deliveryId,
            boxId,
            targetAddress: pickupAddress,
            targetLat: pickupLat ?? 0,
            targetLng: pickupLng ?? 0,
            pickupAddress,
            pickupLat,
            pickupLng,
            senderName,
            status: 'RETURNING',
        });
    };

    const handleDone = () => {
        navigation.navigate('RiderApp');
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <ScrollView contentContainerStyle={styles.scrollContent}>

                {/* Success/Warning Header */}
                <Surface style={[styles.headerCard, { backgroundColor: theme.colors.errorContainer }]} elevation={0}>
                    <View style={styles.headerContent}>
                        <MaterialCommunityIcons
                            name="alert-circle-check"
                            size={64}
                            color={theme.colors.error}
                        />
                        <Text variant="headlineSmall" style={[styles.headerTitle, { color: theme.colors.onErrorContainer }]}>
                            Delivery Cancelled
                        </Text>
                        <Text variant="bodyMedium" style={{ color: theme.colors.onErrorContainer, textAlign: 'center' }}>
                            {formatCancellationReason(reason)}
                            {reasonDetails ? ` - ${reasonDetails}` : ''}
                        </Text>
                    </View>
                </Surface>

                {/* Delivery ID Card */}
                <Surface style={[styles.infoCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <View style={styles.infoRow}>
                        <MaterialCommunityIcons name="package-variant" size={20} color={theme.colors.primary} />
                        <Text variant="bodyMedium" style={{ marginLeft: 12, color: theme.colors.onSurface }}>
                            Tracking Number
                        </Text>
                    </View>
                    <Text
                        variant="titleMedium"
                        numberOfLines={1}
                        ellipsizeMode="middle"
                        style={{ fontFamily: 'Inter_700Bold', marginTop: 4, color: theme.colors.onSurface }}
                    >
                        {deliveryId}
                    </Text>
                </Surface>



                {isPickedUp && (
                    <>
                        {/* Next Steps Card */}
                        <Surface style={[styles.stepsCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
                            <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', marginBottom: 16, color: theme.colors.onSurface }}>
                                Next Steps
                            </Text>

                            <View style={styles.stepRow}>
                                <Avatar.Text size={28} label="1" style={{ backgroundColor: theme.colors.primary }} />
                                <View style={styles.stepContent}>
                                    <Text variant="bodyMedium" style={{ fontFamily: 'Inter_600SemiBold', color: theme.colors.onSurface }}>
                                        Return to Pickup Location
                                    </Text>
                                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                        Navigate back to where you picked up the package
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.stepConnector} />

                            <View style={styles.stepRow}>
                                <Avatar.Text size={28} label="2" style={{ backgroundColor: theme.colors.primary }} />
                                <View style={styles.stepContent}>
                                    <Text variant="bodyMedium" style={{ fontFamily: 'Inter_600SemiBold', color: theme.colors.onSurface }}>
                                        Meet the Sender
                                    </Text>
                                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                        Contact the sender and arrange handover
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.stepConnector} />

                            <View style={styles.stepRow}>
                                <Avatar.Text size={28} label="3" style={{ backgroundColor: theme.colors.primary }} />
                                <View style={styles.stepContent}>
                                    <Text variant="bodyMedium" style={{ fontFamily: 'Inter_600SemiBold', color: theme.colors.onSurface }}>
                                        Sender Retrieves Package
                                    </Text>
                                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                        The sender receives the Return OTP on their app to unlock
                                    </Text>
                                </View>
                            </View>
                        </Surface>

                        {/* Return Address Card */}
                        <Surface style={[styles.addressCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
                            <View style={styles.addressHeader}>
                                <MaterialCommunityIcons name="map-marker-radius" size={24} color={theme.colors.error} />
                                <View style={{ marginLeft: 12, flex: 1 }}>
                                    <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                        RETURN DESTINATION
                                    </Text>
                                    <Text variant="bodyMedium" style={{ fontFamily: 'Inter_600SemiBold', color: theme.colors.onSurface }}>
                                        {senderName}
                                    </Text>
                                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                                        {pickupAddress}
                                    </Text>
                                </View>
                            </View>
                        </Surface>
                    </>
                )}

            </ScrollView>

            {/* Bottom Actions */}
            <Surface style={[styles.bottomActions, { backgroundColor: theme.colors.surface, paddingBottom: Math.max(insets.bottom, 16) + 16 }]} elevation={4}>
                <Button
                    mode={isPickedUp ? "outlined" : "contained"}
                    onPress={handleDone}
                    style={{ flex: 1, marginRight: isPickedUp ? 8 : 0 }}
                    textColor={isPickedUp ? theme.colors.primary : undefined}
                >
                    Back to Dashboard
                </Button>
                {isPickedUp && (
                    <Button
                        mode="contained"
                        onPress={handleStartReturn}
                        style={{ flex: 1 }}
                        icon="navigation"
                    >
                        Start Navigation
                    </Button>
                )}
            </Surface>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 100,
    },
    headerCard: {
        padding: 24,
        borderRadius: 16,
        marginBottom: 16,
    },
    headerContent: {
        alignItems: 'center',
    },
    headerTitle: {
        fontFamily: 'Inter_700Bold',
        marginTop: 12,
        marginBottom: 8,
    },
    infoCard: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    otpCard: {
        padding: 20,
        borderRadius: 16,
        marginBottom: 16,
    },
    otpHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    otpDisplay: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        borderRadius: 12,
        marginBottom: 12,
    },
    copyButton: {
        position: 'absolute',
        right: 8,
    },
    validityBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        alignSelf: 'center',
    },
    stepsCard: {
        padding: 20,
        borderRadius: 16,
        marginBottom: 16,
    },
    stepRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    stepContent: {
        marginLeft: 16,
        flex: 1,
    },
    stepConnector: {
        width: 2,
        height: 24,
        backgroundColor: '#E0E0E0',
        marginLeft: 13,
        marginVertical: 4,
    },
    addressCard: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    addressHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    bottomActions: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        padding: 16,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
});
