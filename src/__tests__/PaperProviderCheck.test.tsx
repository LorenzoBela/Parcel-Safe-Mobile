
import React from 'react';
import { render } from '@testing-library/react-native';
import { Provider as PaperProvider, Text } from 'react-native-paper';
import { View } from 'react-native';

// Mocks needed for PaperProvider
jest.mock('react-native-safe-area-context', () => {
    const React = require('react');
    const MOCK_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
    return {
        SafeAreaProvider: ({ children }: any) => children,
        SafeAreaView: ({ children }: any) => children,
        useSafeAreaInsets: () => MOCK_INSETS,
        SafeAreaInsetsContext: {
            Consumer: ({ children }: any) => children(MOCK_INSETS),
        },
    };
});

jest.mock('@expo/vector-icons', () => ({
    MaterialCommunityIcons: 'MaterialCommunityIcons',
    Ionicons: 'Ionicons',
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');


describe('PaperProvider Check', () => {
    it('renders PaperProvider correctly', () => {
        try {
            const { getByText } = render(
                <PaperProvider>
                    <View>
                        <Text>Hello Paper</Text>
                    </View>
                </PaperProvider>
            );
            expect(getByText('Hello Paper')).toBeTruthy();
        } catch (e) {
            console.error('PaperProviderCheck Error:', e);
            throw e;
        }
    });
});
