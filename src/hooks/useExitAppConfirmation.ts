import { useCallback, useState } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import RNExitApp from 'react-native-exit-app';
import { stopBackgroundLocation } from '../services/backgroundLocationService';
import { stopBackgroundServices } from '../services/backgroundServiceManager';

export const useExitAppConfirmation = () => {
    const [showExitModal, setShowExitModal] = useState(false);

    useFocusEffect(
        useCallback(() => {
            const onBackPress = () => {
                setShowExitModal(true);
                return true; // Prevent default behavior (exiting the app immediately)
            };

            const backHandler = BackHandler.addEventListener(
                'hardwareBackPress',
                onBackPress
            );

            return () => backHandler.remove();
        }, [])
    );

    const handleExit = async () => {
        try {
            // Stop background location tracking explicitly
            stopBackgroundLocation();

            // Stop background services (FCM, foreground services, etc.)
            await stopBackgroundServices();
        } catch (error) {
            console.warn('[useExitAppConfirmation] Error stopping services:', error);
        } finally {
            // Completely kill the app process so it removes the interactive state from Recents
            try {
                RNExitApp.exitApp();
            } catch (error) {
                // Fallback if the native module isn't linked yet
                BackHandler.exitApp();
            }
        }
    };

    return { showExitModal, setShowExitModal, handleExit };
};

