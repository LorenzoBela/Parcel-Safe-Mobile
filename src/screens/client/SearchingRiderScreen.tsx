import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing, Alert } from 'react-native';
import { Text, Button, Surface, useTheme, ProgressBar } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
    createPendingBooking,
    notifyNearbyRiders,
    subscribeToBookingStatus,
    cancelBooking,
    BookingRequest,
    SEARCH_RADIUS_KM,
} from '../../services/riderMatchingService';
import { generateShareToken } from '../../utils/tokenUtils';
import {
    registerForPushNotifications,
    setupNotificationChannels,
    startOngoingNotification,
} from '../../services/pushNotificationService';
import useAuthStore from '../../store/authStore';

// 5 minutes in milliseconds - adjusted for reliability
const SEARCH_TIMEOUT_MS = 5 * 60 * 1000;

// Rotating status messages to show the app is actively looking
const STATUS_MESSAGES = [
    'Contacting nearby riders...',
    'Searching for available drivers...',
    'Checking rider availability...',
    'Looking for the best match...',
    `Scanning ${SEARCH_RADIUS_KM}km radius...`,
    'Still searching for riders...',
    'Hang tight! Almost there...',
    'Searching in your area...',
];

// Generate a unique booking ID
const generateBookingId = () => `BK_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export default function SearchingRiderScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const theme = useTheme();
    const [statusText, setStatusText] = useState(STATUS_MESSAGES[0]);
    const [searchFailed, setSearchFailed] = useState(false);
    const [progress, setProgress] = useState(0);
    const [bookingId] = useState(generateBookingId());
    const [shareToken] = useState(generateShareToken());
    const [notifiedRidersCount, setNotifiedRidersCount] = useState(0);
    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;

    // Animation constants
    const pulseAnim = useRef(new Animated.Value(0)).current;
    const progressAnim = useRef(new Animated.Value(0)).current;
    const statusIndex = useRef(0);

    // Booking details passed from previous screen
    const {
        pickup,
        dropoff,
        pickupLat = 14.5995, // Default Manila coords for demo
        pickupLng = 120.9842,
        dropoffLat = 14.5831,
        dropoffLng = 120.9794,
        estimatedFare,
        estimatedCost,
    } = route.params || {};

    useEffect(() => {
        console.log('[SearchingRider] Received params:', route.params);
        console.log('[SearchingRider] Estimated Fare:', estimatedFare);
        console.log('[SearchingRider] Estimated Cost:', estimatedCost);
    }, []);

    useEffect(() => {
        if (searchFailed) return; // Stop if search has failed

        // Start Pulse Animation
        const startPulseAnimation = () => {
            pulseAnim.setValue(0);
            Animated.loop(
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 2000,
                    easing: Easing.out(Easing.ease),
                    useNativeDriver: true,
                })
            ).start();
        };

        startPulseAnimation();

        // Animate progress bar slowly over 5 minutes
        Animated.timing(progressAnim, {
            toValue: 1,
            duration: SEARCH_TIMEOUT_MS,
            easing: Easing.linear,
            useNativeDriver: false,
        }).start();

        // Update progress state for ProgressBar component
        const progressInterval = setInterval(() => {
            setProgress((prev) => {
                const newProgress = prev + (1 / (SEARCH_TIMEOUT_MS / 1000));
                return Math.min(newProgress, 1);
            });
        }, 1000);

        // Rotate status messages every 8 seconds to show activity
        const statusInterval = setInterval(() => {
            statusIndex.current = (statusIndex.current + 1) % STATUS_MESSAGES.length;
            setStatusText(STATUS_MESSAGES[statusIndex.current]);
        }, 8000);

        // Setup push notifications for the customer
        const initNotifications = async () => {
            await setupNotificationChannels();
            await registerForPushNotifications();
        };
        initNotifications();

        // Create booking and notify nearby riders
        const createBookingAndNotify = async () => {
            if (!authedUserId) {
                setSearchFailed(true);
                setStatusText('Please log in again to continue booking');
                return;
            }

            const bookingRequest: BookingRequest = {
                bookingId,
                customerId: authedUserId,
                pickupLat,
                pickupLng,
                pickupAddress: pickup || 'Pickup Location',
                dropoffLat,
                dropoffLng,
                dropoffAddress: dropoff || 'Dropoff Location',
                estimatedFare: estimatedFare ?? estimatedCost ?? 0,
                createdAt: Date.now(),
                shareToken,
            };

            // Create the booking in Firebase
            await createPendingBooking(bookingRequest);

            // Notify riders within 3km radius
            const result = await notifyNearbyRiders(bookingRequest);
            setNotifiedRidersCount(result.notifiedCount);

            if (result.notifiedCount === 0) {
                // No riders available within 3km
                setStatusText('No riders available nearby. Expanding search...');
            }
        };
        createBookingAndNotify();

        // Subscribe to booking status for when a rider accepts
        const unsubscribeStatus = subscribeToBookingStatus(bookingId, async (status, riderId) => {
            if (status === 'ACCEPTED' && riderId) {
                // Rider accepted! Navigate to tracking
                setStatusText('Rider found! Connecting...');

                // Start ongoing notification for tracking
                await startOngoingNotification(bookingId, 'RIDER_ASSIGNED');

                // Small delay for UX, then navigate
                setTimeout(() => {
                    navigation.replace('TrackOrder', {
                        bookingId,
                        riderId,
                        pickup,
                        dropoff,
                        pickupLat,
                        pickupLng,
                        dropoffLat,
                        dropoffLng,
                        shareToken,
                    });
                }, 1500);
            }
        });

        // 5 minute timeout - if no rider found, show failure state
        const timeoutTimer = setTimeout(() => {
            setSearchFailed(true);
            setStatusText("We couldn't find a rider at this time");
            progressAnim.stopAnimation();
            cancelBooking(bookingId); // Cancel the pending booking
        }, SEARCH_TIMEOUT_MS);

        return () => {
            clearInterval(progressInterval);
            clearInterval(statusInterval);
            clearTimeout(timeoutTimer);
            progressAnim.stopAnimation();
            unsubscribeStatus();
        };
    }, [searchFailed, authedUserId, estimatedCost, estimatedFare, shareToken]);

    const handleCancel = () => {
        Alert.alert(
            'Cancel Booking',
            'Are you sure you want to cancel?',
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Yes',
                    style: 'destructive',
                    onPress: () => navigation.goBack()
                },
            ]
        );
    };

    const handleRetry = () => {
        // Reset state and restart the search
        setSearchFailed(false);
        setProgress(0);
        setStatusText(STATUS_MESSAGES[0]);
        statusIndex.current = 0;
        progressAnim.setValue(0);
    };

    return (
        <View style={styles.container}>
            <View style={styles.content}>

                {/* Radar/Pulse Animation Container */}
                <View style={styles.radarContainer}>
                    {/* Multiple expanding circles for radar effect */}
                    {!searchFailed && [0, 1, 2].map((i) => {
                        const opacity = pulseAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.6, 0],
                        });

                        const scale = pulseAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 2 + i * 0.5], // Staggered expansion
                        });

                        return (
                            <Animated.View
                                key={i}
                                style={[
                                    styles.pulseCircle,
                                    {
                                        borderColor: theme.colors.primary,
                                        opacity,
                                        transform: [{ scale }],
                                    },
                                ]}
                            />
                        );
                    })}

                    <Surface style={[styles.centerIcon, searchFailed && { backgroundColor: '#fff0f0' }]} elevation={4}>
                        <MaterialCommunityIcons
                            name={searchFailed ? "moped-outline" : "moped"}
                            size={40}
                            color={searchFailed ? theme.colors.error : theme.colors.primary}
                        />
                    </Surface>
                </View>

                <Text variant="headlineSmall" style={[styles.statusTitle, { color: searchFailed ? theme.colors.error : theme.colors.primary }]}>
                    {searchFailed ? 'No Riders Available' : 'Searching for Riders'}
                </Text>
                <Text variant="bodyMedium" style={styles.statusSubtitle}>
                    {statusText}
                </Text>

                {/* Progress Bar - shows search is active without displaying a timer */}
                {!searchFailed && (
                    <View style={styles.progressContainer}>
                        <ProgressBar
                            progress={progress}
                            color={theme.colors.primary}
                            style={styles.progressBar}
                        />
                        <Text variant="bodySmall" style={styles.progressHint}>
                            Searching in your area...
                        </Text>
                    </View>
                )}

                {/* Failure message with helpful info */}
                {searchFailed && (
                    <View style={styles.failureMessage}>
                        <Text variant="bodyMedium" style={styles.failureText}>
                            All riders in your area are currently busy. Please try again in a few moments.
                        </Text>
                    </View>
                )}

                <View style={styles.locationSummary}>
                    <View style={styles.row}>
                        <MaterialCommunityIcons name="circle-slice-8" size={16} color="green" />
                        <Text style={styles.locationText} numberOfLines={1}>{pickup || 'Pickup Location'}</Text>
                    </View>
                    <View style={[styles.verticalLine, { backgroundColor: '#ddd' }]} />
                    <View style={styles.row}>
                        <MaterialCommunityIcons name="map-marker" size={16} color="red" />
                        <Text style={styles.locationText} numberOfLines={1}>{dropoff || 'Dropoff Location'}</Text>
                    </View>
                </View>

            </View>

            <View style={styles.footer}>
                {searchFailed ? (
                    <View style={styles.footerButtons}>
                        <Button
                            mode="contained"
                            onPress={handleRetry}
                            style={styles.retryButton}
                        >
                            Try Again
                        </Button>
                        <Button
                            mode="outlined"
                            onPress={() => navigation.goBack()}
                            textColor={theme.colors.onSurface}
                            style={styles.goBackButton}
                        >
                            Go Back
                        </Button>
                    </View>
                ) : (
                    <Button
                        mode="contained-tonal"
                        onPress={handleCancel}
                        textColor={theme.colors.error}
                        style={styles.cancelButton}
                    >
                        Cancel Search
                    </Button>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    radarContainer: {
        width: 200,
        height: 200,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 40,
    },
    pulseCircle: {
        position: 'absolute',
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: 2,
    },
    centerIcon: {
        width: 80,
        height: 80,
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'white',
        zIndex: 10,
    },
    statusTitle: {
        fontWeight: 'bold',
        marginBottom: 8,
        textAlign: 'center',
    },
    statusSubtitle: {
        color: '#666',
        marginBottom: 24,
        textAlign: 'center',
    },
    progressContainer: {
        width: '100%',
        marginBottom: 24,
        paddingHorizontal: 16,
    },
    progressBar: {
        height: 6,
        borderRadius: 3,
    },
    progressHint: {
        textAlign: 'center',
        color: '#888',
        marginTop: 8,
    },
    failureMessage: {
        width: '100%',
        padding: 16,
        backgroundColor: '#fff5f5',
        borderRadius: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#ffdddd',
    },
    failureText: {
        textAlign: 'center',
        color: '#666',
    },
    locationSummary: {
        width: '100%',
        padding: 16,
        backgroundColor: '#f9f9f9',
        borderRadius: 12,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
    },
    locationText: {
        marginLeft: 12,
        color: '#444',
        flex: 1,
    },
    verticalLine: {
        width: 2,
        height: 16,
        marginLeft: 7,
        marginVertical: 2,
    },
    footer: {
        padding: 24,
        paddingBottom: 40,
    },
    footerButtons: {
        gap: 12,
    },
    retryButton: {
        marginBottom: 0,
    },
    goBackButton: {
        borderColor: '#ddd',
    },
    cancelButton: {
        borderColor: '#ffdddd',
    },
});
