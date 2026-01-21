import React from 'react';
import { render, act } from '@testing-library/react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import AdminDashboard from '../../../screens/admin/AdminDashboard';
import GlobalMapScreen from '../../../screens/admin/GlobalMapScreen';
import TamperAlertsScreen from '../../../screens/admin/TamperAlertsScreen';
import PhotoAuditScreen from '../../../screens/admin/PhotoAuditScreen';
import AdminRemoteUnlockScreen from '../../../screens/admin/AdminRemoteUnlockScreen';

const mockNavigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
};
const mockRoute = { params: {} };

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => mockNavigation,
    useRoute: () => mockRoute,
    useFocusEffect: (callback: any) => callback(),
}));

jest.mock('../../../services/supabaseClient', () => ({
    markDeliveryComplete: jest.fn(() => Promise.resolve(true)),
    getDeliveryByIdOrTracking: jest.fn(() => Promise.resolve(null)),
    getCurrentUser: jest.fn(() => Promise.resolve({ id: 'admin-1' })),
}));

jest.mock('../../../services/adminOverrideService', () => ({
    triggerAdminOverride: jest.fn(() => Promise.resolve()),
}));

const renderWithProvider = (component: React.ReactElement) =>
    render(<PaperProvider>{component}</PaperProvider>);

describe('Admin Screens', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        act(() => {
            jest.runOnlyPendingTimers();
        });
        jest.useRealTimers();
    });

    it('renders AdminDashboard', () => {
        const { getByText } = renderWithProvider(<AdminDashboard />);
        expect(getByText('Admin Overview')).toBeTruthy();
        expect(getByText('System Management')).toBeTruthy();
    });

    it('renders GlobalMapScreen', () => {
        const { getByText } = renderWithProvider(<GlobalMapScreen />);
        expect(getByText(/Map unavailable/)).toBeTruthy();
        expect(getByText('Active Fleet: 3')).toBeTruthy();
    });

    it('renders TamperAlertsScreen', () => {
        const { getByText } = renderWithProvider(<TamperAlertsScreen />);
        expect(getByText('Tamper Alerts')).toBeTruthy();
        expect(getByText(/Tamper Alert: BOX-001/)).toBeTruthy();
    });

    it('renders PhotoAuditScreen with route params', () => {
        const { getByText } = renderWithProvider(
            <PhotoAuditScreen route={{ params: { logId: 'LOG-123' } }} />
        );
        expect(getByText('Audit Logs for ID: LOG-123')).toBeTruthy();
    });

    it('renders AdminRemoteUnlockScreen', () => {
        const { getByText } = renderWithProvider(<AdminRemoteUnlockScreen />);
        expect(getByText('Remote Box Unlock')).toBeTruthy();
        expect(getByText('Force Unlock')).toBeTruthy();
    });
});
