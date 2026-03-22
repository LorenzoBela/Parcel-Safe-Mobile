/**
 * Scheduled Promo Notification Service for Parcel-Safe
 *
 * Fires a random promotional ad every 2 hours from 6 AM to midnight
 * entirely on-device via expo-notifications — no server or cron needed.
 *
 * Pattern mirrors Noots School Tracker's scheduledNotifications.ts:
 *  - `schedulePromoNotifications()` registers daily recurring triggers at
 *    hours [6, 8, 10, 12, 14, 16, 18, 20, 22, 0] (12 AM)
 *  - `performPromoSmartCheck()` fires an immediate local notification on
 *    app-foreground if the 110-minute cooldown has expired
 *  - AppState listener triggers the smart-check every time the app resumes
 */

import { Platform, AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NOTIFICATION_CHANNELS, isNotificationCategoryEnabled } from './pushNotificationService';

const LAST_PROMO_KEY = '@last_promo_notification';
// 110 minutes — prevents double-fire on adjacent hourly slots
const MIN_PROMO_INTERVAL_MS = 110 * 60 * 1000;

// Every 2 hours, 6 AM – midnight (hour 0 = 12:00 AM)
const PROMO_HOURS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 0];

// Lazy-loaded to match the rest of the app's native-module pattern
let Notifications: any = null;

function loadNotifications(): any {
    if (Notifications) return Notifications;
    try {
        Notifications = require('expo-notifications');
    } catch {
        Notifications = null;
    }
    return Notifications;
}

// ============ Active hours guard ============

function isWithinPromoHours(): boolean {
    const hour = new Date().getHours();
    // Block 1 AM – 5 AM; allow everything else (6 AM–23 and midnight/0)
    return !(hour >= 1 && hour <= 5);
}

// ============ Promo Ad Pool ============

interface PromoAd {
    title: string;
    body: string;
}

// Kept in sync with web/src/lib/notificationService.ts PROMO_ADS
const PROMO_ADS: PromoAd[] = [
    {
        title: '📦 Need something delivered?',
        body: 'Parcel Safe — fast, secure, tamper-proof delivery at your fingertips!',
    },
    {
        title: '🔒 Your parcels, always protected',
        body: 'Real-time GPS tracking & tamper detection. Ship with confidence!',
    },
    {
        title: '🚀 Deliver smarter, not harder',
        body: 'Parcel Safe riders earn more with our smart matching system. Go online now!',
    },
    {
        title: '📍 Track every step of the way',
        body: 'Know exactly where your package is. Try Parcel Safe today!',
    },
    {
        title: '💰 Earn on your own schedule',
        body: 'Become a Parcel Safe rider — flexible hours, great pay!',
    },
    {
        title: '🛡️ Security you can trust',
        body: 'Tamper-proof smart box + photo verification. Only on Parcel Safe.',
    },
    {
        title: '🎁 Send with peace of mind',
        body: 'OTP-secured delivery ensures only the right person opens your parcel.',
    },
    {
        title: '⚡ Lightning-fast local delivery',
        body: 'Same-city delivery in minutes. Download Parcel Safe now!',
    },
];

function getRandomPromoAd(): PromoAd {
    return PROMO_ADS[Math.floor(Math.random() * PROMO_ADS.length)];
}

// ============ Cooldown check ============

async function shouldSendPromo(): Promise<boolean> {
    try {
        const lastStr = await AsyncStorage.getItem(LAST_PROMO_KEY);
        if (!lastStr) return true;
        return Date.now() - parseInt(lastStr, 10) >= MIN_PROMO_INTERVAL_MS;
    } catch {
        return true;
    }
}

// ============ Immediate smart-check notification ============

async function performPromoSmartCheck(): Promise<void> {
    if (!isWithinPromoHours()) return;
    if (!(await isNotificationCategoryEnabled('promotions'))) return;
    if (!(await shouldSendPromo())) return;

    const notifs = loadNotifications();
    if (!notifs) return;

    const ad = getRandomPromoAd();
    try {
        await notifs.scheduleNotificationAsync({
            content: {
                title: ad.title,
                body: ad.body,
                sound: 'default',
                data: { type: 'PROMO' },
            },
            trigger: Platform.OS === 'android'
                ? { channelId: NOTIFICATION_CHANNELS.PROMOTIONS }
                : null,
        });
        await AsyncStorage.setItem(LAST_PROMO_KEY, Date.now().toString());
        if (__DEV__) console.log('[ScheduledPromo] Smart-check promo fired:', ad.title);
    } catch (error) {
        console.error('[ScheduledPromo] Failed to send smart-check promo:', error);
    }
}

// ============ Schedule daily recurring promos ============

let isScheduling = false;

async function schedulePromoNotifications(): Promise<void> {
    if (isScheduling) return;

    const notifs = loadNotifications();
    if (!notifs) return;

    isScheduling = true;
    try {
        // Cancel only existing promo scheduled notifications — leave delivery reminders untouched
        const scheduled = await notifs.getAllScheduledNotificationsAsync();
        const promoIds: string[] = scheduled
            .filter((n: any) => n.content?.data?.type === 'PROMO_SCHEDULED')
            .map((n: any) => n.identifier);

        await Promise.all(
            promoIds.map((id: string) => notifs.cancelScheduledNotificationAsync(id))
        );

        // Schedule one promo per target hour, repeating daily
        for (const hour of PROMO_HOURS) {
            const ad = getRandomPromoAd();
            await notifs.scheduleNotificationAsync({
                content: {
                    title: ad.title,
                    body: ad.body,
                    sound: 'default',
                    data: { type: 'PROMO_SCHEDULED' },
                },
                trigger: {
                    type: 'daily' as any,
                    hour,
                    minute: 0,
                    ...(Platform.OS === 'android' && {
                        channelId: NOTIFICATION_CHANNELS.PROMOTIONS,
                    }),
                },
            });
        }

        if (__DEV__) {
            console.log(`[ScheduledPromo] Scheduled ${PROMO_HOURS.length} daily promo slots`);
        }
    } catch (error) {
        console.error('[ScheduledPromo] Error scheduling promos:', error);
    } finally {
        isScheduling = false;
    }
}

// ============ AppState listener ============

let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

function setupPromoAppStateListener(): void {
    if (appStateSubscription) return;

    appStateSubscription = AppState.addEventListener(
        'change',
        (nextAppState: AppStateStatus) => {
            if (nextAppState === 'active') {
                // App came to foreground — fire immediately if cooldown passed
                performPromoSmartCheck().catch(console.error);
            }
        }
    );
}

// ============ Public API ============

/**
 * Initialize scheduled promo notifications.
 * Call once per app session after the user is authenticated.
 */
export async function initializeScheduledPromos(): Promise<void> {
    const notifs = loadNotifications();
    if (!notifs) {
        if (__DEV__) console.log('[ScheduledPromo] expo-notifications not available, skipping');
        return;
    }

    // Respect user's promotions preference
    if (!(await isNotificationCategoryEnabled('promotions'))) {
        if (__DEV__) console.log('[ScheduledPromo] Promotions disabled by user, skipping');
        return;
    }

    await schedulePromoNotifications();
    setupPromoAppStateListener();
    // Immediate check in case cooldown already expired on app open
    await performPromoSmartCheck();

    if (__DEV__) console.log('[ScheduledPromo] Initialized');
}

/**
 * Cancel all scheduled promo notifications and tear down the AppState listener.
 * Call when the user disables notifications.
 */
export async function cancelScheduledPromos(): Promise<void> {
    const notifs = loadNotifications();
    if (!notifs) return;

    try {
        const scheduled = await notifs.getAllScheduledNotificationsAsync();
        const promoIds: string[] = scheduled
            .filter((n: any) => n.content?.data?.type === 'PROMO_SCHEDULED')
            .map((n: any) => n.identifier);

        await Promise.all(
            promoIds.map((id: string) => notifs.cancelScheduledNotificationAsync(id))
        );
    } catch (error) {
        console.error('[ScheduledPromo] Error cancelling promos:', error);
    }

    if (appStateSubscription) {
        appStateSubscription.remove();
        appStateSubscription = null;
    }
}

/**
 * Re-schedule promos (call when the user re-enables notifications).
 */
export async function reschedulePromos(): Promise<void> {
    await schedulePromoNotifications();
    setupPromoAppStateListener();
}
