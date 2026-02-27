/**
 * EC-32: Return Package Screen
 * 
 * Guides the rider through returning a cancelled package to the sender.
 * Shows navigation to pickup location and tracks return progress.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Alert, Linking, Platform } from 'react-native';
import { Text, Surface, Button, Card, Avatar, useTheme, IconButton, Chip, ProgressBar, Divider } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { markPackageRetrieved, subscribeToCancellation, CancellationState } from '../../services/cancellationService';

interface RouteParams {
    deliveryId: string;
    returnOtp: string;
    pickupAddress: string;
    senderName: string;
    pickupLat?: number;
    pickupLng?: number;
    boxId?: string;
}

type ReturnStep = 'NAVIGATING' | 'ARRIVED' | 'AWAITING_PICKUP' | 'COMPLETED';

export default function ReturnPackageScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute();
    const theme = useTheme();
    const params = route.params as RouteParams;

    const {
        deliveryId = 'TRK-XXXX-XXXX',
        returnOtp = '------',
        pickupAddress = 'Unknown Address',
        senderName = 'Sender',
        pickupLat = 14.5995,
        pickupLng = 120.9842,
        boxId = 'BOX_001',
    } = params || {};

    const [currentStep, setCurrentStep] = useState<ReturnStep>('NAVIGATING');
    const [distance, setDistance] = useState<string>('Calculating...');
    const [riderLocation, setRiderLocation] = useState<Location.LocationObject | null>(null);
    const [cancellationState, setCancellationState] = useState<CancellationState | null>(null);

    // Subscribe to cancellation state to detect when package is retrieved
    useEffect(() => {
        const unsubscribe = subscribeToCancellation(deliveryId, (state) => {
            setCancellationState(state);
            if (state?.packageRetrieved) {
                setCurrentStep('COMPLETED');
            }
        });

        return () => unsubscribe();
    }, [deliveryId]);

    // Get rider's location and calculate distance
    useEffect(() => {
        const fetchLocation = async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setDistance('Location unavailable');
                return;
            }

            const location = await Location.getCurrentPositionAsync({});
            setRiderLocation(location);

            // Calculate distance using Haversine
            const R = 6371; // Earth's radius in km
            const dLat = (pickupLat - location.coords.latitude) * Math.PI / 180;
            const dLon = (pickupLng - location.coords.longitude) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(location.coords.latitude * Math.PI / 180) *
                Math.cos(pickupLat * Math.PI / 180) *
                Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const d = R * c;

            setDistance(d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`);

            // Auto-detect arrival (within 100m)
            if (d < 0.1 && currentStep === 'NAVIGATING') {
                setCurrentStep('ARRIVED');
            }
        };

        fetchLocation();
        const interval = setInterval(fetchLocation, 10000); // Update every 10s
        return () => clearInterval(interval);
    }, [pickupLat, pickupLng, currentStep]);

    const openNavigation = () => {
        const url = Platform.select({
            ios: `maps://app?daddr=${pickupLat},${pickupLng}`,
            android: `google.navigation:q=${pickupLat},${pickupLng}`,
        });

        if (url) {
            Linking.canOpenURL(url).then((supported) => {
                if (supported) {
                    Linking.openURL(url);
                } else {
                    Alert.alert('Error', 'Unable to open navigation app');
                }
            });
        }
    };

    const handleArrived = () => {
        setCurrentStep('AWAITING_PICKUP');
    };

    const handleMarkComplete = async () => {
        Alert.alert(
            'Confirm Package Retrieved',
            'Has the sender successfully retrieved the package from the box?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Yes, Package Retrieved',
                    onPress: async () => {
                        const success = await markPackageRetrieved(deliveryId, boxId);
                        if (success) {
                            setCurrentStep('COMPLETED');
                        } else {
                            Alert.alert('Error', 'Failed to mark as retrieved. Please try again.');
                        }
                    },
                },
            ]
        );
    };

    const handleDone = () => {
        navigation.navigate('RiderDashboard');
    };

    const getStepProgress = (): number => {
        switch (currentStep) {
            case 'NAVIGATING': return 0.25;
            case 'ARRIVED': return 0.5;
            case 'AWAITING_PICKUP': return 0.75;
            case 'COMPLETED': return 1;
            default: return 0;
        }
    };

    const getStepColor = (step: ReturnStep): string => {
        const stepOrder = ['NAVIGATING', 'ARRIVED', 'AWAITING_PICKUP', 'COMPLETED'];
        const currentIndex = stepOrder.indexOf(currentStep);
        const stepIndex = stepOrder.indexOf(step);

        if (stepIndex < currentIndex) return theme.colors.primary;
        if (stepIndex === currentIndex) return theme.colors.primary;
        return theme.colors.outline;
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <ScrollView contentContainerStyle={styles.scrollContent}>

                {/* Progress Header */}
                <Surface style={[styles.progressCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                        RETURN PROGRESS
                    </Text>
                    <ProgressBar
                        progress={getStepProgress()}
                        color={theme.colors.primary}
                        style={{ height: 8, borderRadius: 4 }}
                    />
                    <View style={styles.progressLabels}>
                        <Text variant="labelSmall" style={{ color: getStepColor('NAVIGATING') }}>Navigate</Text>
                        <Text variant="labelSmall" style={{ color: getStepColor('ARRIVED') }}>Arrived</Text>
                        <Text variant="labelSmall" style={{ color: getStepColor('AWAITING_PICKUP') }}>Pickup</Text>
                        <Text variant="labelSmall" style={{ color: getStepColor('COMPLETED') }}>Done</Text>
                    </View>
                </Surface>

                {/* Current Status Card */}
                <Surface
                    style={[
                        styles.statusCard,
                        {
                            backgroundColor: currentStep === 'COMPLETED'
                                ? (theme.dark ? '#1B5E20' : '#E8F5E9')
                                : (theme.dark ? '#E65100' : '#FFF3E0'),
                        }
                    ]}
                    elevation={2}
                >
                    <MaterialCommunityIcons
                        name={currentStep === 'COMPLETED' ? 'check-circle' : 'backup-restore'}
                        size={48}
                        color={currentStep === 'COMPLETED' ? '#4CAF50' : '#FF9800'}
                    />
                    <View style={styles.statusContent}>
                        <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>
                            {currentStep === 'NAVIGATING' && 'Navigating to Pickup'}
                            {currentStep === 'ARRIVED' && 'Arrived at Pickup'}
                            {currentStep === 'AWAITING_PICKUP' && 'Awaiting Package Retrieval'}
                            {currentStep === 'COMPLETED' && 'Return Complete!'}
                        </Text>
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                            {currentStep === 'NAVIGATING' && `${distance} away • Head to return location`}
                            {currentStep === 'ARRIVED' && 'Contact the sender to arrange handover'}
                            {currentStep === 'AWAITING_PICKUP' && 'Sender receives a Return OTP on their app to unlock the box'}
                            {currentStep === 'COMPLETED' && 'Package has been returned successfully'}
                        </Text>
                    </View>
                </Surface>

                {/* Destination Card */}
                <Surface style={[styles.destinationCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <View style={styles.destinationHeader}>
                        <View style={[styles.markerIcon, { backgroundColor: theme.colors.errorContainer }]}>
                            <MaterialCommunityIcons name="map-marker" size={24} color={theme.colors.error} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                RETURN TO
                            </Text>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>
                                {senderName}
                            </Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                {pickupAddress}
                            </Text>
                        </View>
                        <Chip icon="map-marker-distance" compact>{distance}</Chip>
                    </View>

                    {currentStep === 'NAVIGATING' && (
                        <Button
                            mode="contained"
                            icon="navigation"
                            onPress={openNavigation}
                            style={{ marginTop: 16 }}
                        >
                            Open Navigation
                        </Button>
                    )}
                </Surface>



                {/* Tracking ID */}
                <Surface style={[styles.trackingCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <View style={styles.trackingRow}>
                        <MaterialCommunityIcons name="package-variant" size={20} color={theme.colors.primary} />
                        <Text variant="bodyMedium" style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant }}>
                            Tracking Number:
                        </Text>
                        <Text variant="bodyMedium" style={{ fontWeight: 'bold', marginLeft: 8, color: theme.colors.onSurface }}>
                            {deliveryId}
                        </Text>
                    </View>
                </Surface>

                {/* Completion Card */}
                {currentStep === 'COMPLETED' && (
                    <Surface style={[styles.completedCard, { backgroundColor: theme.dark ? '#1B5E20' : '#E8F5E9' }]} elevation={2}>
                        <MaterialCommunityIcons name="check-decagram" size={64} color="#4CAF50" />
                        <Text variant="headlineSmall" style={{ fontWeight: 'bold', marginTop: 16, color: theme.colors.onSurface }}>
                            Return Successful!
                        </Text>
                        <Text variant="bodyMedium" style={{ textAlign: 'center', marginTop: 8, color: theme.colors.onSurfaceVariant }}>
                            The package has been returned to the sender. Your job is complete.
                        </Text>
                    </Surface>
                )}

            </ScrollView>

            {/* Bottom Actions */}
            <Surface style={[styles.bottomActions, { backgroundColor: theme.colors.surface }]} elevation={4}>
                {currentStep === 'NAVIGATING' && (
                    <Button
                        mode="contained"
                        onPress={handleArrived}
                        style={{ flex: 1 }}
                        icon="map-marker-check"
                    >
                        I've Arrived
                    </Button>
                )}

                {currentStep === 'ARRIVED' && (
                    <Button
                        mode="contained"
                        onPress={handleArrived}
                        style={{ flex: 1 }}
                        icon="phone"
                        onPressIn={handleArrived}
                        onPressOut={() => setCurrentStep('AWAITING_PICKUP')}
                    >
                        Contact Sender & Wait
                    </Button>
                )}

                {currentStep === 'AWAITING_PICKUP' && (
                    <Button
                        mode="contained"
                        onPress={handleMarkComplete}
                        style={{ flex: 1 }}
                        buttonColor="#4CAF50"
                        icon="check-circle"
                    >
                        Package Retrieved
                    </Button>
                )}

                {currentStep === 'COMPLETED' && (
                    <Button
                        mode="contained"
                        onPress={handleDone}
                        style={{ flex: 1 }}
                        icon="home"
                    >
                        Back to Dashboard
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
    progressCard: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    progressLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 8,
    },
    statusCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
        borderRadius: 16,
        marginBottom: 16,
    },
    statusContent: {
        marginLeft: 16,
        flex: 1,
    },
    destinationCard: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    destinationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    markerIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    otpCard: {
        padding: 20,
        borderRadius: 16,
        marginBottom: 16,
        alignItems: 'center',
    },
    otpHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        marginBottom: 8,
    },
    otpDisplay: {
        paddingVertical: 20,
        paddingHorizontal: 32,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 8,
    },
    trackingCard: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    trackingRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    completedCard: {
        padding: 32,
        borderRadius: 16,
        alignItems: 'center',
        marginBottom: 16,
    },
    bottomActions: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        padding: 16,
        paddingBottom: 24,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
});
