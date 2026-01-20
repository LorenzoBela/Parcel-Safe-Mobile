import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, ScrollView, Switch, ImageBackground, Alert, RefreshControl, TouchableOpacity, Dimensions } from 'react-native';
import { Text, Card, Button, Avatar, ProgressBar, MD3Colors, Surface, Chip, useTheme, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import LottieView from 'lottie-react-native';
import { useLocationRedundancy, getStatusMessage, getStatusColor } from '../../hooks/useLocationRedundancy';
import { subscribeToBattery, BatteryState, subscribeToTamper, TamperState, subscribeToLocation, LocationData, subscribeToKeypad, KeypadState, subscribeToHinge, HingeState } from '../../services/firebaseClient';
import { offlineCache, PendingSync } from '../../services/offlineCache';
import { isSpeedAnomaly, isClockSyncRequired, canAddToPhotoQueue, isGpsStale, SAFETY_CONSTANTS } from '../../services/SafetyLogic';
import RecallService from '../../services/recallService';
import NetInfo from '@react-native-community/netinfo';
import IncomingOrderModal from '../../components/IncomingOrderModal';
import {
    subscribeToRiderRequests,
    acceptOrder,
    rejectOrder,
    updateRiderStatus,
    removeRiderFromOnline,
    RiderOrderRequest
} from '../../services/riderMatchingService';
import {
    registerForPushNotifications,
    setupNotificationChannels,
    showIncomingOrderNotification,
    addNotificationReceivedListener,
} from '../../services/pushNotificationService';

export default function RiderDashboard() {
    const navigation = useNavigation<any>();
    const theme = useTheme();
    const [isOnline, setIsOnline] = useState(true);
    const [currentTime, setCurrentTime] = useState(dayjs());
    const [locationName, setLocationName] = useState('Locating...');
    const [refreshing, setRefreshing] = useState(false);
    const [riderLocation, setRiderLocation] = useState<Location.LocationObject | null>(null);
    const [distance, setDistance] = useState<string>('Calculating...');
    const [isLocked, setIsLocked] = useState(true);
    const [logs, setLogs] = useState<{ time: string; message: string; type: string }[]>([]);
    const mapRef = useRef<MapView>(null);
    const animationRef = useRef<LottieView>(null);

    // EC-03: Battery Monitoring
    const [batteryState, setBatteryState] = useState<BatteryState | null>(null);

    // EC-18: Tamper Detection
    const [tamperState, setTamperState] = useState<TamperState | null>(null);

    // EC-82: Keypad State
    const [keypadState, setKeypadState] = useState<KeypadState | null>(null);

    // EC-83: Hinge State
    const [hingeState, setHingeState] = useState<HingeState | null>(null);

    // EC-01/EC-06: Offline Mode & Sync Status
    const [isOffline, setIsOffline] = useState(false);
    const [pendingSyncs, setPendingSyncs] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);

    // EC-08: GPS Spoofing Detection
    const [gpsSpoofWarning, setGpsSpoofWarning] = useState(false);
    const [lastGpsLocation, setLastGpsLocation] = useState<LocationData | null>(null);

    // EC-46: Clock Skew Warning
    const [clockSkewWarning, setClockSkewWarning] = useState(false);

    // EC-10: Photo Queue Status
    const [photoQueueCount, setPhotoQueueCount] = useState(0);
    const [photoQueueFull, setPhotoQueueFull] = useState(false);

    // GPS Redundancy Hook - monitors box connectivity and handles failover
    const {
        source: gpsSource,
        isBoxOnline,
        phoneGpsActive,
        startMonitoring,
        activateTracking,
        deactivateTracking,
        gpsHealth // EC-84
    } = useLocationRedundancy();

    // EC-85: Recall State
    const [recallState, setRecallState] = useState<{ isRecalled: boolean; returnOtp: string | null }>({ isRecalled: false, returnOtp: null });

    // Incoming Order State (for rider matching)
    const [incomingRequest, setIncomingRequest] = useState<{ requestId: string; data: RiderOrderRequest } | null>(null);
    const [showOrderModal, setShowOrderModal] = useState(false);
    const [riderId] = useState('RIDER_001'); // Demo rider ID - in production, get from auth
    const [pushToken, setPushToken] = useState<string | null>(null);

    // Auto-start monitoring when component mounts (demo box ID)
    useEffect(() => {
        startMonitoring('BOX_001');

        // EC-85: Listen for recall
        // In a real app, 'TRK-8821-9023' would be dynamic
        RecallService.listenForRecall('TRK-8821-9023', (isRecalled, returnOtp) => {
            setRecallState({ isRecalled, returnOtp });
            if (isRecalled) {
                Alert.alert(
                    '⚠️ PACKAGE RECALLED',
                    'The sender has recalled this package. Please return it to the pickup point immediately.',
                    [{ text: 'Routing to Sender' }]
                );
            }
        });

        // EC-03: Subscribe to battery state
        const unsubscribeBattery = subscribeToBattery('BOX_001', (state) => {
            setBatteryState(state);

            // Show alert on low battery
            if (state?.lowBatteryWarning && !state?.criticalBatteryWarning) {
                Alert.alert(
                    'Low Battery Warning',
                    `Box battery is at ${state.percentage}%. Consider completing current delivery soon.`,
                    [{ text: 'OK' }]
                );
            } else if (state?.criticalBatteryWarning) {
                Alert.alert(
                    '⚠️ Critical Battery',
                    `Box battery is critically low at ${state.percentage}%! Delivery may fail if battery dies.`,
                    [{ text: 'Understood' }]
                );
            }
        });

        // EC-18: Subscribe to tamper state
        const unsubscribeTamper = subscribeToTamper('BOX_001', (state) => {
            setTamperState(state);

            // Show critical alert on tamper detection
            if (state?.detected) {
                Alert.alert(
                    '🚨 SECURITY ALERT',
                    'Unauthorized access detected on your assigned box! The box is now in lockdown mode. Contact support immediately.',
                    [{ text: 'Contact Support', style: 'destructive' }]
                );
            }
        });

        // EC-01/EC-06: Monitor network connectivity
        const unsubscribeNetInfo = NetInfo.addEventListener(state => {
            setIsOffline(!state.isConnected);
        });

        // EC-08: Subscribe to GPS location for spoofing detection
        const unsubscribeLocation = subscribeToLocation('BOX_001', (location) => {
            if (location && lastGpsLocation) {
                // Calculate distance using Haversine approximation
                const R = 6371000;
                const dLat = (location.latitude - lastGpsLocation.latitude) * Math.PI / 180;
                const dLon = (location.longitude - lastGpsLocation.longitude) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lastGpsLocation.latitude * Math.PI / 180) * Math.cos(location.latitude * Math.PI / 180) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const distanceMeters = R * c;

                const timeDelta = (location.timestamp - lastGpsLocation.timestamp) / 1000;
                if (timeDelta > 0 && isSpeedAnomaly(distanceMeters, timeDelta)) {
                    setGpsSpoofWarning(true);
                    Alert.alert(
                        '⚠️ GPS Anomaly Detected',
                        'Unusual location jump detected. This may indicate GPS issues or spoofing.',
                        [{ text: 'Dismiss', onPress: () => setGpsSpoofWarning(false) }]
                    );
                }

                // EC-46: Check for clock skew
                if (location.server_timestamp && isClockSyncRequired(location.server_timestamp)) {
                    setClockSkewWarning(true);
                }
            }
            setLastGpsLocation(location);
        });

        // EC-82: Subscribe to Keypad
        const unsubscribeKeypad = subscribeToKeypad('BOX_001', (state) => {
            setKeypadState(state);
            if (state?.is_stuck) {
                Alert.alert(
                    '⚠️ Keypad Malfunction',
                    `Key '${state.stuck_key}' is stuck! You may need to use App Unlock for OTP.`,
                    [{ text: 'OK' }]
                );
            }
        });

        // EC-83: Subscribe to Hinge
        const unsubscribeHinge = subscribeToHinge('BOX_001', (state) => {
            setHingeState(state);
            if (state?.status === 'DAMAGED') {
                Alert.alert(
                    '🚨 PHYSICAL DAMAGE DETECTED',
                    'Door sensor mismatch detected while locked. Inspect box immediately!',
                    [{ text: 'Contact Support', style: 'destructive' }]
                );
            }
        });

        return () => {
            deactivateTracking();
            unsubscribeBattery();
            unsubscribeTamper();
            unsubscribeNetInfo();
            unsubscribeLocation();
            unsubscribeKeypad();
            unsubscribeHinge();
        };
    }, [lastGpsLocation]);

    // EC-01/EC-06: Check for pending syncs periodically
    useEffect(() => {
        const checkSyncStatus = async () => {
            const status = await offlineCache.getSyncStatus();
            setPendingSyncs(status.pendingCount);
            setPhotoQueueCount(status.pendingCount);
            setPhotoQueueFull(!canAddToPhotoQueue(status.pendingCount));
        };

        checkSyncStatus();
        const interval = setInterval(checkSyncStatus, 10000); // Check every 10 seconds
        return () => clearInterval(interval);
    }, []);

    // Subscribe to incoming order requests when rider is online
    useEffect(() => {
        if (!isOnline) {
            // Remove from online riders when going offline
            removeRiderFromOnline(riderId);
            return;
        }

        // Setup push notifications
        const initNotifications = async () => {
            await setupNotificationChannels();
            const token = await registerForPushNotifications();
            if (token) {
                setPushToken(token);
            }
        };
        initNotifications();

        // Update rider status as online with current location
        const updateLocation = async () => {
            if (riderLocation) {
                await updateRiderStatus(
                    riderId,
                    riderLocation.coords.latitude,
                    riderLocation.coords.longitude,
                    true,
                    pushToken || undefined
                );
            }
        };
        updateLocation();

        // Subscribe to incoming order requests
        const unsubscribeRequests = subscribeToRiderRequests(riderId, (requests) => {
            if (requests.length > 0) {
                // Show the first pending request
                const latestRequest = requests[0];
                setIncomingRequest(latestRequest);
                setShowOrderModal(true);

                // Show local notification
                showIncomingOrderNotification(
                    latestRequest.data.pickupAddress,
                    latestRequest.data.dropoffAddress,
                    latestRequest.data.estimatedFare,
                    latestRequest.data.bookingId
                );
            } else {
                setIncomingRequest(null);
                setShowOrderModal(false);
            }
        });

        // Listen for notifications while app is in foreground
        const notificationListener = addNotificationReceivedListener((notification) => {
            const data = notification.request.content.data;
            if (data?.type === 'INCOMING_ORDER') {
                // Notification handled by Firebase subscription above
            }
        });

        return () => {
            unsubscribeRequests();
            notificationListener.remove();
            removeRiderFromOnline(riderId);
        };
    }, [isOnline, riderLocation, riderId, pushToken]);

    // Handle accepting an order
    const handleAcceptOrder = async () => {
        if (!incomingRequest) return;

        const success = await acceptOrder(
            riderId,
            incomingRequest.data.bookingId,
            incomingRequest.requestId
        );

        if (success) {
            setShowOrderModal(false);
            setIncomingRequest(null);
            Alert.alert(
                '✅ Order Accepted',
                'Navigate to pickup location to collect the package.',
                [{ text: 'Start Navigation', onPress: () => navigation.navigate('Arrival') }]
            );
        } else {
            Alert.alert('Error', 'Failed to accept order. Please try again.');
        }
    };

    // Handle rejecting an order
    const handleRejectOrder = async () => {
        if (!incomingRequest) return;

        await rejectOrder(riderId, incomingRequest.requestId);
        setShowOrderModal(false);
        setIncomingRequest(null);
    };

    // Handle order request expiring
    const handleOrderExpire = () => {
        if (incomingRequest) {
            rejectOrder(riderId, incomingRequest.requestId);
        }
        setShowOrderModal(false);
        setIncomingRequest(null);
    };

    const focusOnUser = () => {
        if (riderLocation && mapRef.current) {
            mapRef.current.animateToRegion({
                latitude: riderLocation.coords.latitude,
                longitude: riderLocation.coords.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
            }, 1000);
        }
    };

    // Fixed destination for demo (e.g., Rizal Park, Manila)
    const destination = {
        latitude: 14.5831,
        longitude: 120.9794,
        title: "Delivery Destination",
        description: "Rizal Park, Manila"
    };

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(dayjs());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Simulated System Logs
    useEffect(() => {
        const addLog = (message: string, type: string = 'info') => {
            setLogs(prev => [{ time: dayjs().format('HH:mm:ss'), message, type }, ...prev].slice(0, 50));
        };

        addLog("System initialized. Monitoring sensors...", "system");

        const logInterval = setInterval(() => {
            const events = [
                "Heartbeat signal received from Box",
                "GPS signal stable",
                "Battery voltage normal (12.4V)",
                "Temperature check: 28°C (Normal)",
                "Connection verified: 4G LTE"
            ];
            const randomEvent = events[Math.floor(Math.random() * events.length)];
            addLog(randomEvent, "system");
        }, 8000); // Add a log every 8 seconds

        return () => clearInterval(logInterval);
    }, []);

    useEffect(() => {
        if (animationRef.current) {
            if (isLocked) {
                animationRef.current.play(0, 60); // Play lock animation
            } else {
                animationRef.current.play(60, 120); // Play unlock animation (approx frames)
            }
        }
    }, [isLocked]);

    const calculateDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371; // Radius of the earth in km
        const dLat = deg2rad(lat2 - lat1);
        const dLon = deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c; // Distance in km
        return d.toFixed(2);
    };

    const deg2rad = (deg) => {
        return deg * (Math.PI / 180);
    };

    const fetchLocation = useCallback(async () => {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            setLocationName('Permission denied');
            Alert.alert('Permission to access location was denied');
            return;
        }

        try {
            let location = await Location.getCurrentPositionAsync({});
            setRiderLocation(location);

            // Calculate distance
            const dist = calculateDistance(
                location.coords.latitude,
                location.coords.longitude,
                destination.latitude,
                destination.longitude
            );
            setDistance(`${dist} km`);

            let address = await Location.reverseGeocodeAsync({
                latitude: location.coords.latitude,
                longitude: location.coords.longitude
            });

            if (address && address.length > 0) {
                const { city, region, name } = address[0];
                const locString = city ? `${city}, ${region}` : name;
                setLocationName(locString || 'Unknown Location');
            }
        } catch (error) {
            console.log('Error fetching location:', error);
            setLocationName('Location unavailable');
        }
    }, []);

    useEffect(() => {
        fetchLocation();
    }, [fetchLocation]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchLocation();
        setRefreshing(false);
    }, [fetchLocation]);

    const toggleLock = () => {
        Alert.alert(
            isLocked ? "Unlock Box?" : "Lock Box?",
            isLocked ? "Are you sure you want to unlock the box?" : "Ensure the box is closed before locking.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: isLocked ? "Unlock" : "Lock", onPress: () => {
                        setIsLocked(!isLocked);
                        const action = !isLocked ? "LOCKED" : "UNLOCKED";
                        setLogs(prev => [{
                            time: dayjs().format('HH:mm:ss'),
                            message: `Manual Override: Box ${action}`,
                            type: action === 'LOCKED' ? 'success' : 'warning'
                        }, ...prev]);
                    }
                }
            ]
        );
    };

    // Mock data
    const weather = { temp: '28°C', condition: 'Cloudy', icon: 'weather-cloudy' };
    const weatherImages = {
        'Sunny': 'https://images.unsplash.com/photo-1622278612016-dd3a787f8003?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80',
        'Cloudy': 'https://images.unsplash.com/photo-1534088568595-a066f410bcda?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80',
        'Rainy': 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80',
        'Thunder': 'https://images.unsplash.com/photo-1605727216801-e27ce1d0cc28?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80',
    };

    const nextDelivery = {
        id: 'TRK-8821-9023',
        address: '123 Rizal Park, Manila',
        customer: 'Lorenzo Bela',
        time: '15 mins',
    };

    const boxStatus = {
        battery: batteryState?.percentage ? batteryState.percentage / 100 : 0.85, // Fall back to 85% if no data
        connection: 'Connected',
        signal: 'Strong',
    };

    // EC-03: Get battery icon based on level
    const getBatteryIcon = () => {
        const pct = batteryState?.percentage ?? 85;
        if (pct > 80) return 'battery';
        if (pct > 60) return 'battery-70';
        if (pct > 40) return 'battery-50';
        if (pct > 20) return 'battery-30';
        return 'battery-alert';
    };

    const getBatteryColor = () => {
        const pct = batteryState?.percentage ?? 85;
        if (pct > 20) return '#2196F3';
        if (pct > 10) return '#FF9800';
        return '#F44336';
    };

    const QuickAction = ({ icon, label, onPress, color }) => (
        <TouchableOpacity style={styles.actionItem} onPress={onPress}>
            <Surface style={[styles.actionIcon, { backgroundColor: color }]} elevation={2}>
                <MaterialCommunityIcons name={icon} size={28} color="white" />
            </Surface>
            <Text variant="labelMedium" style={styles.actionLabel}>{label}</Text>
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            {/* Incoming Order Modal - overlays entire screen */}
            <IncomingOrderModal
                visible={showOrderModal}
                request={incomingRequest?.data || null}
                requestId={incomingRequest?.requestId || ''}
                onAccept={handleAcceptOrder}
                onReject={handleRejectOrder}
                onExpire={handleOrderExpire}
            />

            {/* Attractive Header */}
            <ImageBackground
                source={{ uri: weatherImages[weather.condition] || weatherImages['Sunny'] }}
                style={styles.headerBackground}
                imageStyle={{ borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }}
                resizeMode="cover"
            >
                <View style={styles.headerOverlay}>
                    <View style={styles.headerContent}>
                        <View>
                            <View style={styles.locationContainer}>
                                <MaterialCommunityIcons name="map-marker" size={16} color="rgba(255,255,255,0.9)" />
                                <Text style={styles.locationText}>{locationName}</Text>
                            </View>
                            <Text style={styles.dateText}>{currentTime.format('dddd, MMMM D')}</Text>
                            <Text style={styles.timeText}>{currentTime.format('h:mm A')}</Text>
                        </View>
                        <View style={styles.weatherContainer}>
                            <MaterialCommunityIcons name={weather.icon as any} size={30} color="white" />
                            <Text style={styles.weatherText}>{weather.temp}</Text>
                            <Text style={styles.weatherCondition}>{weather.condition}</Text>
                        </View>
                    </View>
                </View>
            </ImageBackground>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >
                {/* EC-18: Tamper Alert Banner */}
                {tamperState?.detected && (
                    <Surface style={styles.tamperBanner} elevation={4}>
                        <MaterialCommunityIcons name="alert-decagram" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.tamperTitle}>SECURITY ALERT</Text>
                            <Text style={styles.tamperText}>Unauthorized box access detected!</Text>
                        </View>
                    </Surface>
                )}

                {/* EC-82: Keypad Warning Banner */}
                {keypadState?.is_stuck && (
                    <Surface style={styles.warningBanner} elevation={4}>
                        <MaterialCommunityIcons name="keyboard-off" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.bannerTitle}>KEYPAD MALFUNCTION</Text>
                            <Text style={styles.bannerText}>Key '{keypadState.stuck_key}' is stuck. Use App Unlock.</Text>
                        </View>
                    </Surface>
                )}

                {/* EC-85: Recall Banner */}
                {recallState.isRecalled && (
                    <Surface style={styles.dangerBanner} elevation={4}>
                        <MaterialCommunityIcons name="backup-restore" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.bannerTitle}>PACKAGE RECALLED</Text>
                            <Text style={styles.bannerText}>Return to Sender immediately!</Text>
                            {recallState.returnOtp && (
                                <Text style={[styles.bannerText, { fontWeight: 'bold', marginTop: 4 }]}>
                                    Return OTP: {recallState.returnOtp}
                                </Text>
                            )}
                        </View>
                    </Surface>
                )}

                {/* EC-84: GPS Health Warning */}
                {gpsHealth?.isDegraded && (
                    <Surface style={styles.warningBanner} elevation={3}>
                        <MaterialCommunityIcons name="satellite-variant" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.bannerTitle}>WEAK GPS SIGNAL</Text>
                            <Text style={styles.bannerText}>
                                {gpsHealth.obstructionDetected
                                    ? "Box antenna obstructed! Please clear package."
                                    : `Poor reception (HDOP: ${gpsHealth.hdop.toFixed(1)})`}
                            </Text>
                        </View>
                    </Surface>
                )}

                {/* EC-83: Hinge Damage Banner */}
                {hingeState?.status === 'DAMAGED' && (
                    <Surface style={styles.dangerBanner} elevation={4}>
                        <MaterialCommunityIcons name="door-open" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.bannerTitle}>HINGE DAMAGE</Text>
                            <Text style={styles.bannerText}>Physical integrity compromised!</Text>
                        </View>
                    </Surface>
                )}

                {hingeState?.status === 'FLAPPING' && (
                    <Surface style={styles.warningBanner} elevation={4}>
                        <MaterialCommunityIcons name="door-open" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.bannerTitle}>DOOR SENSOR UNSTABLE</Text>
                            <Text style={styles.bannerText}>Check for obstructions near door.</Text>
                        </View>
                    </Surface>
                )}
                {/* EC-01/EC-06: Offline Mode Banner */}
                {isOffline && (
                    <Surface style={styles.offlineBanner} elevation={3}>
                        <MaterialCommunityIcons name="wifi-off" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.offlineTitle}>OFFLINE MODE</Text>
                            <Text style={styles.offlineText}>
                                {pendingSyncs > 0
                                    ? `${pendingSyncs} action${pendingSyncs > 1 ? 's' : ''} pending sync`
                                    : 'Working with cached data'}
                            </Text>
                        </View>
                        {pendingSyncs > 0 && (
                            <View style={styles.syncBadge}>
                                <Text style={styles.syncBadgeText}>{pendingSyncs}</Text>
                            </View>
                        )}
                    </Surface>
                )}

                {/* EC-08: GPS Spoofing Warning */}
                {gpsSpoofWarning && (
                    <Surface style={styles.spoofWarning} elevation={3}>
                        <MaterialCommunityIcons name="map-marker-alert" size={24} color="#7B341E" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.spoofTitle}>GPS ANOMALY</Text>
                            <Text style={styles.spoofText}>Unusual location data detected</Text>
                        </View>
                        <TouchableOpacity onPress={() => setGpsSpoofWarning(false)}>
                            <MaterialCommunityIcons name="close" size={20} color="#7B341E" />
                        </TouchableOpacity>
                    </Surface>
                )}

                {/* EC-46: Clock Skew Warning */}
                {clockSkewWarning && (
                    <Surface style={styles.clockWarning} elevation={2}>
                        <MaterialCommunityIcons name="clock-alert" size={20} color="#1E40AF" />
                        <Text style={styles.clockText}>Device time may be out of sync</Text>
                        <TouchableOpacity onPress={() => setClockSkewWarning(false)}>
                            <MaterialCommunityIcons name="close" size={18} color="#1E40AF" />
                        </TouchableOpacity>
                    </Surface>
                )}

                {/* EC-10: Photo Queue Full Warning */}
                {photoQueueFull && (
                    <Surface style={styles.queueWarning} elevation={2}>
                        <MaterialCommunityIcons name="image-off" size={20} color="#B45309" />
                        <Text style={styles.queueText}>Photo queue full ({photoQueueCount}/{SAFETY_CONSTANTS.MAX_QUEUED_PHOTOS})</Text>
                    </Surface>
                )}

                {/* Status Toggle */}
                <View style={styles.statusToggleContainer}>
                    <View style={styles.statusContainer}>
                        <View style={[styles.statusDot, { backgroundColor: isOnline ? '#4CAF50' : '#9E9E9E' }]} />
                        <Text variant="titleMedium" style={styles.statusText}>
                            {isOnline ? 'You are Online' : 'You are Offline'}
                        </Text>
                    </View>
                    <Switch value={isOnline} onValueChange={setIsOnline} trackColor={{ true: "#4CAF50", false: "#767577" }} />
                </View>

                {/* GPS Connection Status Indicator */}
                <Surface style={styles.gpsStatusCard} elevation={1}>
                    <View style={styles.gpsStatusRow}>
                        <View style={[
                            styles.gpsStatusIcon,
                            { backgroundColor: getStatusColor(gpsSource, isBoxOnline) + '20' }
                        ]}>
                            <MaterialCommunityIcons
                                name={gpsSource === 'box' ? 'access-point' : gpsSource === 'phone' ? 'cellphone' : 'access-point-off'}
                                size={24}
                                color={getStatusColor(gpsSource, isBoxOnline)}
                            />
                        </View>
                        <View style={styles.gpsStatusInfo}>
                            <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>GPS Tracking</Text>
                            <Text variant="bodySmall" style={{ color: getStatusColor(gpsSource, isBoxOnline) }}>
                                {getStatusMessage(gpsSource, isBoxOnline)}
                            </Text>
                        </View>
                        {phoneGpsActive && (
                            <Chip
                                compact
                                icon="phone"
                                style={{ backgroundColor: '#FFF3E0' }}
                                textStyle={{ fontSize: 10 }}
                            >
                                Fallback
                            </Chip>
                        )}
                    </View>
                </Surface>

                {/* Quick Actions */}
                <View style={styles.actionsGrid}>
                    <QuickAction icon="qrcode-scan" label="Scan" onPress={() => console.log('Scan')} color="#4CAF50" />
                    <QuickAction icon="history" label="History" onPress={() => navigation.navigate('DeliveryRecords')} color="#2196F3" />
                    <QuickAction icon="face-agent" label="Support" onPress={() => console.log('Support')} color="#9C27B0" />
                    <QuickAction icon="cog" label="Settings" onPress={() => console.log('Settings')} color="#607D8B" />
                </View>

                {/* Next Delivery Card */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Current Job</Text>
                <Card style={styles.jobCard} mode="elevated">
                    <View style={styles.mapContainer}>
                        {riderLocation ? (
                            <>
                                <MapView
                                    ref={mapRef}
                                    style={styles.map}
                                    initialRegion={{
                                        latitude: riderLocation.coords.latitude,
                                        longitude: riderLocation.coords.longitude,
                                        latitudeDelta: 0.05,
                                        longitudeDelta: 0.05,
                                    }}
                                >
                                    <Marker
                                        coordinate={{
                                            latitude: riderLocation.coords.latitude,
                                            longitude: riderLocation.coords.longitude,
                                        }}
                                        title="You"
                                        pinColor="blue"
                                    />
                                    <Marker
                                        coordinate={destination}
                                        title={destination.title}
                                        description={destination.description}
                                    />
                                </MapView>
                                <IconButton
                                    icon="crosshairs-gps"
                                    mode="contained"
                                    containerColor="white"
                                    iconColor={theme.colors.primary}
                                    size={20}
                                    style={styles.myLocationButton}
                                    onPress={focusOnUser}
                                />
                            </>
                        ) : (
                            <View style={styles.mapPlaceholder}>
                                <Text>Loading Map...</Text>
                            </View>
                        )}
                    </View>

                    <Card.Content style={styles.jobContent}>
                        <View style={styles.jobHeader}>
                            <View>
                                <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>{nextDelivery.customer}</Text>
                                <Text variant="bodySmall" style={{ color: '#666' }}>{nextDelivery.id}</Text>
                            </View>
                            <Chip icon="map-marker-distance" compact style={{ backgroundColor: '#E3F2FD' }}>{distance}</Chip>
                        </View>

                        <View style={styles.divider} />

                        <View style={styles.addressContainer}>
                            <MaterialCommunityIcons name="map-marker" size={20} color={theme.colors.primary} style={{ marginTop: 2 }} />
                            <Text variant="bodyMedium" style={styles.address}>{nextDelivery.address}</Text>
                        </View>

                        <View style={styles.jobMeta}>
                            <View style={styles.metaItem}>
                                <MaterialCommunityIcons name="clock-outline" size={16} color="#666" />
                                <Text style={styles.metaText}>ETA: {nextDelivery.time}</Text>
                            </View>
                        </View>
                    </Card.Content>

                    <Card.Actions style={styles.jobActions}>
                        <Button
                            mode="outlined"
                            style={{ flex: 1, marginRight: 8 }}
                            onPress={() => navigation.navigate('AssignedDeliveries')}
                            textColor={theme.colors.primary}
                        >
                            Details
                        </Button>
                        <Button
                            mode="contained"
                            style={{ flex: 1 }}
                            onPress={() => navigation.navigate('Arrival')}
                            buttonColor={theme.colors.primary}
                        >
                            Start Trip
                        </Button>
                    </Card.Actions>
                </Card>

                {/* Smart Box Status */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Box Status</Text>
                <Surface style={styles.statusCard} elevation={2}>

                    {/* Enhanced Unlock Button with Lottie */}
                    <View style={styles.unlockContainer}>
                        <View style={styles.unlockInfo}>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>Lock Mechanism</Text>
                            <Text variant="bodyMedium" style={{ color: isLocked ? '#4CAF50' : '#F44336' }}>
                                {isLocked ? 'Securely Locked' : 'Unlocked'}
                            </Text>
                        </View>
                        <TouchableOpacity
                            style={[styles.unlockButton, { backgroundColor: isLocked ? '#E8F5E9' : '#FFEBEE', borderWidth: 1, borderColor: isLocked ? '#4CAF50' : '#F44336' }]}
                            onPress={toggleLock}
                        >
                            <MaterialCommunityIcons
                                name={isLocked ? "shield-lock" : "shield-lock-open"}
                                size={40}
                                color={isLocked ? "#4CAF50" : "#F44336"}
                            />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.statusRow}>
                        <View style={[styles.statusIconContainer, { backgroundColor: getBatteryColor() + '20' }]}>
                            <MaterialCommunityIcons name={getBatteryIcon() as any} size={24} color={getBatteryColor()} />
                        </View>
                        <View style={styles.statusInfo}>
                            <Text variant="titleSmall">Battery Level</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                <ProgressBar progress={boxStatus.battery} color={getBatteryColor()} style={styles.progressBar} />
                                <Text variant="labelSmall" style={{ marginLeft: 8, fontWeight: 'bold', color: getBatteryColor() }}>
                                    {batteryState?.percentage ?? 85}%
                                </Text>
                            </View>
                        </View>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.statusRow}>
                        <View style={[styles.statusIconContainer, { backgroundColor: '#F3E5F5' }]}>
                            <MaterialCommunityIcons name="bluetooth" size={24} color="#9C27B0" />
                        </View>
                        <View style={styles.statusInfo}>
                            <Text variant="titleSmall">Connection</Text>
                            <Text variant="bodySmall" style={{ color: '#666' }}>{boxStatus.connection} • {boxStatus.signal}</Text>
                        </View>
                    </View>

                    <Button mode="outlined" style={{ marginTop: 16 }} onPress={() => navigation.navigate('BoxControls')}>
                        Advanced Controls
                    </Button>
                </Surface>

                {/* Real-Time Logs */}
                <Text variant="titleMedium" style={styles.sectionTitle}>System Logs</Text>
                <Surface style={styles.logsCard} elevation={1}>
                    {logs.length === 0 ? (
                        <Text style={{ color: '#999', textAlign: 'center', padding: 20 }}>No logs available</Text>
                    ) : (
                        logs.slice(0, 5).map((log, index) => (
                            <View key={index} style={styles.logItem}>
                                <Text style={styles.logTime}>{log.time}</Text>
                                <Text numberOfLines={1} style={[styles.logMessage, { color: log.type === 'warning' ? '#D32F2F' : log.type === 'success' ? '#388E3C' : '#444' }]}>
                                    {log.message}
                                </Text>
                            </View>
                        ))
                    )}
                </Surface>

            </ScrollView >
        </View >
    );
}

const styles = StyleSheet.create({
    bannerTitle: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 14,
    },
    bannerText: {
        color: 'white',
        fontSize: 12,
    },
    warningBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 12,
        backgroundColor: '#F57C00', // Orange for warning
    },
    dangerBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 12,
        backgroundColor: '#D32F2F', // Red for critical
    },
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    headerBackground: {
        height: 180,
        justifyContent: 'flex-end',
    },
    headerOverlay: {
        backgroundColor: 'rgba(0,0,0,0.1)',
        height: '100%',
        justifyContent: 'flex-end',
        paddingBottom: 20,
        paddingHorizontal: 20,
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 20,
    },
    headerContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
    },
    locationContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    locationText: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 4,
    },
    dateText: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 14,
        fontWeight: 'bold',
    },
    timeText: {
        color: 'white',
        fontSize: 32,
        fontWeight: 'bold',
    },
    weatherContainer: {
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.2)',
        padding: 8,
        borderRadius: 12,
    },
    weatherText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    weatherCondition: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 12,
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 80,
    },
    statusToggleContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
        marginTop: 10,
        backgroundColor: 'white',
        padding: 16,
        borderRadius: 16,
        elevation: 1,
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 10,
    },
    statusText: {
        fontWeight: 'bold',
        color: '#444',
    },
    sectionTitle: {
        fontWeight: 'bold',
        marginBottom: 12,
        color: '#333',
    },
    jobCard: {
        marginBottom: 24,
        backgroundColor: 'white',
        overflow: 'hidden',
        borderRadius: 16,
    },
    mapContainer: {
        height: 150,
        backgroundColor: '#F5F5F5',
        justifyContent: 'center',
        alignItems: 'center',
    },
    map: {
        width: '100%',
        height: '100%',
    },
    mapPlaceholder: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    myLocationButton: {
        position: 'absolute',
        bottom: 10,
        right: 10,
        margin: 0,
    },
    jobContent: {
        padding: 16,
    },
    jobHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    addressContainer: {
        flexDirection: 'row',
        marginBottom: 12,
    },
    address: {
        color: '#444',
        marginLeft: 8,
        flex: 1,
    },
    jobMeta: {
        flexDirection: 'row',
        marginTop: 4,
    },
    metaItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 16,
    },
    metaText: {
        marginLeft: 4,
        color: '#666',
        fontSize: 12,
        fontWeight: 'bold',
    },
    jobActions: {
        padding: 16,
        paddingTop: 0,
    },
    statusCard: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    statusIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    statusInfo: {
        flex: 1,
    },
    progressBar: {
        height: 6,
        borderRadius: 3,
        flex: 1,
    },
    divider: {
        height: 1,
        backgroundColor: '#F0F0F0',
        marginVertical: 8,
    },
    actionsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    actionItem: {
        alignItems: 'center',
        width: '22%',
    },
    actionIcon: {
        width: 50,
        height: 50,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    actionLabel: {
        color: '#555',
    },
    unlockContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
    },
    unlockInfo: {
        flex: 1,
    },
    unlockButton: {
        width: 60,
        height: 60,
        borderRadius: 30,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 1,
    },
    logsCard: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 16,
        maxHeight: 200,
        overflow: 'hidden', // Ensure content doesn't bleed out
    },
    logItem: {
        flexDirection: 'row',
        marginBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#F5F5F5',
        paddingBottom: 4,
    },
    logTime: {
        fontSize: 12,
        color: '#999',
        width: 60,
        fontFamily: 'monospace',
    },
    logMessage: {
        fontSize: 12,
        flex: 1,
    },
    gpsStatusCard: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 12,
        marginBottom: 16,
    },
    gpsStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    gpsStatusIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    gpsStatusInfo: {
        flex: 1,
    },
    tamperBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#D32F2F',
        marginHorizontal: 16,
        marginTop: 16,
        padding: 16,
        borderRadius: 12,
    },
    tamperTitle: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    },
    tamperText: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 14,
    },
    // EC-01/EC-06: Offline Mode Styles
    offlineBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#475569',
        marginHorizontal: 16,
        marginTop: 8,
        padding: 14,
        borderRadius: 12,
    },
    offlineTitle: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 14,
    },
    offlineText: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 12,
    },
    syncBadge: {
        backgroundColor: '#EF4444',
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    syncBadgeText: {
        color: 'white',
        fontSize: 12,
        fontWeight: 'bold',
    },
    // EC-08: GPS Spoofing Warning Styles
    spoofWarning: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF3C7',
        marginHorizontal: 16,
        marginTop: 8,
        padding: 12,
        borderRadius: 10,
        borderLeftWidth: 4,
        borderLeftColor: '#D97706',
    },
    spoofTitle: {
        color: '#92400E',
        fontWeight: 'bold',
        fontSize: 13,
    },
    spoofText: {
        color: '#B45309',
        fontSize: 12,
    },
    // EC-46: Clock Skew Warning Styles
    clockWarning: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#DBEAFE',
        marginHorizontal: 16,
        marginTop: 8,
        padding: 10,
        borderRadius: 8,
        gap: 8,
    },
    clockText: {
        flex: 1,
        color: '#1E40AF',
        fontSize: 12,
    },
    // EC-10: Photo Queue Warning Styles
    queueWarning: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF3C7',
        marginHorizontal: 16,
        marginTop: 8,
        padding: 10,
        borderRadius: 8,
        gap: 8,
    },
    queueText: {
        flex: 1,
        color: '#B45309',
        fontSize: 12,
    },
});
