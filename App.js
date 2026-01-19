import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { GluestackUIProvider } from '@gluestack-ui/themed';
import { config } from '@gluestack-ui/config';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { configureGoogleSignIn } from './src/services/auth';
import { ThemeProvider, useAppTheme } from './src/context/ThemeContext';

const AppContent = () => {
  const { theme } = useAppTheme();

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
