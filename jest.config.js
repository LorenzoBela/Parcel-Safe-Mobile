/** @type {import('jest').Config} */
module.exports = {
    preset: 'jest-expo',
    testEnvironment: 'node',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    transform: {
        '^.+\\.[jt]sx?$': 'babel-jest',
    },
    testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
    transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-confirmation-code-field|firebase|@firebase|@react-native-firebase|@react-native-async-storage|@testing-library|react-native-paper)',
    ],
    setupFiles: ["<rootDir>/jest.setup.js"],
};
