import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import DeliveryDetailScreen from '../../../screens/common/DeliveryDetailScreen';
import EditProfileScreen from '../../../screens/common/EditProfileScreen';
import HelpCenterScreen from '../../../screens/common/HelpCenterScreen';
import PrivacyPolicyScreen from '../../../screens/common/PrivacyPolicyScreen';
import ProfileScreen from '../../../screens/common/ProfileScreen';
import SavedAddressesScreen from '../../../screens/common/SavedAddressesScreen';
import SettingsScreen from '../../../screens/common/SettingsScreen';
import TermsOfServiceScreen from '../../../screens/common/TermsOfServiceScreen';

const mockNavigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
};
const mockRoute = { params: {} } as any;

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => mockNavigation,
    useRoute: () => mockRoute,
    useFocusEffect: (callback: any) => callback(),
}));

jest.mock('../../../services/supabaseClient', () => ({
    supabase: {
        auth: {
            getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })),
        },
        from: jest.fn(() => ({
            select: jest.fn(() => ({
                eq: jest.fn(() => ({
                    single: jest.fn(() => Promise.resolve({ data: { full_name: 'Test User', email: 'test@example.com' } })),
                })),
            })),
        })),
    },
}));

jest.mock('../../../context/ThemeContext', () => ({
    useAppTheme: jest.fn(() => ({
        isDarkMode: false,
        toggleTheme: jest.fn(),
    })),
}));

jest.mock('@rnmapbox/maps', () => ({
    __esModule: true,
    default: {
        MapView: ({ children }: any) => children || null,
        Camera: ({ children }: any) => children || null,
        ShapeSource: ({ children }: any) => children || null,
        LineLayer: () => null,
        PointAnnotation: ({ children }: any) => children || null,
        setAccessToken: jest.fn(),
        setTelemetryEnabled: jest.fn(),
        StyleURL: { Dark: 'dark', Light: 'light' },
    },
}));

const renderWithProvider = (component: React.ReactElement) =>
    render(<PaperProvider>{component}</PaperProvider>);

describe('Common Screens', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        mockRoute.params = {};
    });

    afterEach(() => {
        act(() => {
            jest.runOnlyPendingTimers();
        });
        jest.useRealTimers();
    });

    it('renders DeliveryDetailScreen with route params', () => {
        mockRoute.params = {
            delivery: {
                trk: 'TRK-1',
                status: 'Delivered',
                time: '10:00 AM',
                distance: '2 km',
                priority: 'High',
                type: 'Box',
                customer: 'John Doe',
                address: '123 Street',
                image: 'https://via.placeholder.com/150',
            }
        };
        const { getByText } = renderWithProvider(<DeliveryDetailScreen />);
        expect(getByText('Delivery Details')).toBeTruthy();
        expect(getByText('TRK-1')).toBeTruthy();
    });

    it('renders ProfileScreen', () => {
        const { getByText } = renderWithProvider(<ProfileScreen />);
        expect(getByText('Edit Profile')).toBeTruthy();
    });

    it('renders SettingsScreen', () => {
        const { getByText } = renderWithProvider(<SettingsScreen />);
        expect(getByText('Settings')).toBeTruthy();
        expect(getByText('Help Center')).toBeTruthy();
    });

    it('renders EditProfileScreen', () => {
        const { getByText } = renderWithProvider(<EditProfileScreen />);
        expect(getByText('Edit Profile')).toBeTruthy();
    });

    it('renders HelpCenterScreen', () => {
        const { getByText } = renderWithProvider(<HelpCenterScreen />);
        expect(getByText('Help Center')).toBeTruthy();
    });

    it('renders TermsOfServiceScreen', () => {
        const { getByText } = renderWithProvider(<TermsOfServiceScreen />);
        expect(getByText('Terms of Service')).toBeTruthy();
    });

    it('renders PrivacyPolicyScreen', () => {
        const { getByText } = renderWithProvider(<PrivacyPolicyScreen />);
        expect(getByText('Privacy Policy')).toBeTruthy();
    });

    it('renders SavedAddressesScreen', async () => {
        const { getByText, queryByText } = renderWithProvider(<SavedAddressesScreen />);

        await waitFor(() => {
            expect(queryByText('Loading addresses...')).toBeNull();
        });

        expect(getByText('No saved addresses yet.')).toBeTruthy();
    });
});
