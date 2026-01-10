import 'react-native-gesture-handler';
import React from 'react';
import { GluestackUIProvider } from '@gluestack-ui/themed';
import { config } from '@gluestack-ui/config';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';

import { configureGoogleSignIn } from './src/services/auth';
import { useEffect } from 'react';

export default function App() {
  useEffect(() => {
    configureGoogleSignIn();
  }, []);

  return (
    <SafeAreaProvider>
      <GluestackUIProvider config={config}>
        <PaperProvider>
          <AppNavigator />
        </PaperProvider>
      </GluestackUIProvider>
    </SafeAreaProvider>
  );
}
