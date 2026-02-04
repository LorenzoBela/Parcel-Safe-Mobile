import { registerRootComponent } from 'expo';

import App from './App';

// ==================== Background FCM Handler ====================
// This must be registered outside of the app component for background/quit state messages

let messaging = null;
let BackgroundFetch = null;

try {
    messaging = require('@react-native-firebase/messaging').default;
    BackgroundFetch = require('react-native-background-fetch').default;
    
    const { handleBackgroundMessage } = require('./src/services/backgroundServiceManager');

    messaging().setBackgroundMessageHandler(async remoteMessage => {
        console.log('[FCM] Background message received:', remoteMessage);
        
        // Handle the message using the background service manager
        await handleBackgroundMessage(remoteMessage);
    });

    // ==================== Background Fetch Handler (Android Headless) ====================
    // This runs when the app is terminated and background fetch triggers

    BackgroundFetch.registerHeadlessTask(async (event) => {
        console.log('[BackgroundFetch] Headless task started:', event.taskId);
        
        try {
            // Perform background work (e.g., check for new orders)
            console.log('[BackgroundFetch] Checking for updates...');
            
            // Finish the task
            BackgroundFetch.finish(event.taskId);
        } catch (error) {
            console.error('[BackgroundFetch] Headless task error:', error);
            BackgroundFetch.finish(event.taskId);
        }
    });
} catch (error) {
    console.log('[Index] Native modules not available - requires dev build');
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
