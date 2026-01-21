
// Mock Firebase
jest.mock('@react-native-firebase/database', () => {
    return () => ({
        ref: jest.fn(() => ({
            on: jest.fn(),
            off: jest.fn(),
            set: jest.fn(),
            once: jest.fn(() => Promise.resolve({ val: () => null })),
        })),
    });
});

jest.mock('@react-native-firebase/app', () => ({
    app: jest.fn(),
}));

// Mock NetInfo
jest.mock('@react-native-community/netinfo', () => ({
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() => Promise.resolve({ isConnected: true })),
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
    setItem: jest.fn(() => Promise.resolve()),
    getItem: jest.fn(() => Promise.resolve(null)),
    removeItem: jest.fn(() => Promise.resolve()),
}));

// Mock Expo Location
jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
    requestBackgroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
    getForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
    getBackgroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
    getCurrentPositionAsync: jest.fn(() => Promise.resolve({
        coords: { latitude: 14.5, longitude: 121.0 }
    })),
    reverseGeocodeAsync: jest.fn(() => Promise.resolve([
        { city: 'Manila', region: 'NCR', name: 'Manila' }
    ])),
    watchPositionAsync: jest.fn(),
    startLocationUpdatesAsync: jest.fn(() => Promise.resolve()),
    stopLocationUpdatesAsync: jest.fn(() => Promise.resolve()),
}));

// Mock React Native Libraries
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter');

jest.mock('react-native/Libraries/Components/Keyboard/Keyboard', () => ({
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn(),
    dismiss: jest.fn(),
    isVisible: jest.fn(() => false), // Added missing function
}));

jest.mock('react-native', () => {
    const RN = jest.requireActual('react-native');
    return {
        ...RN,
        Keyboard: {
            addListener: jest.fn(() => ({ remove: jest.fn() })),
            removeListener: jest.fn(),
            removeAllListeners: jest.fn(),
            dismiss: jest.fn(),
            isVisible: jest.fn(() => false), // Added missing function
        },
    };
});

jest.mock(
    'react-native/Libraries/Animated/NativeAnimatedHelper',
    () => ({
        shouldUseNativeDriver: jest.fn(() => false),
    }),
    { virtual: true }
);

jest.mock('expo-task-manager', () => ({
    defineTask: jest.fn(),
    isTaskDefined: jest.fn(() => false),
    isTaskRegisteredAsync: jest.fn(() => Promise.resolve(false)),
    unregisterTaskAsync: jest.fn(() => Promise.resolve()),
}));

// Mock DevMenu to prevent TurboModuleRegistry error
jest.mock('react-native/src/private/devsupport/devmenu/specs/NativeDevMenu', () => ({
    getConstants: jest.fn(() => ({})),
    show: jest.fn(),
    reload: jest.fn(),
}));

// Mock NativeSettingsManager
jest.mock('react-native/src/private/specs_DEPRECATED/modules/NativeSettingsManager', () => ({
    getConstants: jest.fn(() => ({
        settings: {},
    })),
    setValues: jest.fn(),
    deleteValues: jest.fn(),
}));

// Mock Reanimated
jest.mock('react-native-reanimated', () => {
    const Reanimated = require('react-native-reanimated/mock');
    Reanimated.default.call = () => { };
    return Reanimated;
});

// Mock SafeAreaContext
const MOCK_INITIAL_METRICS = {
    frame: { x: 0, y: 0, width: 0, height: 0 },
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

jest.mock('react-native-safe-area-context', () => {
    const React = require('react');
    return {
        SafeAreaProvider: ({ children }) => children,
        SafeAreaView: ({ children }) => children,
        useSafeAreaInsets: () => MOCK_INITIAL_METRICS.insets,
        useSafeAreaFrame: () => MOCK_INITIAL_METRICS.frame,
        SafeAreaInsetsContext: React.createContext(MOCK_INITIAL_METRICS.insets),
    };
});

// Mock expo-image-picker
jest.mock('expo-image-picker', () => ({
    launchCameraAsync: jest.fn(() => Promise.resolve({ canceled: true })),
    launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true })),
    MediaTypeOptions: { Images: 'Images' },
    requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
}), { virtual: true });
