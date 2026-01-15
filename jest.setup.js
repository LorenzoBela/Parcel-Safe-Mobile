
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
    getCurrentPositionAsync: jest.fn(() => Promise.resolve({
        coords: { latitude: 14.5, longitude: 121.0 }
    })),
    watchPositionAsync: jest.fn(),
}));

// Mock React Native Libraries
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter');
