/**
 * IncomingOrderModal Component
 * 
 * Displays incoming order details to riders with Accept/Reject options.
 * Auto-dismisses after the request expires.
 */

import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, Vibration, Modal as RNModal } from 'react-native';
import { Text, Button, Surface, useTheme, IconButton, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RiderOrderRequest } from '../services/riderMatchingService';

interface IncomingOrderModalProps {
    visible: boolean;
    request: RiderOrderRequest | null;
    requestId: string;
    onAccept: () => void;
    onReject: () => void;
    onExpire: () => void;
}

export default function IncomingOrderModal({
    visible,
    request,
    requestId,
    onAccept,
    onReject,
    onExpire,
}: IncomingOrderModalProps) {
    const theme = useTheme();
    const [timeLeft, setTimeLeft] = useState(30);
    const slideAnim = useRef(new Animated.Value(-300)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;

    // Handle visibility animation
    useEffect(() => {
        if (visible && request) {
            // Calculate initial time left
            const remaining = Math.max(0, Math.floor((request.expiresAt - Date.now()) / 1000));
            setTimeLeft(remaining);

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
    }, [visible, request]);

    // Countdown timer
    useEffect(() => {
        if (!visible || !request) return;

        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    onExpire();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [visible, request, onExpire]);

    if (!request) return null;

    const formatCurrency = (amount: number) => `₱${amount.toFixed(2)}`;

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
                <Surface style={styles.card} elevation={5}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.headerLeft}>
                            <MaterialCommunityIcons
                                name="package-variant"
                                size={28}
                                color={theme.colors.primary}
                            />
                            <View style={styles.headerText}>
                                <Text variant="titleMedium" style={styles.title}>
                                    New Order Request
                                </Text>
                                <Text variant="bodySmall" style={styles.timer}>
                                    {timeLeft}s remaining
                                </Text>
                            </View>
                        </View>
                        <IconButton
                            icon="close"
                            size={20}
                            onPress={onReject}
                            style={styles.closeButton}
                        />
                    </View>

                    {/* Timer Progress Bar */}
                    <View style={styles.timerBar}>
                        <View
                            style={[
                                styles.timerProgress,
                                {
                                    width: `${(timeLeft / 30) * 100}%`,
                                    backgroundColor: timeLeft <= 10 ? '#F44336' : theme.colors.primary,
                                },
                            ]}
                        />
                    </View>

                    <Divider style={styles.divider} />

                    {/* Order Details */}
                    <View style={styles.details}>
                        {/* Pickup */}
                        <View style={styles.locationRow}>
                            <View style={[styles.locationIcon, { backgroundColor: '#E8F5E9' }]}>
                                <MaterialCommunityIcons name="circle-slice-8" size={16} color="#4CAF50" />
                            </View>
                            <View style={styles.locationInfo}>
                                <Text variant="labelSmall" style={styles.locationLabel}>PICKUP</Text>
                                <Text variant="bodyMedium" numberOfLines={2} style={styles.address}>
                                    {request.pickupAddress}
                                </Text>
                            </View>
                        </View>

                        {/* Vertical connector */}
                        <View style={styles.connector}>
                            <View style={styles.connectorLine} />
                        </View>

                        {/* Dropoff */}
                        <View style={styles.locationRow}>
                            <View style={[styles.locationIcon, { backgroundColor: '#FFEBEE' }]}>
                                <MaterialCommunityIcons name="map-marker" size={16} color="#F44336" />
                            </View>
                            <View style={styles.locationInfo}>
                                <Text variant="labelSmall" style={styles.locationLabel}>DROPOFF</Text>
                                <Text variant="bodyMedium" numberOfLines={2} style={styles.address}>
                                    {request.dropoffAddress}
                                </Text>
                            </View>
                        </View>
                    </View>

                    <Divider style={styles.divider} />

                    {/* Fare and Distance */}
                    <View style={styles.infoRow}>
                        <View style={styles.infoItem}>
                            <MaterialCommunityIcons name="map-marker-distance" size={20} color="#666" />
                            <Text variant="bodyMedium" style={styles.infoText}>
                                {request.distanceToPickupKm.toFixed(1)} km away
                            </Text>
                        </View>
                        <View style={styles.fareContainer}>
                            <Text variant="labelSmall" style={styles.fareLabel}>ESTIMATED FARE</Text>
                            <Text variant="headlineSmall" style={[styles.fare, { color: theme.colors.primary }]}>
                                {formatCurrency(request.estimatedFare)}
                            </Text>
                        </View>
                    </View>

                    {/* Action Buttons */}
                    <View style={styles.actions}>
                        <Button
                            mode="outlined"
                            onPress={onReject}
                            style={[styles.button, styles.rejectButton]}
                            textColor="#F44336"
                            icon="close"
                        >
                            Reject
                        </Button>
                        <Button
                            mode="contained"
                            onPress={onAccept}
                            style={[styles.button, styles.acceptButton]}
                            buttonColor="#4CAF50"
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
    },
    headerText: {
        marginLeft: 12,
    },
    title: {
        fontWeight: 'bold',
    },
    timer: {
        color: '#F44336',
        fontWeight: '600',
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
        fontWeight: '600',
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
        fontWeight: 'bold',
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
