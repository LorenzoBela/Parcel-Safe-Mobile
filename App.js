import 'react-native-gesture-handler';
import React, { useEffect, useState, useRef } from 'react';
import { GluestackUIProvider } from '@gluestack-ui/themed';
import { config } from '@gluestack-ui/config';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppState, Alert, StatusBar } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { configureGoogleSignIn } from './src/services/auth';
import { ThemeProvider, useAppTheme } from './src/context/ThemeContext';
import GlobalPremiumAlert from './src/components/modals/GlobalPremiumAlert';
import OTAUpdateModal from './src/components/modals/OTAUpdateModal';
import ResumeScreen from './src/screens/auth/ResumeScreen';
import { useOTAUpdateMonitor } from './src/hooks/useOTAUpdateMonitor';

import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';

// Keep splash screen visible while we initialize
SplashScreen.preventAutoHideAsync();

// Conditionally import modules
let Notifications = null;
let initializeBackgroundServices = null;
let onBackgroundEvent = null;
let initializeOrderListener = null;
let onNewOrder = null;

// Push notification + promo service handles (dev builds only)
let setupNotificationChannels = null;
let registerForPushNotifications = null;
let onTokenRefresh = null;
let setupFCMForegroundHandler = null;
let initializeScheduledPromos = null;
let supabase = null;

const AppContent = () => {
  const { theme, isDarkMode } = useAppTheme();
  const { showModal, handleRestart, handleDismiss, currentlyRunning } = useOTAUpdateMonitor();
  const [appState, setAppState] = useState(AppState.currentState);
  const [isResuming, setIsResuming] = useState(false);
  // Only trigger ResumeScreen when the app truly went to background (not just inactive).
  // inactive alone is caused by notification shade, dropdowns, system dialogs — not a real background trip.
  const wasBackgroundedRef = useRef(false);

  useEffect(() => {
    let cleanupFunctions = [];
    let timeoutId = null;

    // Initialize background services when app starts (deferred to not block first render)
    const initializeServices = async () => {
      // 1. Inline require heavy modules here, AFTER the UI starts rendering
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
            shouldShowBanner: true,  // required on newer Expo SDK to show heads-up banner
            shouldShowList: true,    // required to appear in notification centre
          }),
        });
      } catch (error) {
        // if (__DEV__) console.log('[App] Native modules not available - requires dev build');
      }

      try {
        const notifService = require('./src/services/pushNotificationService');
        const promoService = require('./src/services/scheduledPromoService');
        const supabaseModule = require('./src/services/supabaseClient');
        setupNotificationChannels = notifService.setupNotificationChannels;
        registerForPushNotifications = notifService.registerForPushNotifications;
        onTokenRefresh = notifService.onTokenRefresh;
        setupFCMForegroundHandler = notifService.setupFCMForegroundHandler;
        initializeScheduledPromos = promoService.initializeScheduledPromos;
        supabase = supabaseModule.supabase;
      } catch (error) {
        // if (__DEV__) console.log('[App] Notification services not available - requires dev build');
      }

      // 2. Register FCM push token for ALL roles (customer, rider, admin)
      // Runs BEFORE background-services guard so customers always get a token
      if (setupNotificationChannels && registerForPushNotifications) {
        try {
          await setupNotificationChannels();
          await registerForPushNotifications();
        } catch (e) {
          if (__DEV__) console.warn('[App] Push notification init failed:', e);
        }
      }

      // Start 2-hourly on-device promo ads (6 AM – midnight, no server needed)
      if (initializeScheduledPromos) {
        initializeScheduledPromos().catch(console.error);
      }

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

        // FCM foreground handler — shows heads-up notification when app is open
        if (setupFCMForegroundHandler) {
          const unsubForeground = setupFCMForegroundHandler();
          cleanupFunctions.push(unsubForeground);
        }

        // Token refresh — re-registers with server when the OS rotates the FCM token
        if (onTokenRefresh) {
          const unsubTokenRefresh = onTokenRefresh((_newToken) => {
            if (registerForPushNotifications) {
              registerForPushNotifications().catch(console.error);
            }
          });
          cleanupFunctions.push(unsubTokenRefresh);
        }

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

    // Re-register FCM token on fresh login — covers all roles (customer, rider, admin)
    let authUnsubscribe = null;
    if (supabase) {
      const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
          if (setupNotificationChannels && registerForPushNotifications) {
            setupNotificationChannels()
              .then(() => registerForPushNotifications())
              .catch(console.error);
          }
        }
      });
      authUnsubscribe = authSub;
    }

    // Monitor app state changes
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'background') {
        // Mark that we genuinely went to background (not just inactive via notification shade)
        wasBackgroundedRef.current = true;

        // Cleanly disconnect Firebase RTDB WebSocket to prevent stale connections.
        // This avoids the 20-30s lazy reconnect delay when the app resumes.
        try {
          const { getFirebaseDatabase } = require('./src/services/firebaseClient');
          const { goOffline } = require('firebase/database');
          
          // DO NOT disconnect if the user is a rider (they need background location)
          const useAuthStore = require('./src/store/authStore').useAuthStore;
          const user = useAuthStore.getState().user;
          
          if (user?.role === 'rider') {
            if (__DEV__) console.log('[App] Keeping Firebase RTDB connected for rider background tracking');
          } else {
            const db = getFirebaseDatabase();
            goOffline(db);
            if (__DEV__) console.log('[App] Firebase RTDB disconnected (background)');
          }
        } catch (_) { /* non-fatal */ }
      } else if (nextAppState === 'active') {
        // Force Firebase RTDB to reconnect immediately when the app resumes.
        // Without this, the SDK waits for its internal reconnect timer (up to 30s).
        try {
          const { getFirebaseDatabase } = require('./src/services/firebaseClient');
          const { goOnline } = require('firebase/database');
          const db = getFirebaseDatabase();
          goOnline(db);
          if (__DEV__) console.log('[App] Firebase RTDB reconnected (foreground)');
        } catch (_) { /* non-fatal */ }

        if (wasBackgroundedRef.current) {
          if (__DEV__) console.log('[App] App returned from background — showing ResumeScreen');
          wasBackgroundedRef.current = false;
          setIsResuming(true);
        }
      }
      setAppState(nextAppState);
    });

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      subscription.remove();
      if (authUnsubscribe) authUnsubscribe.unsubscribe();

      // execution safety: reverse order cleanup
      [...cleanupFunctions].reverse().forEach(cleanup => {
        try {
          if (cleanup && typeof cleanup === 'function') cleanup();
        } catch (error) {
          if (__DEV__) console.error('[App] Cleanup error:', error);
        }
      });
    };
  }, []);

  return (
    <PaperProvider theme={theme}>
      <StatusBar 
        barStyle={isDarkMode ? 'light-content' : 'dark-content'} 
        backgroundColor={theme.colors.background} 
      />
      <AppNavigator />
      <GlobalPremiumAlert />
      <OTAUpdateModal
        visible={showModal}
        onRestart={handleRestart}
        onDismiss={handleDismiss}
        runtimeVersion={currentlyRunning?.runtimeVersion}
      />
      {isResuming && (
        <ResumeScreen onReady={() => setIsResuming(false)} />
      )}
    </PaperProvider>
  );
};

export default function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        // 0. Load premium fonts
        await Font.loadAsync({
          Inter_400Regular,
          Inter_500Medium,
          Inter_600SemiBold,
          Inter_700Bold,
          JetBrainsMono_400Regular,
          JetBrainsMono_500Medium,
          JetBrainsMono_700Bold,
          SpaceGrotesk_500Medium,
          SpaceGrotesk_700Bold,
        });

        // 1. Configure Google Sign-In (absolutely required before anything else renders)
        configureGoogleSignIn();

        // 2. Artificially hold the splash screen for a tiny bit to let internal React navigation mount securely 
        // We aren't awaiting heavy auth checks here because AuthLoadingScreen handles that smoothly.
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (e) {
        console.warn(e);
      } finally {
        setIsReady(true);
        // Hide the native splash screen now that JS is parsed and the tree is built
        await SplashScreen.hideAsync();
      }
    }

    prepare();
  }, []);

  if (!isReady) {
    return null; // Return null to let the native splash screen stay visible
  }

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
