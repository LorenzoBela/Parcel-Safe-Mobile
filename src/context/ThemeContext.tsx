import React, { createContext, useState, useContext, useMemo, useEffect, useCallback } from 'react';
import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_STORAGE_KEY = '@parcel_safe_dark_mode';

// Define custom colors if needed, extending standard Paper themes
const LightTheme = {
    ...MD3LightTheme,
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
