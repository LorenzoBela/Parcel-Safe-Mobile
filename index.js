import { registerRootComponent } from 'expo';

// CRITICAL: TaskManager.defineTask() MUST run at the top level of the entry point.
// expo-location's native foreground service survives phone lock, but the JS runtime
// can be killed. When the OS restarts JS to deliver a background location event, this
// import ensures the task handler is immediately registered — without it, location
// updates are silently dropped even though the "Tracking your location" notification
// is still visible on the lock screen.
import './src/services/backgroundLocationService';

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
queueMicrotask(initializeNativeHandlers);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
