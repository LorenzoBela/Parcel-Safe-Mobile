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
import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';
import { supabase } from './supabaseClient';

// Notifee channel IDs — these must be created via notifee.createChannel() so that
// notifee.displayNotification + fullScreenAction works reliably on all OEMs.
// (expo-notifications and notifee share the same Android system channels, but notifee
//  needs its own createChannel call to track them internally.)
const NOTIFEE_INCOMING_ORDER_CHANNEL = 'incoming-order-notifee';
const NOTIFEE_DELIVERY_STATUS_CHANNEL = 'delivery-status-notifee';
const NOTIFEE_SECURITY_ALERTS_CHANNEL = 'security-alerts-notifee';
const NOTIFEE_CANCELLATION_CHANNEL = 'cancellation-notifee';

// Maps every channelId the server might send → the matching notifee-registered channel.
// This handles both the current v2 IDs and any legacy IDs still in flight.
const CHANNEL_TO_NOTIFEE: Record<string, string> = {
    'incoming-order-v2': NOTIFEE_INCOMING_ORDER_CHANNEL,
    'incoming-order': NOTIFEE_INCOMING_ORDER_CHANNEL,
    'delivery-status-v2': NOTIFEE_DELIVERY_STATUS_CHANNEL,
    'delivery-status': NOTIFEE_DELIVERY_STATUS_CHANNEL,
    'security-alerts-v2': NOTIFEE_SECURITY_ALERTS_CHANNEL,
    'security-alerts': NOTIFEE_SECURITY_ALERTS_CHANNEL,
    'cancellation-v2': NOTIFEE_CANCELLATION_CHANNEL,
    'cancellation': NOTIFEE_CANCELLATION_CHANNEL,
};
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

// Notification channels for Android (required for Android 8+)
// NOTE: Android channel importance is immutable after creation — bump the version suffix
// (e.g. promotions-v2 → promotions-v3) whenever importance/sound settings change.
export const NOTIFICATION_CHANNELS = {
    INCOMING_ORDER: 'incoming-order-v2',   // v2: lockscreenVisibility PUBLIC + bypassDnd
    DELIVERY_STATUS: 'delivery-status-v2',  // v2: lockscreenVisibility PUBLIC + bypassDnd
    ONGOING_DELIVERY: 'ongoing-delivery',
    SECURITY_ALERTS: 'security-alerts-v2',  // v2: lockscreenVisibility PUBLIC + bypassDnd
    CANCELLATION: 'cancellation-v2',        // v2: lockscreenVisibility PUBLIC + bypassDnd
    PROMOTIONS: 'promotions-v2',            // v2: bumped to HIGH so promos show outside the app
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
        // Notifee channels — all created here so notifee.displayNotification +
        // fullScreenAction (screen-wake) works reliably for every notification type.
        // expo-notifications does not support fullScreenIntent; notifee does.
        try {
            await notifee.createChannel({
                id: NOTIFEE_INCOMING_ORDER_CHANNEL,
                name: 'Incoming Orders (Wake Screen)',
                importance: AndroidImportance.HIGH,
                vibration: true,
                vibrationPattern: [0, 400, 200, 400, 200, 400],
                sound: 'default',
                visibility: AndroidVisibility.PUBLIC,
                bypassDnd: true,
            });
            await notifee.createChannel({
                id: NOTIFEE_DELIVERY_STATUS_CHANNEL,
                name: 'Delivery Status (Wake Screen)',
                importance: AndroidImportance.HIGH,
                vibration: true,
                vibrationPattern: [0, 300, 200, 300],
                sound: 'default',
                visibility: AndroidVisibility.PUBLIC,
                bypassDnd: true,
            });
            await notifee.createChannel({
                id: NOTIFEE_SECURITY_ALERTS_CHANNEL,
                name: 'Security Alerts (Wake Screen)',
                importance: AndroidImportance.HIGH,
                vibration: true,
                vibrationPattern: [0, 500, 250, 500, 250, 500],
                sound: 'default',
                visibility: AndroidVisibility.PUBLIC,
                bypassDnd: true,
            });
            await notifee.createChannel({
                id: NOTIFEE_CANCELLATION_CHANNEL,
                name: 'Order Cancellations (Wake Screen)',
                importance: AndroidImportance.HIGH,
                vibration: true,
                vibrationPattern: [0, 300, 200, 300],
                sound: 'default',
                visibility: AndroidVisibility.PUBLIC,
                bypassDnd: true,
            });
        } catch { /* ignore on non-Android or if already exists */ }

        // expo-notifications channel kept for fallback / non-Android platforms.
        // The old 'incoming-order' channel lacked lockscreenVisibility and bypassDnd;
        // those settings are immutable after creation, so we delete it and recreate as v2.
        try { await Notifications.deleteNotificationChannelAsync('incoming-order'); } catch { /* ignore */ }
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.INCOMING_ORDER, {
            name: 'Incoming Orders',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 400, 200, 400, 200, 400], // long aggressive pattern
            lightColor: '#FF6B00',
            sound: 'default',
            enableVibrate: true,
            showBadge: true,
            // CRITICAL for lock-screen wake: show full notification content on lock screen
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            // Bypass Do Not Disturb — riders must hear new orders even with DND on
            bypassDnd: true,
        });

        // Status updates channel — v2: added lockscreenVisibility + bypassDnd
        try { await Notifications.deleteNotificationChannelAsync('delivery-status'); } catch { /* ignore */ }
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.DELIVERY_STATUS, {
            name: 'Delivery Status',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 300, 200, 300],
            sound: 'default',
            enableVibrate: true,
            showBadge: true,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            bypassDnd: true,
        });

        // Ongoing delivery channel (for persistent notifications)
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.ONGOING_DELIVERY, {
            name: 'Ongoing Delivery',
            importance: Notifications.AndroidImportance.LOW,
            sound: null,
        });

        // Security alerts channel (tamper, theft, geofence) — v2: added lockscreenVisibility + bypassDnd
        try { await Notifications.deleteNotificationChannelAsync('security-alerts'); } catch { /* ignore */ }
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.SECURITY_ALERTS, {
            name: 'Security Alerts',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 500, 250, 500, 250, 500],
            lightColor: '#FF0000',
            sound: 'default',
            enableVibrate: true,
            showBadge: true,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            bypassDnd: true,
        });

        // Cancellation channel — v2: added lockscreenVisibility + bypassDnd
        try { await Notifications.deleteNotificationChannelAsync('cancellation'); } catch { /* ignore */ }
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.CANCELLATION, {
            name: 'Order Cancellations',
            importance: Notifications.AndroidImportance.HIGH,
            sound: 'default',
            enableVibrate: true,
            vibrationPattern: [0, 300, 200, 300],
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            bypassDnd: true,
        });

        // Promotions channel — HIGH importance so the banner actually appears outside the app.
        // The old 'promotions' channel (LOW) is deleted first because Android channel importance
        // cannot be changed after creation; we use a new ID ('promotions-v2') instead.
        try { await Notifications.deleteNotificationChannelAsync('promotions'); } catch { /* ignore */ }
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.PROMOTIONS, {
            name: 'Promotions & Offers',
            importance: Notifications.AndroidImportance.HIGH,
            sound: 'default',
            vibrationPattern: [0, 250],
            enableVibrate: true,
            enableLights: true,
            lightColor: '#FF6B00',
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

        // Register token to server-side devices table
        await registerTokenWithServer(fcmToken);

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

        // Setup FCM background message handler
        setupFCMBackgroundHandler();

        return fcmToken;
    } catch (error) {
        console.warn('Failed to register for push notifications:', error);
        nativeNotificationsAvailable = false;
        return 'SIMULATED_TOKEN_DEV';
    }
}

/**
 * Register FCM token with the server-side devices table.
 * This enables the server to send push notifications to this device.
 */
async function registerTokenWithServer(fcmToken: string): Promise<void> {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            console.warn('[FCM] No authenticated user, skipping server registration');
            return;
        }

        // Get the API base URL from environment (hardcoded fallback matches production URL)
        const apiBaseUrl = process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL
            || process.env.EXPO_PUBLIC_API_URL
            || 'https://parcel-safe.vercel.app';

        const response = await fetch(`${apiBaseUrl}/api/notifications/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: user.id,
                fcmToken,
                platform: Platform.OS, // 'android' or 'ios'
            }),
        });

        if (response.ok) {
            console.log('[FCM] Token registered with server');
        } else {
            console.warn('[FCM] Server token registration failed:', response.status);
        }
    } catch (error) {
        console.warn('[FCM] Failed to register token with server:', error);
    }
}

/**
 * Setup FCM background message handler.
 * Fires when a data message arrives while the app is in background/killed.
 */
function setupFCMBackgroundHandler(): void {
    if (!messaging) return;

    try {
        messaging().setBackgroundMessageHandler(async (remoteMessage: any) => {
            console.log('[FCM] Background message:', remoteMessage);

            // FCM data messages need to be shown as local notifications
            const data = remoteMessage.data || {};
            const title = remoteMessage.notification?.title || data.title || 'Parcel Safe';
            const body = remoteMessage.notification?.body || data.body || 'You have a new notification.';
            const channelId = data.channelId || NOTIFICATION_CHANNELS.DELIVERY_STATUS;

            // EC-FIX: Ignore stale background messages queued up by FCM
            // If the device was offline when the push was sent, FCM will hold it and deliver
            // it all at once when connecting. We ignore messages older than 5 minutes.
            if (remoteMessage.sentTime) {
                const ageMs = Date.now() - remoteMessage.sentTime;
                if (ageMs > 5 * 60 * 1000) { // 5 minutes
                    console.log(`[FCM] Ignoring stale background message (age: ${Math.round(ageMs / 1000)}s):`, title);
                    return;
                }
            }

            if (checkNotificationsAvailable()) {
                await scheduleWakingNotification(title, body, data, channelId);
            }
        });
    } catch (error) {
        console.warn('[FCM] Failed to set background handler:', error);
    }
}

/**
 * Setup FCM foreground message handler.
 * Shows a local notification when a push arrives while app is open.
 */
export function setupFCMForegroundHandler(): () => void {
    if (!messaging) return () => { };

    try {
        const unsubscribe = messaging().onMessage(async (remoteMessage: any) => {
            console.log('[FCM] Foreground message:', remoteMessage);

            const data = remoteMessage.data || {};
            const title = remoteMessage.notification?.title || data.title || 'Parcel Safe';
            const body = remoteMessage.notification?.body || data.body || 'You have a new notification.';
            const channelId = data.channelId || NOTIFICATION_CHANNELS.DELIVERY_STATUS;

            // EC-FIX: Ignore stale foreground messages queued up by FCM
            // If the app is launched and registers for messaging(), FCM may flush old
            // pending messages. We ignore messages older than 5 minutes.
            if (remoteMessage.sentTime) {
                const ageMs = Date.now() - remoteMessage.sentTime;
                if (ageMs > 5 * 60 * 1000) { // 5 minutes
                    console.log(`[FCM] Ignoring stale foreground message (age: ${Math.round(ageMs / 1000)}s):`, title);
                    return;
                }
            }

            if (checkNotificationsAvailable()) {
                await scheduleWakingNotification(title, body, data, channelId);
            }

            // When customer receives ORDER_ACCEPTED foreground push, schedule 2-hr reminder
            if (data.type === 'ORDER_ACCEPTED') {
                await scheduleDeliveryReminderNotification(
                    data.riderName || 'Your rider',
                    data.deliveryId
                );
            }
        });

        return unsubscribe;
    } catch (error) {
        console.warn('[FCM] Failed to set foreground handler:', error);
        return () => { };
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
 * Internal helper to schedule a notification that can wake the screen on Android.
 */
async function scheduleWakingNotification(title: string, body: string, data: any, channelId: string): Promise<string> {
    if (Platform.OS === 'android') {
        try {
            // Always use a notifee-registered channel so fullScreenAction (screen wake)
            // is guaranteed. Fall back to delivery-status if the ID is unrecognised.
            const notifeeChannelId = CHANNEL_TO_NOTIFEE[channelId] ?? NOTIFEE_DELIVERY_STATUS_CHANNEL;
            await notifee.displayNotification({
                title,
                body,
                data,
                android: {
                    channelId: notifeeChannelId,
                    importance: AndroidImportance.HIGH,
                    pressAction: { id: 'default' },
                    // fullScreenAction turns the screen on from the lock screen.
                    // Requires USE_FULL_SCREEN_INTENT permission (declared in app.json).
                    fullScreenAction: { id: 'default' },
                    showTimestamp: true,
                },
            });
            return 'NOTIFEE_NOTIF_ID';
        } catch (error) {
            console.warn('[scheduleWakingNotification] notifee failed, falling back to expo:', error);
        }
    }

    // iOS or Android fallback
    const id = await Notifications.scheduleNotificationAsync({
        content: {
            title,
            body,
            data,
            sound: 'default',
        },
        trigger: Platform.OS === 'android' ? { channelId } as any : null,
    });
    return id;
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
    // Gate behind user preference
    if (!(await isNotificationCategoryEnabled('rider_alerts'))) {
        console.log('[NotifPrefs] rider_alerts disabled, skipping incoming order notification');
        return 'PREF_DISABLED';
    }

    if (!checkNotificationsAvailable()) {
        console.log(`[DEV NOTIFICATION] 🚀 New Order Request!\nPickup: ${pickupAddress}\nFare: ₱${estimatedFare.toFixed(2)}`);
        return 'SIMULATED_NOTIF_ID';
    }

    // Use notifee on Android for fullScreenAction — this is the ONLY way to wake
    // the screen from a locked state. expo-notifications does not support this.
    if (Platform.OS === 'android') {
        try {
            await notifee.displayNotification({
                title: '🚀 New Order Request!',
                body: `Pickup: ${pickupAddress}\nDropoff: ${dropoffAddress}\nFare: ₱${estimatedFare.toFixed(2)}`,
                data: { bookingId, type: 'INCOMING_ORDER' },
                android: {
                    channelId: NOTIFEE_INCOMING_ORDER_CHANNEL,
                    importance: AndroidImportance.HIGH,
                    sound: 'default',
                    vibrationPattern: [0, 400, 200, 400, 200, 400],
                    // fullScreenAction launches the app over the lock screen and TURNS THE SCREEN ON.
                    // Requires USE_FULL_SCREEN_INTENT permission in app.json.
                    fullScreenAction: { id: 'default' },
                    pressAction: { id: 'default' },
                },
            });
            return 'NOTIFEE_NOTIF';
        } catch (error) {
            console.warn('[showIncomingOrderNotification] notifee failed, falling back to expo:', error);
        }
    }

    // iOS / fallback for Android if notifee fails
    try {
        const notificationId = await Notifications.scheduleNotificationAsync({
            content: {
                title: '🚀 New Order Request!',
                body: `Pickup: ${pickupAddress}\nDropoff: ${dropoffAddress}\nFare: ₱${estimatedFare.toFixed(2)}`,
                data: { bookingId, type: 'INCOMING_ORDER' },
                sound: 'default',
                priority: Notifications.AndroidNotificationPriority.MAX,
                vibrate: [0, 400, 200, 400, 200, 400],
            },
            trigger: Platform.OS === 'android'
                ? { channelId: NOTIFICATION_CHANNELS.INCOMING_ORDER } as any
                : null,
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
    // Gate behind user preference
    if (!(await isNotificationCategoryEnabled('delivery_updates'))) {
        console.log('[NotifPrefs] delivery_updates disabled, skipping status notification');
        return 'PREF_DISABLED';
    }

    if (!nativeNotificationsAvailable) {
        console.log(`[DEV NOTIFICATION] ${title}: ${body}`);
        return 'SIMULATED_NOTIF_ID';
    }

    try {
        const notificationId = await scheduleWakingNotification(
            title,
            body,
            { ...data, type: 'STATUS_UPDATE' },
            NOTIFICATION_CHANNELS.DELIVERY_STATUS
        );
        return notificationId;
    } catch (error) {
        console.warn('Failed to show status notification:', error);
        return 'FAILED_NOTIF_ID';
    }
}

/**
 * Show a security alert notification (tamper, theft, geofence breach).
 * Uses the security-alerts channel with MAX importance + screen wake.
 */
export async function showSecurityNotification(
    title: string,
    body: string,
    data?: Record<string, any>
): Promise<string> {
    if (!nativeNotificationsAvailable) {
        console.log(`[DEV SECURITY NOTIFICATION] ${title}: ${body}`);
        return 'SIMULATED_NOTIF_ID';
    }

    try {
        const notificationId = await scheduleWakingNotification(
            title,
            body,
            { ...data, type: 'SECURITY_ALERT' },
            NOTIFICATION_CHANNELS.SECURITY_ALERTS
        );
        return notificationId;
    } catch (error) {
        console.warn('Failed to show security notification:', error);
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

/** Storage key used to track the currently pending 2-hour reminder per delivery */
const REMINDER_NOTIF_KEY = 'delivery_reminder_notif_id';

/**
 * Schedule a local "delivery soon" reminder for 2 hours from now.
 * Fires even if the app is killed — the OS owns the alarm.
 * Call this on both the customer and rider devices when an order is accepted.
 *
 * @param riderName  Rider display name (shown in the notification body)
 * @param deliveryId Used to cancel the reminder if the order is cancelled early
 */
export async function scheduleDeliveryReminderNotification(
    riderName: string,
    deliveryId?: string
): Promise<void> {
    if (!checkNotificationsAvailable()) {
        console.log('[DEV] 2-hour reminder scheduled (simulated)');
        return;
    }

    try {
        // Cancel any existing reminder first (avoid double-scheduling on retry)
        const existingId = await AsyncStorage.getItem(REMINDER_NOTIF_KEY);
        if (existingId) {
            try { await Notifications.cancelScheduledNotificationAsync(existingId); } catch { /* ignore */ }
        }

        const notifId = await Notifications.scheduleNotificationAsync({
            content: {
                title: '📦 Delivery Reminder',
                body: `${riderName || 'Your rider'} is on the way — your parcel should arrive soon!`,
                data: { type: 'DELIVERY_REMINDER', deliveryId: deliveryId || '' },
                sound: 'default',
                channelId: NOTIFICATION_CHANNELS.DELIVERY_STATUS,
            },
            trigger: {
                seconds: 2 * 60 * 60, // 2 hours
                channelId: NOTIFICATION_CHANNELS.DELIVERY_STATUS,
            } as any,
        });

        await AsyncStorage.setItem(REMINDER_NOTIF_KEY, notifId);
        console.log('[Notification] 2-hour delivery reminder scheduled:', notifId);
    } catch (error) {
        console.warn('[Notification] Failed to schedule 2-hour reminder:', error);
    }
}

/**
 * Cancel the previously scheduled 2-hour delivery reminder (e.g. on cancellation).
 */
export async function cancelDeliveryReminderNotification(): Promise<void> {
    try {
        const notifId = await AsyncStorage.getItem(REMINDER_NOTIF_KEY);
        if (notifId) {
            await Notifications.cancelScheduledNotificationAsync(notifId);
            await AsyncStorage.removeItem(REMINDER_NOTIF_KEY);
            console.log('[Notification] 2-hour delivery reminder cancelled');
        }
    } catch (error) {
        console.warn('[Notification] Failed to cancel 2-hour reminder:', error);
    }
}

// Delivery status types — covers all Firebase delivery states used across the app
export type DeliveryStatus =
    | 'RIDER_ASSIGNED'
    | 'EN_ROUTE_TO_PICKUP'
    | 'AT_PICKUP'
    | 'PENDING'
    | 'ASSIGNED'
    | 'PICKED_UP'
    | 'IN_TRANSIT'
    | 'ARRIVED'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'RETURNING'
    | 'RETURNED'
    | 'TAMPERED'
    | 'FAILED';

/**
 * Get notification title and body based on delivery status
 */
function getStatusContent(status: DeliveryStatus, additionalInfo?: string): { title: string; body: string } {
    switch (status) {
        case 'RIDER_ASSIGNED':
        case 'ASSIGNED':
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
        case 'PICKED_UP':
            return {
                title: '📦 Package Picked Up',
                body: additionalInfo || 'Rider has collected your package',
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
        case 'CANCELLED':
            return {
                title: '❌ Delivery Cancelled',
                body: additionalInfo || 'Your delivery has been cancelled.',
            };
        case 'RETURNING':
            return {
                title: '↩️ Package Returning',
                body: additionalInfo || 'Rider is returning the package to sender.',
            };
        case 'RETURNED':
            return {
                title: '↩️ Package Returned',
                body: additionalInfo || 'Package has been returned to sender.',
            };
        case 'TAMPERED':
            return {
                title: '⚠️ Security Alert',
                body: additionalInfo || 'Tamper detected on your package!',
            };
        case 'FAILED':
            return {
                title: '⚠️ Delivery Failed',
                body: additionalInfo || 'Delivery attempt failed. Please contact support.',
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

// ─── Notification Preference Helpers ────────────────────────────────────────────

/** Default preferences – must match the DB column default */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
    delivery_updates: true,
    rider_alerts: true,
    security: true,
    promotions: true,
};

export interface NotificationPreferences {
    delivery_updates: boolean;
    rider_alerts: boolean;
    security: boolean;     // always true – UI should lock this
    promotions: boolean;
}

const PREFS_CACHE_KEY = '@notification_preferences';

/**
 * Load notification preferences (local cache → Supabase fallback).
 */
export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
    try {
        // Try local cache first for speed
        const cached = await AsyncStorage.getItem(PREFS_CACHE_KEY);
        if (cached) return { ...DEFAULT_NOTIFICATION_PREFS, ...JSON.parse(cached) };

        // Fallback: fetch from Supabase
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return DEFAULT_NOTIFICATION_PREFS;

        const { data } = await supabase
            .from('profiles')
            .select('notification_preferences')
            .eq('id', user.id)
            .single();

        const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(data?.notification_preferences || {}) };
        // Security cannot be disabled
        prefs.security = true;
        await AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(prefs));
        return prefs;
    } catch (error) {
        console.warn('[NotifPrefs] Failed to load preferences:', error);
        return DEFAULT_NOTIFICATION_PREFS;
    }
}

/**
 * Check if a specific notification category is enabled.
 */
export async function isNotificationCategoryEnabled(
    category: keyof NotificationPreferences
): Promise<boolean> {
    // Security is always enabled regardless of user setting
    if (category === 'security') return true;
    const prefs = await loadNotificationPreferences();
    return prefs[category] ?? true;
}

/**
 * Update a single notification preference and persist to Supabase + local cache.
 */
export async function updateNotificationPreference(
    category: keyof NotificationPreferences,
    enabled: boolean
): Promise<boolean> {
    // Security cannot be disabled
    if (category === 'security' && !enabled) return false;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return false;

        // Load current prefs, apply change
        const prefs = await loadNotificationPreferences();
        prefs[category] = enabled;

        // Persist to Supabase
        const { error } = await supabase
            .from('profiles')
            .update({
                notification_preferences: prefs,
                updated_at: new Date().toISOString(),
            })
            .eq('id', user.id);

        if (error) {
            console.error('[NotifPrefs] Supabase update failed:', error.message);
            return false;
        }

        // Update local cache
        await AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(prefs));
        console.log(`[NotifPrefs] ${category} set to ${enabled}`);
        return true;
    } catch (error) {
        console.error('[NotifPrefs] Failed to update preference:', error);
        return false;
    }
}

/**
 * Clear the local preference cache (call on logout).
 */
export async function clearNotificationPreferencesCache(): Promise<void> {
    await AsyncStorage.removeItem(PREFS_CACHE_KEY);
}
