import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { GluestackUIProvider } from '@gluestack-ui/themed';
import { config } from '@gluestack-ui/config';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppState, Alert } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { configureGoogleSignIn } from './src/services/auth';
import { ThemeProvider, useAppTheme } from './src/context/ThemeContext';

// Conditionally import modules
let Notifications = null;
let initializeBackgroundServices = null;
let onBackgroundEvent = null;
let initializeOrderListener = null;
let onNewOrder = null;

try {
  Notifications = require('expo-notifications');
  const bgService = require('./src/services/backgroundServiceManager');
  const orderService = require('./src/services/orderListenerService');

  initializeBackgroundServices = bgService.initializeBackgroundServices;
  onBackgroundEvent = bgService.onBackgroundEvent;
  initializeOrderListener = orderService.initializeOrderListener;
  onNewOrder = orderService.onNewOrder;

  // Configure notification handler for foreground notifications
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
} catch (error) {
  // if (__DEV__) console.log('[App] Native modules not available - requires dev build');
}

const AppContent = () => {
  const { theme } = useAppTheme();
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => {
    let cleanupFunctions = [];
    let timeoutId = null;

    // Initialize background services when app starts (deferred to not block first render)
    const initializeServices = async () => {
      if (!initializeBackgroundServices) {
        if (__DEV__) console.log('[App] Background services not available - requires dev build');
        return;
      }

      try {
        // if (__DEV__) console.log('[App] Initializing background services...');

        // Initialize background service manager
        await initializeBackgroundServices();

        // Subscribe to background events
        const unsubscribeBackgroundEvents = onBackgroundEvent((type, data) => {
          // if (__DEV__) console.log('[App] Background event:', type);

          if (type === 'order_received') {
            if (__DEV__) console.log('[App] New order received');
          }
        });
        cleanupFunctions.push(unsubscribeBackgroundEvents);

        // Subscribe to new order events
        const unsubscribeOrders = onNewOrder((order) => {
          // if (__DEV__) console.log('[App] New order callback');
        });
        cleanupFunctions.push(unsubscribeOrders);

        // Listen for notification taps
        const notificationResponseSubscription = Notifications.addNotificationResponseReceivedListener(
          (response) => {
            // if (__DEV__) console.log('[App] Notification tapped');
            const data = response.notification.request.content.data;

            if (data.type === 'new_order') {
              // Navigate to order screen
            }
          }
        );
        cleanupFunctions.push(() => notificationResponseSubscription.remove());

        // if (__DEV__) console.log('[App] Background services initialized successfully');
      } catch (error) {
        if (__DEV__) console.error('[App] Failed to initialize background services:', error);

        // Show alert to user about background service failure
        Alert.alert(
          'Background Services',
          'Some background features may not work properly. Please ensure the app has all required permissions.',
          [{ text: 'OK' }]
        );
      }
    };

    // Defer heavy initialization to not block first render
    timeoutId = setTimeout(() => {
      initializeServices();
    }, 100);

    // Monitor app state changes
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.match(/inactive|background/) && nextAppState === 'active') {
        // if (__DEV__) console.log('[App] App has come to the foreground');
      } else if (nextAppState.match(/inactive|background/)) {
        // if (__DEV__) console.log('[App] App has gone to the background');
      }
      setAppState(nextAppState);
    });

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      subscription.remove();
      cleanupFunctions.forEach(cleanup => {
        try {
          if (cleanup) cleanup();
        } catch (error) {
          if (__DEV__) console.error('[App] Cleanup error:', error);
        }
      });
    };
  }, []);

  return (
    <PaperProvider theme={theme}>
      <AppNavigator />
    </PaperProvider>
  );
};

export default function App() {
  useEffect(() => {
    configureGoogleSignIn();
  }, []);

  return (
    <SafeAreaProvider>
      <GluestackUIProvider config={config}>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </GluestackUIProvider>
    </SafeAreaProvider>
  );
}

