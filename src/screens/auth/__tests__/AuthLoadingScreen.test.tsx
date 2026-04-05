import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AuthLoadingScreen from '../AuthLoadingScreen';

const mockNavigation = {
    replace: jest.fn(),
};

let netInfoListener: ((state: { isConnected: boolean; isInternetReachable?: boolean | null }) => void) | null = null;
const currentNetInfoState = {
    isConnected: true,
    isInternetReachable: true,
};

const mockStore: any = {
    user: null,
    role: null,
    login: jest.fn(),
};

const mockGetSession: any = jest.fn();
const mockSignOut: any = jest.fn();
const mockValidateBiometricBoundSecrets: any = jest.fn();

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => mockNavigation,
}));

jest.mock('../../../hooks/useEntryAnimation', () => ({
    usePulseAnimation: () => ({ style: {} }),
}));

jest.mock('../../../context/ThemeContext', () => ({
    useAppTheme: () => ({ isDarkMode: false }),
}));

jest.mock('@react-native-community/netinfo', () => ({
    __esModule: true,
    default: {
        addEventListener: jest.fn((listener: (state: { isConnected: boolean; isInternetReachable?: boolean | null }) => void) => {
            netInfoListener = listener;
            return jest.fn();
        }),
        fetch: jest.fn(async () => currentNetInfoState),
    },
}));

jest.mock('../../../store/authStore', () => {
    const storeFn: any = (selector?: any) => (selector ? selector(mockStore) : mockStore);
    storeFn.getState = () => mockStore;
    return {
        __esModule: true,
        default: storeFn,
    };
});

jest.mock('../../../services/supabaseClient', () => ({
    supabase: {
        auth: {
            getSession: (...args: any[]) => mockGetSession(...args),
            signOut: (...args: any[]) => mockSignOut(...args),
        },
        from: jest.fn(() => ({
            select: jest.fn(() => ({
                eq: jest.fn(() => ({
                    maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
                })),
            })),
        })),
    },
}));

jest.mock('../../../services/gpsWarmupService', () => ({
    warmUpLocationServices: jest.fn(),
}));

jest.mock('../../../services/security/authSecretStore', () => ({
    validateBiometricBoundSecrets: (...args: any[]) => mockValidateBiometricBoundSecrets(...args),
}));

jest.mock('../../../services/observability/sentryService', () => ({
    captureHandledError: jest.fn(),
    captureHandledMessage: jest.fn(),
}));

describe('AuthLoadingScreen', () => {
    jest.setTimeout(20000);

    beforeEach(() => {
        jest.clearAllMocks();
        netInfoListener = null;
        currentNetInfoState.isConnected = true;
        currentNetInfoState.isInternetReachable = true;
        mockStore.user = null;
        mockStore.role = null;
        mockValidateBiometricBoundSecrets.mockResolvedValue({ requiresHardRelogin: false });
        mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
        mockSignOut.mockResolvedValue(undefined);
    });

    it('shows manual recovery actions after offline startup detection', async () => {
        currentNetInfoState.isConnected = false;
        currentNetInfoState.isInternetReachable = false;

        const { getByText, unmount } = render(<AuthLoadingScreen />);

        act(() => {
            if (netInfoListener) {
                netInfoListener({ isConnected: false, isInternetReachable: false });
            }
        });

        await waitFor(() => {
            expect(getByText('No internet connection detected')).toBeTruthy();
        });
        expect(mockNavigation.replace).not.toHaveBeenCalled();
        unmount();
    });

    it('navigates to RoleSelection from hydrated cached auth state', async () => {
        mockStore.user = { userId: 'uid-1', email: 'u@example.com' };
        mockStore.role = 'rider';

        const { unmount } = render(<AuthLoadingScreen />);

        await waitFor(() => {
            expect(mockNavigation.replace).toHaveBeenCalledWith('RoleSelection');
        });
        unmount();
    });

    it.skip('retries startup flow when Try Again is pressed', async () => {
        currentNetInfoState.isConnected = true;
        currentNetInfoState.isInternetReachable = true;
        mockGetSession.mockRejectedValueOnce(new Error('session failed'));

        const { getByText, unmount } = render(<AuthLoadingScreen />);

        await waitFor(() => {
            expect(getByText('Try Again')).toBeTruthy();
        }, { timeout: 8000 });

        const callsBeforeRetry = mockGetSession.mock.calls.length;
        mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

        act(() => {
            currentNetInfoState.isConnected = true;
            currentNetInfoState.isInternetReachable = true;
            if (netInfoListener) {
                netInfoListener({ isConnected: true, isInternetReachable: true });
            }
        });

        fireEvent.press(getByText('Try Again'));

        await waitFor(() => {
            expect(mockGetSession.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
        });
        unmount();
    });
});
