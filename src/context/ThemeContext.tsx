import React, { createContext, useState, useContext, useMemo } from 'react';
import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';

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

    const toggleTheme = () => {
        setIsDarkMode((prev) => !prev);
    };

    const theme = useMemo(() => (isDarkMode ? DarkTheme : LightTheme), [isDarkMode]);

    const value = useMemo(
        () => ({
            isDarkMode,
            toggleTheme,
            theme,
        }),
        [isDarkMode, theme]
    );

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
};
