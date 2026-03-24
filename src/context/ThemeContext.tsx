import React, { createContext, useState, useContext, useMemo, useEffect, useCallback } from 'react';
import { MD3LightTheme, MD3DarkTheme, configureFonts } from 'react-native-paper';

// Premium Font Pairing Configuration (Apple / SF Pro aesthetic)
const fontConfig = {
    fontFamily: 'Inter_400Regular',
    displayLarge: { fontFamily: 'Inter_700Bold', fontSize: 57, fontWeight: '400', letterSpacing: 0, lineHeight: 64 },
    displayMedium: { fontFamily: 'Inter_700Bold', fontSize: 45, fontWeight: '400', letterSpacing: 0, lineHeight: 52 },
    displaySmall: { fontFamily: 'Inter_600SemiBold', fontSize: 36, fontWeight: '400', letterSpacing: 0, lineHeight: 44 },
    headlineLarge: { fontFamily: 'Inter_600SemiBold', fontSize: 32, fontWeight: '400', letterSpacing: 0, lineHeight: 40 },
    headlineMedium: { fontFamily: 'Inter_600SemiBold', fontSize: 28, fontWeight: '400', letterSpacing: 0, lineHeight: 36 },
    headlineSmall: { fontFamily: 'Inter_500Medium', fontSize: 24, fontWeight: '400', letterSpacing: 0, lineHeight: 32 },
    titleLarge: { fontFamily: 'Inter_500Medium', fontSize: 22, fontWeight: '400', letterSpacing: 0, lineHeight: 28 },
    titleMedium: { fontFamily: 'Inter_600SemiBold', fontSize: 16, fontWeight: '500', letterSpacing: 0.15, lineHeight: 24 },
    titleSmall: { fontFamily: 'Inter_500Medium', fontSize: 14, fontWeight: '500', letterSpacing: 0.1, lineHeight: 20 },
    labelLarge: { fontFamily: 'Inter_500Medium', fontSize: 14, fontWeight: '500', letterSpacing: 0.1, lineHeight: 20 },
    labelMedium: { fontFamily: 'Inter_500Medium', fontSize: 12, fontWeight: '500', letterSpacing: 0.5, lineHeight: 16 },
    labelSmall: { fontFamily: 'Inter_500Medium', fontSize: 11, fontWeight: '500', letterSpacing: 0.5, lineHeight: 16 },
    bodyLarge: { fontFamily: 'Inter_400Regular', fontSize: 16, fontWeight: '400', letterSpacing: 0.15, lineHeight: 24 },
    bodyMedium: { fontFamily: 'Inter_400Regular', fontSize: 14, fontWeight: '400', letterSpacing: 0.25, lineHeight: 20 },
    bodySmall: { fontFamily: 'Inter_400Regular', fontSize: 12, fontWeight: '400', letterSpacing: 0.4, lineHeight: 16 },
};
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_STORAGE_KEY = '@parcel_safe_dark_mode';

// Define custom colors if needed, extending standard Paper themes
const LightTheme = {
    ...MD3LightTheme,
    fonts: configureFonts({config: fontConfig}),
    colors: {
        ...MD3LightTheme.colors,
        primary: '#00695C', // Teal default
        background: '#F7F9FC',
        surface: '#FFFFFF',
        text: '#000000',
    },
};

const DarkTheme = {
    ...MD3DarkTheme,
    fonts: configureFonts({config: fontConfig}),
    colors: {
        ...MD3DarkTheme.colors,
        primary: '#80CBC4', // Lighter teal for dark mode
        background: '#121212',
        surface: '#1E1E1E',
        text: '#FFFFFF',
    },
};

type ThemeContextType = {
    isDarkMode: boolean;
    toggleTheme: () => void;
    theme: typeof LightTheme;
};

const ThemeContext = createContext<ThemeContextType>({
    isDarkMode: false,
    toggleTheme: () => { },
    theme: LightTheme,
});

export const useAppTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load saved preference on mount
    useEffect(() => {
        AsyncStorage.getItem(THEME_STORAGE_KEY)
            .then((value) => {
                if (value === 'true') setIsDarkMode(true);
            })
            .catch((err) => {
                console.warn('[ThemeContext] Failed to load theme preference:', err);
            })
            .finally(() => setIsLoaded(true));
    }, []);

    const toggleTheme = useCallback(() => {
        setIsDarkMode((prev) => {
            const next = !prev;
            AsyncStorage.setItem(THEME_STORAGE_KEY, String(next)).catch((err) => {
                console.warn('[ThemeContext] Failed to save theme preference:', err);
            });
            return next;
        });
    }, []);

    const theme = useMemo(() => (isDarkMode ? DarkTheme : LightTheme), [isDarkMode]);

    const value = useMemo(
        () => ({
            isDarkMode,
            toggleTheme,
            theme,
        }),
        [isDarkMode, toggleTheme, theme]
    );

    // Prevent theme flash on cold start
    if (!isLoaded) return null;

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
};
