/**
 * IncomingOrderModal Component
 *
 * Displays incoming order details to riders with Accept/Reject options.
 * Handles multiple stacked requests with navigation.
 */

import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, Vibration, Modal as RNModal } from 'react-native';
import { Text, Button, Surface, useTheme, IconButton, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RiderOrderRequest } from '../services/riderMatchingService';

interface IncomingOrderModalProps {
    visible: boolean;
    requests: Array<{ requestId: string; data: RiderOrderRequest }>;
    onAccept: (request: { requestId: string; data: RiderOrderRequest }) => void;
    onReject: (requestId: string) => void;
}

export default function IncomingOrderModal({
    visible,
    requests,
    onAccept,
    onReject,
}: IncomingOrderModalProps) {
    const theme = useTheme();
    const [currentIndex, setCurrentIndex] = useState(0);
    const [timeLeft, setTimeLeft] = useState(15);
    const slideAnim = useRef(new Animated.Value(-300)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;

    const currentRequestWrapper = requests[currentIndex];
    const currentRequest = currentRequestWrapper?.data;

    // Reset index if out of bounds (e.g. when a request is removed)
    useEffect(() => {
        if (currentIndex >= requests.length && requests.length > 0) {
            setCurrentIndex(Math.max(0, requests.length - 1));
        }
    }, [requests.length, currentIndex]);

    // Handle visibility animation
    useEffect(() => {
        if (visible && requests.length > 0) {
            // Slide in animation
            Animated.spring(slideAnim, {
                toValue: 0,
                useNativeDriver: true,
                tension: 50,
                friction: 8,
            }).start();

            // Vibrate to alert rider
            Vibration.vibrate([0, 500, 200, 500]);

            // Start pulse animation
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.05,
                        duration: 500,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 500,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            // Slide out animation
            Animated.timing(slideAnim, {
                toValue: -300,
                duration: 200,
                useNativeDriver: true,
            }).start();
        }
    }, [visible, requests.length > 0]);

    // Countdown timer for current request
    useEffect(() => {
        if (!visible || !currentRequest) return;

        // Calculate initial time
        const updateTimer = () => {
            const remaining = Math.max(0, Math.floor((currentRequest.expiresAt - Date.now()) / 1000));
            setTimeLeft(remaining);
            if (remaining <= 0) {
                // Auto-reject when timer expires
                onReject(currentRequestWrapper.requestId);
            }
        };

        updateTimer();
        const timer = setInterval(updateTimer, 1000);

        return () => clearInterval(timer);
    }, [visible, currentRequest?.bookingId, currentRequest?.expiresAt]);

    if (!currentRequestWrapper || !currentRequest) return null;

    const formatCurrency = (amount: number) => `₱${amount.toFixed(2)}`;

    const handleNext = () => {
        if (currentIndex < requests.length - 1) {
            setCurrentIndex(currentIndex + 1);
        }
    };

    const handlePrev = () => {
        if (currentIndex > 0) {
            setCurrentIndex(currentIndex - 1);
        }
    };

    return (
        <Animated.View
            style={[
                styles.container,
                {
                    transform: [{ translateY: slideAnim }],
                },
            ]}
            pointerEvents={visible ? 'auto' : 'none'}
        >
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <Surface style={[styles.card, { backgroundColor: theme.colors.elevation.level3 }]} elevation={5}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.headerLeft}>
                            <MaterialCommunityIcons
                                name="package-variant"
                                size={28}
                                color={theme.colors.primary}
                            />
                            <View style={styles.headerText}>
                                <Text variant="titleMedium" style={[styles.title, { color: theme.colors.onSurface }]}>
                                    New Order Request ({currentIndex + 1}/{requests.length})
                                </Text>
                                <Text variant="bodySmall" style={[styles.timer, { color: theme.colors.error }]}>
                                    {timeLeft}s remaining
                                </Text>
                            </View>
                        </View>

                        {/* Navigation Buttons for Multiple Requests */}
                        {requests.length > 1 && (
                            <View style={styles.navigation}>
                                <IconButton
                                    icon="chevron-left"
                                    size={24}
                                    onPress={handlePrev}
                                    disabled={currentIndex === 0}
                                />
                                <IconButton
                                    icon="chevron-right"
                                    size={24}
                                    onPress={handleNext}
                                    disabled={currentIndex === requests.length - 1}
                                />
                            </View>
                        )}

                        {/* <IconButton
                            icon="close"
                            size={20}
                            onPress={() => onReject(currentRequestWrapper.requestId)}
                            style={styles.closeButton}
                        /> */}
                    </View>

                    <View style={[styles.timerBar, { backgroundColor: theme.colors.surfaceVariant }]}>
                        <View
                            style={[
                                styles.timerProgress,
                                {
                                    width: `${(timeLeft / 15) * 100}%`,
                                    backgroundColor: timeLeft <= 5 ? theme.colors.error : theme.colors.primary,
                                },
                            ]}
                        />
                    </View>

                    <Divider style={styles.divider} />

                    {/* Order Details */}
                    <View style={styles.details}>
                        {/* Pickup */}
                        <View style={styles.locationRow}>
                            <View style={[styles.locationIcon, { backgroundColor: theme.colors.primaryContainer }]}>
                                <MaterialCommunityIcons name="circle-slice-8" size={16} color={theme.colors.primary} />
                            </View>
                            <View style={styles.locationInfo}>
                                <Text variant="labelSmall" style={[styles.locationLabel, { color: theme.colors.outline }]}>PICKUP</Text>
                                <Text variant="bodyMedium" numberOfLines={2} style={[styles.address, { color: theme.colors.onSurface }]}>
                                    {currentRequest.pickupAddress}
                                </Text>
                            </View>
                        </View>

                        {/* Vertical connector */}
                        <View style={styles.connector}>
                            <View style={[styles.connectorLine, { backgroundColor: theme.colors.outlineVariant }]} />
                        </View>

                        {/* Dropoff */}
                        <View style={styles.locationRow}>
                            <View style={[styles.locationIcon, { backgroundColor: theme.colors.errorContainer }]}>
                                <MaterialCommunityIcons name="map-marker" size={16} color={theme.colors.error} />
                            </View>
                            <View style={styles.locationInfo}>
                                <Text variant="labelSmall" style={[styles.locationLabel, { color: theme.colors.outline }]}>DROPOFF</Text>
                                <Text variant="bodyMedium" numberOfLines={2} style={[styles.address, { color: theme.colors.onSurface }]}>
                                    {currentRequest.dropoffAddress}
                                </Text>
                            </View>
                        </View>
                    </View>

                    <Divider style={styles.divider} />

                    {/* Fare and Distance */}
                    <View style={styles.infoRow}>
                        <View style={styles.infoItem}>
                            <MaterialCommunityIcons name="map-marker-distance" size={20} color={theme.colors.outline} />
                            <Text variant="bodyMedium" style={[styles.infoText, { color: theme.colors.outline }]}>
                                {currentRequest.distanceToPickupKm.toFixed(1)} km away
                            </Text>
                        </View>
                        <View style={styles.fareContainer}>
                            <Text variant="labelSmall" style={[styles.fareLabel, { color: theme.colors.outline }]}>ESTIMATED FARE</Text>
                            <Text variant="headlineSmall" style={[styles.fare, { color: theme.colors.primary }]}>
                                {formatCurrency(currentRequest.estimatedFare)}
                            </Text>
                        </View>
                    </View>

                    {/* Action Buttons */}
                    <View style={styles.actions}>
                        <Button
                            mode="outlined"
                            onPress={() => onReject(currentRequestWrapper.requestId)}
                            style={[styles.button, styles.rejectButton, { borderColor: theme.colors.error }]}
                            textColor={theme.colors.error}
                            icon="close"
                        >
                            Reject
                        </Button>
                        <Button
                            mode="contained"
                            onPress={() => onAccept(currentRequestWrapper)}
                            style={[styles.button, styles.acceptButton, { backgroundColor: theme.colors.primary }]}
                            textColor={theme.colors.onPrimary}
                            icon="check"
                        >
                            Accept
                        </Button>
                    </View>
                </Surface>
            </Animated.View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        padding: 16,
        paddingTop: 50, // Account for status bar
    },
    card: {
        borderRadius: 16,
        backgroundColor: '#fff',
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        paddingBottom: 12,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    headerText: {
        marginLeft: 12,
    },
    title: {
        fontFamily: 'Inter_700Bold',
    },
    timer: {
        color: '#F44336',
        fontFamily: 'Inter_600SemiBold',
    },
    navigation: {
        flexDirection: 'row',
    },
    closeButton: {
        margin: -8,
    },
    timerBar: {
        height: 4,
        backgroundColor: '#E0E0E0',
        marginHorizontal: 16,
        borderRadius: 2,
        overflow: 'hidden',
        marginTop: 4,
    },
    timerProgress: {
        height: '100%',
        borderRadius: 2,
    },
    divider: {
        marginVertical: 12,
    },
    details: {
        paddingHorizontal: 16,
    },
    locationRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    locationIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    locationInfo: {
        flex: 1,
        marginLeft: 12,
    },
    locationLabel: {
        color: '#888',
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: 0.5,
    },
    address: {
        color: '#333',
        marginTop: 2,
    },
    connector: {
        paddingLeft: 16,
        paddingVertical: 4,
    },
    connectorLine: {
        width: 2,
        height: 20,
        backgroundColor: '#E0E0E0',
        marginLeft: -1,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    infoItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    infoText: {
        marginLeft: 8,
        color: '#666',
    },
    fareContainer: {
        alignItems: 'flex-end',
    },
    fareLabel: {
        color: '#888',
        fontSize: 10,
    },
    fare: {
        fontFamily: 'Inter_700Bold',
    },
    actions: {
        flexDirection: 'row',
        padding: 16,
        paddingTop: 8,
        gap: 12,
    },
    button: {
        flex: 1,
        borderRadius: 12,
    },
    rejectButton: {
        borderColor: '#F44336',
    },
    acceptButton: {},
});
