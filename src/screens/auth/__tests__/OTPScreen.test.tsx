
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import OTPScreen from '../OTPScreen';
import { subscribeToBoxState, subscribeToDisplay } from '../../../services/firebaseClient';

// Mock dependencies
jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({
        goBack: jest.fn(),
    }),
    useRoute: () => ({
        params: { boxId: 'BOX_TEST' },
    }),
}));

jest.mock('../../../components', () => ({
    CustomerBleUnlockModal: () => null,
}));

jest.mock('@expo/vector-icons', () => ({
    MaterialCommunityIcons: () => null,
}));

jest.mock('react-native-paper', () => ({
    Text: ({ children }: any) => <>{children}</>,
    Button: ({ children, onPress }: any) => <>{children}</>,
    Surface: ({ children }: any) => <>{children}</>,
    ProgressBar: () => null,
    IconButton: () => null,
    useTheme: () => ({
        colors: {
            background: 'white',
            primary: 'blue',
            surface: 'white',
            onSurface: 'black',
            onSurfaceVariant: 'gray',
            outline: 'gray',
            error: 'red',
            secondaryContainer: 'gray'
        },
        dark: false
    }),
    Portal: ({ children }: any) => <>{children}</>,
}));

// Mock external library that might use native views
jest.mock('react-native-confirmation-code-field', () => ({
    CodeField: (params: any) => {
        return <>{params.value}</>;
    },
    Cursor: () => null,
    useBlurOnFulfill: () => ({ current: null }),
    useClearByFocusCell: () => [{}, jest.fn()],
}));

// Manual mock for firebaseClient
jest.mock('../../../services/firebaseClient', () => ({
    subscribeToBoxState: jest.fn(),
    subscribeToDisplay: jest.fn(),
}));

describe('OTPScreen Security Logic', () => {
    // Cast to jest.Mock for typing
    const mockSubscribeToBoxState = subscribeToBoxState as jest.Mock;
    const mockSubscribeToDisplay = subscribeToDisplay as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        // Default mock implementation to prevent errors
        mockSubscribeToBoxState.mockImplementation((boxId: any, callback: any) => {
            return () => { }; // return Unsubscribe function
        });
        mockSubscribeToDisplay.mockImplementation((boxId: any, callback: any) => {
            return () => { };
        });
    });

    it('renders "Code Locked" initially when status is not ARRIVED', async () => {
        mockSubscribeToBoxState.mockImplementation((boxId, callback) => {
            // Simulate immediate callback with non-arrived status
            callback({ status: 'IN_TRANSIT', otp_code: '123456' });
            return () => { };
        });

        const { getByText, queryByText } = render(<OTPScreen />);

        // Expect lock message
        expect(getByText('Code Locked')).toBeTruthy();
        expect(getByText('Rider Approaching')).toBeTruthy();

        // OTP should NOT be visible
        expect(queryByText('Verify Receipt')).toBeNull();
    });

    it('reveals OTP when status changes to ARRIVED', async () => {
        let statusCallback: (state: any) => void;

        mockSubscribeToBoxState.mockImplementation((boxId, callback) => {
            statusCallback = callback;
            return () => { };
        });

        const { getByText, queryByText } = render(<OTPScreen />);

        // Initially hidden? (Assuming callback hasn't fired or fired with null)
        expect(queryByText('Code Locked')).toBeTruthy();

        // Simulate update to ARRIVED
        await waitFor(() => {
            if (statusCallback) {
                statusCallback({ status: 'ARRIVED', otp_code: '999999' });
            }
        });

        // Now it should be visible
        expect(getByText('Verify Receipt')).toBeTruthy();
        // Just checking for text that exists in the unlocked state
        expect(getByText('Copy Code')).toBeTruthy();

        // Locked state should be gone
        expect(queryByText('Code Locked')).toBeNull();
    });
});
