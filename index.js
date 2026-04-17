import { registerRootComponent } from 'expo';

// CRITICAL: TaskManager.defineTask() MUST run at the top level of the entry point.
// expo-location's native foreground service survives phone lock, but the JS runtime
// can be killed. When the OS restarts JS to deliver a background location event, this
// import ensures the task handler is immediately registered — without it, location
// updates are silently dropped even though the "Tracking your location" notification
// is still visible on the lock screen.
let hasLoadedBackgroundLocationTask = false;
const loadBackgroundLocationTask = () => {
    if (hasLoadedBackgroundLocationTask) return true;
    try {
        require('./src/services/backgroundLocationService');
        hasLoadedBackgroundLocationTask = true;
        return true;
    } catch (error) {
        if (__DEV__) console.log('[Index] backgroundLocationService not ready during early init, will retry');
        return false;
    }
};

loadBackgroundLocationTask();

import App from './App';

// ==================== Background FCM Handler ====================
// This must be registered outside of the app component for background/quit state messages

let messaging = null;
let BackgroundFetch = null;

// Defer native module loading to not block bundle execution
const initializeNativeHandlers = () => {
    try {
        messaging = require('@react-native-firebase/messaging').default;
        BackgroundFetch = require('react-native-background-fetch').default;

        const { handleBackgroundMessage } = require('./src/services/backgroundServiceManager');

        if (messaging && typeof messaging === 'function') {
            messaging().setBackgroundMessageHandler(async remoteMessage => {
                if (__DEV__) console.log('[FCM] Background message received');
                await handleBackgroundMessage(remoteMessage);
            });
        }

        // ==================== Notifee Background Event Handler ====================
        // Notifee fires its own events when the user taps a notifee-generated
        // notification (e.g. the wake-screen incoming order banner). Must be
        // registered at module level so the JS runtime wakes up and routes the
        // tap even when the app was previously killed.
        try {
            const notifee = require('@notifee/react-native').default;
            const { EventType } = require('@notifee/react-native');
            if (notifee && typeof notifee.onBackgroundEvent === 'function') {
                notifee.onBackgroundEvent(async ({ type, detail }) => {
                    if (type !== EventType.PRESS && type !== EventType.ACTION_PRESS) return;
                    try {
                        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
                        const data = detail?.notification?.data || {};
                        // Stash the tap for the App component to consume once
                        // navigation is ready (cold-start deep-link recovery).
                        if (AsyncStorage) {
                            await AsyncStorage.setItem(
                                '@pending_notification_tap',
                                JSON.stringify(data),
                            );
                        }
                    } catch (err) {
                        if (__DEV__) console.warn('[Notifee BG] tap persist failed:', err);
                    }
                });
            }
        } catch (notifeeError) {
            if (__DEV__) console.log('[Index] notifee not available:', notifeeError?.message);
        }

        // ==================== Background Fetch Handler (Android Headless) ====================
        // This runs when the app is terminated and background fetch triggers

        if (BackgroundFetch && typeof BackgroundFetch.registerHeadlessTask === 'function') {
            BackgroundFetch.registerHeadlessTask(async (event) => {
                if (__DEV__) console.log('[BackgroundFetch] Headless task:', event.taskId);
                try {
                    if (__DEV__) console.log('[BackgroundFetch] Checking for updates...');
                    BackgroundFetch.finish(event.taskId);
                } catch (error) {
                    if (__DEV__) console.error('[BackgroundFetch] Headless task error:', error);
                    BackgroundFetch.finish(event.taskId);
                }
            });
        }
    } catch (error) {
        if (__DEV__) console.log('[Index] Native modules not available - requires dev build');
    }
};

// Initialize after a microtask tick to not block bundle execution
queueMicrotask(() => {
    loadBackgroundLocationTask();
    initializeNativeHandlers();
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
