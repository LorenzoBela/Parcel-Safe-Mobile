/**
 * Push Notification Service for Parcel-Safe
 * 
 * Handles push notification registration, local notifications,
 * and ongoing/persistent status notifications for delivery tracking.
 * 
 * Now integrated with Firebase Cloud Messaging (FCM) for reliable
 * background notification delivery.
 * 
 * NOTE: Push notifications require a development build (not Expo Go).
 * In Expo Go, notifications will be simulated with console logs.
 */

import { Platform } from 'react-native';
import { supabase } from './supabaseClient';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Conditionally import modules
let Notifications: any = null;
let messaging: any = null;
let AuthorizationStatus: any = null;

try {
    Notifications = require('expo-notifications');
    // Use modular API if available to avoid deprecation warnings
    const messagingModule = require('@react-native-firebase/messaging');
    if (messagingModule.getMessaging) {
        // Wrap in function to match existing usage: messaging().method()
        messaging = () => messagingModule.getMessaging();
    } else {
        messaging = messagingModule.default || messagingModule;
    }
    // safely capture AuthorizationStatus
    AuthorizationStatus = messagingModule.AuthorizationStatus || (messagingModule.default && messagingModule.default.AuthorizationStatus) || {};
} catch (error) {
    console.log('[DEV] Native modules not available - using console simulation');
}

// Flag to track if native notifications are available (lazy detection)
let nativeNotificationsAvailable: boolean | null = null;
let notificationHandlerSet = false;

/**
 * Check if notifications are available (lazy detection)
 */
function checkNotificationsAvailable(): boolean {
    // If Notifications module failed to load, notifications are not available
    if (!Notifications) {
        nativeNotificationsAvailable = false;
        return false;
    }

    if (nativeNotificationsAvailable !== null) {
        return nativeNotificationsAvailable;
    }

    try {
        // Try to access a notification API to check availability
        Notifications.getPermissionsAsync();
        nativeNotificationsAvailable = true;
    } catch (error) {
        console.warn('Push notifications not available (requires development build)');
        nativeNotificationsAvailable = false;
    }

    return nativeNotificationsAvailable;
}

/**
 * Setup notification handler (called lazily on first use)
 */
function ensureNotificationHandler(): void {
    if (notificationHandlerSet || !checkNotificationsAvailable()) {
        return;
    }

    try {
        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowAlert: true,
                shouldPlaySound: true,
                shouldSetBadge: true,
                shouldShowBanner: true,
                shouldShowList: true,
            }),
        });
        notificationHandlerSet = true;
    } catch (error) {
        console.warn('Failed to set notification handler:', error);
        nativeNotificationsAvailable = false;
    }
}

// Notification channel for Android (required for Android 8+)
export const NOTIFICATION_CHANNELS = {
    INCOMING_ORDER: 'incoming-order',
    DELIVERY_STATUS: 'delivery-status',
    ONGOING_DELIVERY: 'ongoing-delivery',
};

/**
 * Check if native notifications are available
 */
export function isNotificationsAvailable(): boolean {
    return checkNotificationsAvailable();
}

/**
 * Initialize notification channels for Android
 */
export async function setupNotificationChannels(): Promise<void> {
    ensureNotificationHandler();

    if (!checkNotificationsAvailable() || Platform.OS !== 'android') {
        return;
    }

    try {
        // High priority channel for incoming orders
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.INCOMING_ORDER, {
            name: 'Incoming Orders',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF6B00',
            sound: 'default',
            enableVibrate: true,
            showBadge: true,
        });

        // Status updates channel
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.DELIVERY_STATUS, {
            name: 'Delivery Status',
            importance: Notifications.AndroidImportance.HIGH,
            sound: 'default',
        });

        // Ongoing delivery channel (for persistent notifications)
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.ONGOING_DELIVERY, {
            name: 'Ongoing Delivery',
            importance: Notifications.AndroidImportance.LOW,
            sound: null,
        });
    } catch (error) {
        console.warn('Failed to setup notification channels:', error);
        nativeNotificationsAvailable = false;
    }
}

/**
 * Request notification permissions and get push token
 * Now uses Firebase Cloud Messaging (FCM)
 */
export async function registerForPushNotifications(): Promise<string | null> {
    if (!checkNotificationsAvailable() || !messaging) {
        console.log('[DEV] Push notifications simulated - requires development build');
        return 'SIMULATED_TOKEN_DEV';
    }

    try {
        // Request FCM permission (Android 13+)
        const authStatus = await messaging().requestPermission();
        const enabled = authStatus === AuthorizationStatus.AUTHORIZED ||
            authStatus === AuthorizationStatus.PROVISIONAL;

        if (!enabled) {
            console.warn('FCM permission not granted');
            return null;
        }

        // Get the FCM token
        const fcmToken = await messaging().getToken();
        console.log('FCM Push token:', fcmToken);

        // Save token to AsyncStorage
        await AsyncStorage.setItem('fcm_token', fcmToken);

        // Also get Expo push token if available (for backup)
        try {
            if (Notifications) {
                const tokenData = await Notifications.getExpoPushTokenAsync({
                    projectId: undefined, // Will use projectId from app.json
                });
                console.log('Expo Push token:', tokenData.data);
            }
        } catch (expoError) {
            console.log('Expo push token not available:', expoError);
        }

        return fcmToken;
    } catch (error) {
        console.warn('Failed to register for push notifications:', error);
        nativeNotificationsAvailable = false;
        return 'SIMULATED_TOKEN_DEV';
    }
}

/**
 * Get current FCM token
 */
export async function getFCMToken(): Promise<string | null> {
    try {
        const token = await AsyncStorage.getItem('fcm_token');
        if (token) {
            return token;
        }

        // If not cached, get new token
        return await registerForPushNotifications();
    } catch (error) {
        console.error('Failed to get FCM token:', error);
        return null;
    }
}

/**
 * Handle FCM token refresh
 */
export function onTokenRefresh(callback: (token: string) => void): () => void {
    if (!messaging) {
        return () => { };
    }

    const unsubscribe = messaging().onTokenRefresh(async (newToken: string) => {
        console.log('FCM token refreshed:', newToken);
        await AsyncStorage.setItem('fcm_token', newToken);
        callback(newToken);
    });

    return unsubscribe;
}

/**
 * Save push token to database for the current user
 */
export async function saveTokenToDatabase(userId: string, token: string): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured - cannot save push token');
        return false;
    }

    try {
        const { error } = await supabase
            .from('profiles')
            .upsert({
                id: userId,
                push_token: token,
                push_token_updated_at: new Date().toISOString(),
            }, { onConflict: 'id' });

        if (error) {
            console.error('Failed to save push token:', error.message);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error saving push token:', error);
        return false;
    }
}

/**
 * Show a local notification for incoming order
 */
export async function showIncomingOrderNotification(
    pickupAddress: string,
    dropoffAddress: string,
    estimatedFare: number,
    bookingId: string
): Promise<string> {
    if (!checkNotificationsAvailable()) {
        console.log(`[DEV NOTIFICATION] 🚀 New Order Request!\nPickup: ${pickupAddress}\nFare: ₱${estimatedFare.toFixed(2)}`);
        return 'SIMULATED_NOTIF_ID';
    }

    try {
        const notificationId = await Notifications.scheduleNotificationAsync({
            content: {
                title: '🚀 New Order Request!',
                body: `Pickup: ${pickupAddress}\nDropoff: ${dropoffAddress}\nFare: ₱${estimatedFare.toFixed(2)}`,
                data: { bookingId, type: 'INCOMING_ORDER' },
                sound: 'default',
                priority: Notifications.AndroidNotificationPriority.MAX,
                vibrate: [0, 250, 250, 250],
            },
            trigger: null,
        });
        return notificationId;
    } catch (error) {
        console.warn('Failed to show notification:', error);
        return 'FAILED_NOTIF_ID';
    }
}

/**
 * Show local notification for status updates
 */
export async function showStatusNotification(
    title: string,
    body: string,
    data?: Record<string, any>
): Promise<string> {
    if (!nativeNotificationsAvailable) {
        console.log(`[DEV NOTIFICATION] ${title}: ${body}`);
        return 'SIMULATED_NOTIF_ID';
    }

    try {
        const notificationId = await Notifications.scheduleNotificationAsync({
            content: {
                title,
                body,
                data: { ...data, type: 'STATUS_UPDATE' },
                sound: 'default',
            },
            trigger: null,
        });
        return notificationId;
    } catch (error) {
        console.warn('Failed to show status notification:', error);
        return 'FAILED_NOTIF_ID';
    }
}

// Store ongoing notification ID for updates
let ongoingNotificationId: string | null = null;

/**
 * Start an ongoing (sticky) notification for active delivery tracking
 * This notification stays in the notification shade and can be updated
 */
export async function startOngoingNotification(
    deliveryId: string,
    initialStatus: DeliveryStatus
): Promise<string> {
    const { title, body } = getStatusContent(initialStatus);

    if (!nativeNotificationsAvailable) {
        console.log(`[DEV ONGOING NOTIFICATION] ${title}: ${body}`);
        ongoingNotificationId = 'SIMULATED_ONGOING_ID';
        return ongoingNotificationId;
    }

    try {
        ongoingNotificationId = await Notifications.scheduleNotificationAsync({
            content: {
                title,
                body,
                data: { deliveryId, type: 'ONGOING_DELIVERY' },
                sticky: true,
                autoDismiss: false,
            },
            trigger: null,
        });
        return ongoingNotificationId;
    } catch (error) {
        console.warn('Failed to start ongoing notification:', error);
        ongoingNotificationId = 'FAILED_ONGOING_ID';
        return ongoingNotificationId;
    }
}

/**
 * Update the ongoing notification with new status
 */
export async function updateOngoingNotification(
    status: DeliveryStatus,
    additionalInfo?: string
): Promise<void> {
    if (!ongoingNotificationId) {
        console.warn('No ongoing notification to update');
        return;
    }

    // Cancel old notification and create new one with updated content
    await Notifications.cancelScheduledNotificationAsync(ongoingNotificationId);

    const { title, body } = getStatusContent(status, additionalInfo);

    ongoingNotificationId = await Notifications.scheduleNotificationAsync({
        content: {
            title,
            body,
            sticky: true,
            autoDismiss: false,
        },
        trigger: null,
    });
}

/**
 * Cancel the ongoing notification (when delivery is complete)
 */
export async function cancelOngoingNotification(): Promise<void> {
    if (ongoingNotificationId) {
        await Notifications.cancelScheduledNotificationAsync(ongoingNotificationId);
        ongoingNotificationId = null;
    }
}

/**
 * Cancel all scheduled notifications
 */
export async function cancelAllNotifications(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
    ongoingNotificationId = null;
}

// Delivery status types
export type DeliveryStatus =
    | 'RIDER_ASSIGNED'
    | 'EN_ROUTE_TO_PICKUP'
    | 'AT_PICKUP'
    | 'IN_TRANSIT'
    | 'ARRIVED'
    | 'COMPLETED';

/**
 * Get notification title and body based on delivery status
 */
function getStatusContent(status: DeliveryStatus, additionalInfo?: string): { title: string; body: string } {
    switch (status) {
        case 'RIDER_ASSIGNED':
            return {
                title: '✅ Rider Assigned',
                body: additionalInfo || 'A rider has accepted your order!',
            };
        case 'EN_ROUTE_TO_PICKUP':
            return {
                title: '🏍️ Rider on the way',
                body: additionalInfo || 'Rider is heading to pickup location',
            };
        case 'AT_PICKUP':
            return {
                title: '📍 Rider at Pickup',
                body: additionalInfo || 'Rider has arrived at pickup point',
            };
        case 'IN_TRANSIT':
            return {
                title: '🚀 Package in Transit',
                body: additionalInfo || 'Rider is on the way to destination',
            };
        case 'ARRIVED':
            return {
                title: '🎉 Rider Arrived!',
                body: additionalInfo || 'Rider has arrived at your location',
            };
        case 'COMPLETED':
            return {
                title: '✅ Delivery Complete',
                body: additionalInfo || 'Your package has been delivered successfully!',
            };
        default:
            return {
                title: 'Delivery Update',
                body: additionalInfo || 'Status updated',
            };
    }
}

/**
 * Add notification response listener
 */
export function addNotificationResponseListener(
    callback: (response: any) => void
): { remove: () => void } {
    if (!Notifications || !checkNotificationsAvailable()) {
        return { remove: () => { } };
    }
    return Notifications.addNotificationResponseReceivedListener(callback);
}

/**
 * Add notification received listener (when app is in foreground)
 */
export function addNotificationReceivedListener(
    callback: (notification: any) => void
): { remove: () => void } {
    if (!Notifications || !checkNotificationsAvailable()) {
        // Return a dummy subscription for Expo Go
        return { remove: () => { } };
    }
    return Notifications.addNotificationReceivedListener(callback);
}
