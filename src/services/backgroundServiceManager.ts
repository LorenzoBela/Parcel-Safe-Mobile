/**
 * Background Service Manager - Android Only
 * 
 * Manages all background operations to ensure the app can receive orders and notifications
 * even when in the background or killed. Implements industry standards from Uber, Grab, Lalamove.
 * 
 * Features:
 * - Firebase Cloud Messaging (FCM) for push notifications
 * - Background fetch for periodic updates
 * - Foreground service for persistent connection
 * - Battery optimization handling
 */

import { Platform, AppState, AppStateStatus, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Native modules - conditionally imported to prevent startup crashes
let NetInfo: any = null;
let messaging: any = null;
let BackgroundFetch: any = null;
let BackgroundService: any = null;

try {
    NetInfo = require('@react-native-community/netinfo').default;
    // Use modular API (Firebase v22+) instead of deprecated .default
    const messagingModule = require('@react-native-firebase/messaging');
    messaging = messagingModule.default || messagingModule;
    BackgroundFetch = require('react-native-background-fetch').default;
    BackgroundService = require('react-native-background-actions').default;
} catch (error) {
    if (__DEV__) console.log('[BackgroundService] Native modules not available');
}

// ==================== Configuration ====================

export const BACKGROUND_CONFIG = {
    /** Background fetch minimum interval (minutes) */
    FETCH_INTERVAL: 15,

    /** Heartbeat interval for foreground service (ms) */
    HEARTBEAT_INTERVAL: 30000, // 30 seconds

    /** Maximum reconnection attempts */
    MAX_RECONNECT_ATTEMPTS: 5,

    /** Reconnection delay (ms) */
    RECONNECT_DELAY: 5000,

    /** Notification channel IDs */
    CHANNELS: {
        INCOMING_ORDER: 'incoming-order-critical',
        FOREGROUND_SERVICE: 'foreground-service',
        DELIVERY_STATUS: 'delivery-status',
    },

    /** Storage keys */
    STORAGE_KEYS: {
        FCM_TOKEN: 'fcm_token',
        BACKGROUND_STATE: 'background_state',
        LAST_HEARTBEAT: 'last_heartbeat',
    },
};

// ==================== Types ====================

export interface BackgroundState {
    isRunning: boolean;
    isForegroundServiceActive: boolean;
    lastHeartbeat: number | null;
    fcmToken: string | null;
    reconnectAttempts: number;
    networkStatus: 'online' | 'offline';
}

export type BackgroundEventType =
    | 'order_received'
    | 'status_update'
    | 'message_received'
    | 'connection_lost'
    | 'connection_restored';

export interface BackgroundEventHandler {
    (type: BackgroundEventType, data: any): void | Promise<void>;
}

// ==================== State Management ====================

let backgroundState: BackgroundState = {
    isRunning: false,
    isForegroundServiceActive: false,
    lastHeartbeat: null,
    fcmToken: null,
    reconnectAttempts: 0,
    networkStatus: 'offline',
};

let eventHandlers: BackgroundEventHandler[] = [];
let heartbeatInterval: NodeJS.Timeout | null = null;

// ==================== Event System ====================

/**
 * Register an event handler for background events
 */
export function onBackgroundEvent(handler: BackgroundEventHandler): () => void {
    eventHandlers.push(handler);

    // Return unsubscribe function
    return () => {
        eventHandlers = eventHandlers.filter(h => h !== handler);
    };
}

/**
 * Emit a background event to all handlers
 */
async function emitEvent(type: BackgroundEventType, data: any): Promise<void> {
    if (__DEV__) console.log(`[BackgroundService] Event: ${type}`);

    for (const handler of eventHandlers) {
        try {
            await handler(type, data);
        } catch (error) {
            if (__DEV__) console.error('[BackgroundService] Event handler error:', error);
        }
    }
}

// ==================== Firebase Cloud Messaging ====================

/**
 * Initialize Firebase Cloud Messaging
 */
async function initializeFCM(): Promise<string | null> {
    if (!messaging) {
        if (__DEV__) console.log('[BackgroundService] FCM not available');
        return null;
    }

    try {
        // Check if messaging is callable
        if (typeof messaging !== 'function') {
            if (__DEV__) console.warn('[BackgroundService] Firebase messaging not initialized');
            return null;
        }

        // Request permission (Android 13+)
        const authStatus = await messaging().requestPermission();
        const enabled = authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
            authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (!enabled) {
            if (__DEV__) console.warn('[BackgroundService] FCM permission denied');
            return null;
        }

        // Get FCM token
        const fcmToken = await messaging().getToken();
        if (__DEV__) console.log('[BackgroundService] FCM Token obtained');

        // Save token
        await AsyncStorage.setItem(BACKGROUND_CONFIG.STORAGE_KEYS.FCM_TOKEN, fcmToken);
        backgroundState.fcmToken = fcmToken;

        // Setup message handlers
        setupFCMHandlers();

        return fcmToken;
    } catch (error) {
        if (__DEV__) console.error('[BackgroundService] FCM init error:', error);
        return null;
    }
}
/**
 * Setup FCM message handlers
 */
function setupFCMHandlers(): void {
    if (!messaging) return;

    // Foreground messages
    messaging().onMessage(async (remoteMessage: any) => {
        if (__DEV__) console.log('[BackgroundService] Foreground FCM message');

        if (remoteMessage.data?.type === 'order') {
            await emitEvent('order_received', remoteMessage.data);
            await showOrderNotification(remoteMessage.data);
        } else if (remoteMessage.data?.type === 'status') {
            await emitEvent('status_update', remoteMessage.data);
        }
    });

    // Token refresh
    messaging().onTokenRefresh(async (token: string) => {
        if (__DEV__) console.log('[BackgroundService] FCM token refreshed');
        await AsyncStorage.setItem(BACKGROUND_CONFIG.STORAGE_KEYS.FCM_TOKEN, token);
        backgroundState.fcmToken = token;
        // TODO: Update token on server
    });
}

/**
 * Background message handler (call this from index.js)
 */
export async function handleBackgroundMessage(remoteMessage: any): Promise<void> {
    if (__DEV__) console.log('[BackgroundService] Background FCM message');

    if (remoteMessage.data?.type === 'order') {
        // Process order even when app is in background/killed
        await emitEvent('order_received', remoteMessage.data);
        await showOrderNotification(remoteMessage.data);
    }
}

// ==================== Notification Display ====================

/**
 * Show notification for incoming order
 */
async function showOrderNotification(orderData: any): Promise<void> {
    try {
        await Notifications.scheduleNotificationAsync({
            content: {
                title: '🚚 New Delivery Order!',
                body: `Pickup: ${orderData.pickup_address || 'Loading...'}\nDelivery: ${orderData.delivery_address || 'Loading...'}`,
                data: orderData,
                sound: 'default',
                priority: Notifications.AndroidNotificationPriority.MAX,
                categoryIdentifier: 'ORDER_ACTIONS',
            },
            trigger: null, // Show immediately
        });
    } catch (error) {
        if (__DEV__) console.error('[BackgroundService] Notification error:', error);
    }
}

// ==================== Background Fetch ====================

/**
 * Initialize background fetch for periodic updates
 */
async function initializeBackgroundFetch(): Promise<void> {
    if (!BackgroundFetch || typeof BackgroundFetch.configure !== 'function') {
        if (__DEV__) console.log('[BackgroundService] Background fetch not available');
        return;
    }

    try {
        // Configure background fetch
        await BackgroundFetch.configure(
            {
                minimumFetchInterval: BACKGROUND_CONFIG.FETCH_INTERVAL,
                stopOnTerminate: false, // Continue after app termination
                startOnBoot: true, // Start after device reboot
                enableHeadless: true, // Android headless mode
                requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
                requiresCharging: false,
                requiresDeviceIdle: false,
                requiresBatteryNotLow: false,
                requiresStorageNotLow: false,
            },
            async (taskId: string) => {
                if (__DEV__) console.log('[BackgroundService] Background fetch executed:', taskId);

                try {
                    // Check for new orders
                    await checkForNewOrders();

                    // Update heartbeat
                    const now = Date.now();
                    await AsyncStorage.setItem(
                        BACKGROUND_CONFIG.STORAGE_KEYS.LAST_HEARTBEAT,
                        now.toString()
                    );
                    backgroundState.lastHeartbeat = now;

                    BackgroundFetch.finish(taskId);
                } catch (error) {
                    if (__DEV__) console.error('[BackgroundService] Background fetch error:', error);
                    BackgroundFetch.finish(taskId);
                }
            },

            (taskId: string) => {
                if (__DEV__) console.warn('[BackgroundService] Background fetch timeout:', taskId);
                BackgroundFetch.finish(taskId);
            }
        );

        // Start background fetch
        await BackgroundFetch.start();
        if (__DEV__) console.log('[BackgroundService] Background fetch started');
    } catch (error) {
        if (__DEV__) console.error('[BackgroundService] Background fetch setup error:', error);
    }
}

/**
 * Check for new orders (called during background fetch)
 */
async function checkForNewOrders(): Promise<void> {
    // TODO: Implement order checking logic
    // This should query your backend/Firebase for new orders
    if (__DEV__) console.log('[BackgroundService] Checking for new orders...');
}

/**
 * Start foreground service to keep app alive (Android only)
 */
async function startForegroundService(): Promise<void> {
    if (Platform.OS !== 'android' || !BackgroundService || typeof BackgroundService.start !== 'function') {
        if (__DEV__) console.log('[BackgroundService] Foreground service not available');
        return; // Foreground service only needed on Android
    }

    try {
        // CRITICAL: Check location permissions before starting FGS with type "location"
        // Android 14+ (API 34+) requires location permissions to be granted at runtime
        const { PermissionsAndroid } = require('react-native');

        const coarseGranted = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION
        );
        const fineGranted = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );

        if (!coarseGranted && !fineGranted) {
            // Request location permissions
            const granted = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                {
                    title: 'Location Permission',
                    message: 'Parcel Safe needs location access to track deliveries',
                    buttonNeutral: 'Ask Me Later',
                    buttonNegative: 'Cancel',
                    buttonPositive: 'OK',
                }
            );

            if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                if (__DEV__) console.error('[BackgroundService] Location permission denied');
                throw new Error('Location permission required for foreground service');
            }
        }

        const options = {
            taskName: 'Parcel Safe Background Service',
            taskTitle: 'Parcel Safe - Ready for Orders',
            taskDesc: 'Listening for incoming delivery orders',
            taskIcon: {
                name: 'ic_launcher',
                type: 'mipmap',
            },
            color: '#FF6B00',
            linkingURI: 'parcelsafe://orders',
            progressBar: {
                max: 100,
                value: 0,
                indeterminate: true,
            },
        };

        await BackgroundService.start(foregroundServiceTask, options);
        backgroundState.isForegroundServiceActive = true;
        if (__DEV__) console.log('[BackgroundService] Foreground service started');
    } catch (error) {
        if (__DEV__) console.error('[BackgroundService] Foreground service error:', error);
        throw error; // Re-throw to prevent silent failures
    }
}



/**
 * Foreground service task
 */
const foregroundServiceTask = async (taskData: any) => {
    await new Promise(async () => {
        // Keep service running with periodic heartbeat
        while (BackgroundService.isRunning()) {
            try {
                // Heartbeat
                const now = Date.now();
                backgroundState.lastHeartbeat = now;
                await AsyncStorage.setItem(
                    BACKGROUND_CONFIG.STORAGE_KEYS.LAST_HEARTBEAT,
                    now.toString()
                );

                // Update notification
                await BackgroundService.updateNotification({
                    taskDesc: `Active - Last check: ${new Date(now).toLocaleTimeString()}`,
                });

                // Wait for next heartbeat
                await new Promise(resolve => setTimeout(resolve, BACKGROUND_CONFIG.HEARTBEAT_INTERVAL));
            } catch (error) {
                if (__DEV__) console.error('[BackgroundService] Heartbeat error:', error);
            }
        }
    });
};

/**
 * Stop foreground service
 */
async function stopForegroundService(): Promise<void> {
    if (Platform.OS !== 'android' || !BackgroundService) {
        return;
    }

    try {
        await BackgroundService.stop();
        backgroundState.isForegroundServiceActive = false;
        if (__DEV__) console.log('[BackgroundService] Foreground service stopped');
    } catch (error) {
        if (__DEV__) console.error('[BackgroundService] Stop foreground error:', error);
    }
}

// ==================== Network Monitoring ====================

/**
 * Setup network monitoring
 */
function setupNetworkMonitoring(): void {
    if (!NetInfo) {
        if (__DEV__) console.log('[BackgroundService] NetInfo not available, skipping network monitoring');
        return;
    }
    NetInfo.addEventListener(state => {
        const wasOnline = backgroundState.networkStatus === 'online';
        const isOnline = state.isConnected && state.isInternetReachable;

        backgroundState.networkStatus = isOnline ? 'online' : 'offline';

        if (!wasOnline && isOnline) {
            if (__DEV__) console.log('[BackgroundService] Network restored');
            emitEvent('connection_restored', { timestamp: Date.now() });
            backgroundState.reconnectAttempts = 0;
        } else if (wasOnline && !isOnline) {
            if (__DEV__) console.log('[BackgroundService] Network lost');
            emitEvent('connection_lost', { timestamp: Date.now() });
        }
    });
}

// ==================== Public API ====================

/**
 * Initialize all background services
 */
export async function initializeBackgroundServices(): Promise<void> {
    if (backgroundState.isRunning) {
        console.log('[BackgroundService] Already running');
        return;
    }

    try {
        if (__DEV__) console.log('[BackgroundService] Initializing...');

        // 1. Setup notification channels
        await setupNotificationChannels();

        // 2. Initialize FCM
        const fcmToken = await initializeFCM();
        if (fcmToken) {
            if (__DEV__) console.log('[BackgroundService] FCM initialized');
        }

        // 3. Initialize background fetch
        await initializeBackgroundFetch();

        // 4. Start foreground service (Android only)
        if (Platform.OS === 'android') {
            await startForegroundService();
        }

        // 5. Setup network monitoring
        setupNetworkMonitoring();

        backgroundState.isRunning = true;

        // Save state
        await AsyncStorage.setItem(
            BACKGROUND_CONFIG.STORAGE_KEYS.BACKGROUND_STATE,
            JSON.stringify(backgroundState)
        );

        if (__DEV__) console.log('[BackgroundService] Successfully initialized');
    } catch (error) {
        if (__DEV__) console.error('[BackgroundService] Initialization error:', error);
        throw error;
    }
}

/**
 * Stop all background services
 */
export async function stopBackgroundServices(): Promise<void> {
    try {
        if (__DEV__) console.log('[BackgroundService] Stopping...');

        // Stop foreground service
        await stopForegroundService();

        // Stop background fetch
        if (BackgroundFetch) {
            await BackgroundFetch.stop();
        }

        // Clear heartbeat
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }

        backgroundState.isRunning = false;

        await AsyncStorage.setItem(
            BACKGROUND_CONFIG.STORAGE_KEYS.BACKGROUND_STATE,
            JSON.stringify(backgroundState)
        );

        if (__DEV__) console.log('[BackgroundService] Stopped');
    } catch (error) {
        if (__DEV__) console.error('[BackgroundService] Stop error:', error);
    }
}

/**
 * Get current background state
 */
export function getBackgroundState(): BackgroundState {
    return { ...backgroundState };
}

/**
 * Get FCM token
 */
export function getFCMToken(): string | null {
    return backgroundState.fcmToken;
}

// ==================== Notification Channels ====================

/**
 * Setup notification channels for Android
 */
export async function setupNotificationChannels(): Promise<void> {

    try {
        // Critical incoming order channel
        await Notifications.setNotificationChannelAsync(
            BACKGROUND_CONFIG.CHANNELS.INCOMING_ORDER,
            {
                name: 'Incoming Orders',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#FF6B00',
                sound: 'default',
                enableVibrate: true,
                showBadge: true,
                bypassDnd: true, // Critical alerts
            }
        );

        // Foreground service channel
        await Notifications.setNotificationChannelAsync(
            BACKGROUND_CONFIG.CHANNELS.FOREGROUND_SERVICE,
            {
                name: 'Background Service',
                importance: Notifications.AndroidImportance.LOW,
                sound: null,
                enableVibrate: false,
                showBadge: false,
            }
        );

        // Delivery status channel
        await Notifications.setNotificationChannelAsync(
            BACKGROUND_CONFIG.CHANNELS.DELIVERY_STATUS,
            {
                name: 'Delivery Status',
                importance: Notifications.AndroidImportance.HIGH,
                sound: 'default',
                enableVibrate: true,
            }
        );

        if (__DEV__) console.log('[BackgroundService] Notification channels created');
    } catch (error) {
        if (__DEV__) console.error('[BackgroundService] Notification channel error:', error);
    }
}

// ==================== Battery Optimization ====================

/**
 * Check if battery optimization is disabled
 */
export async function checkBatteryOptimization(): Promise<boolean> {
    // This requires native module - placeholder
    // In production, use react-native-device-info or custom native module
    if (__DEV__) console.log('[BackgroundService] Battery optimization check not implemented');
    return true;
}

/**
 * Request to disable battery optimization
 */
export async function requestDisableBatteryOptimization(): Promise<void> {
    if (Platform.OS !== 'android') return;

    try {
        // Open battery optimization settings
        // specific to the app if possible, otherwise general settings
        const pkg = 'com.parcel.safe'; // Must match app.json
        const intent = 'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS';

        // This is a simplified approach. In a real native module we'd check isIgnoringBatteryOptimizations()
        // Here we just guide the user to settings
        await Linking.sendIntent(intent, [{ key: 'package', value: `package:${pkg}` }]);
        if (__DEV__) console.log('[BackgroundService] Opened battery settings');
    } catch (error) {
        if (__DEV__) console.error('[BackgroundService] Settings error:', error);
        // Fallback to general settings
        await Linking.openSettings();
    }
}
