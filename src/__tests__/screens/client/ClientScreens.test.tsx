import React from 'react';
import { render, act } from '@testing-library/react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import CustomerDashboard from '../../../screens/client/CustomerDashboard';
import BookServiceScreen from '../../../screens/client/BookServiceScreen';
import SearchingRiderScreen from '../../../screens/client/SearchingRiderScreen';
import TrackOrderScreen from '../../../screens/client/TrackOrderScreen';
import DeliveryLogScreen from '../../../screens/client/DeliveryLogScreen';
import RatesScreen from '../../../screens/client/RatesScreen';
import ReportScreen from '../../../screens/client/ReportScreen';
import CustomerCancellationConfirmScreen from '../../../screens/client/CustomerCancellationConfirmScreen';

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

jest.mock('../../../services/firebaseClient', () => ({
    subscribeToDisplay: jest.fn(() => () => undefined),
}));

jest.mock('../../../services/riderMatchingService', () => ({
    subscribeToBookingStatus: jest.fn(() => () => undefined),
    subscribeToRiderLocation: jest.fn(() => () => undefined),
    startBookingTimer: jest.fn(() => () => undefined),
    requestRiderMatch: jest.fn(() => Promise.resolve({ success: true })),
    createPendingBooking: jest.fn(() => Promise.resolve()),
    notifyNearbyRiders: jest.fn(() => Promise.resolve({ notifiedCount: 1 })),
    cancelBooking: jest.fn(() => Promise.resolve()),
}));

jest.mock('lottie-react-native', () => 'LottieView');

jest.mock('../../../services/cancellationService', () => ({
    subscribeToCancellation: jest.fn(() => () => undefined),
    formatCancellationReason: jest.fn((reason: string) => reason),
    formatCustomerCancellationReason: jest.fn((reason: string) => reason),
    canCustomerCancel: jest.fn(() => ({ canCancel: true })),
    requestCustomerCancellation: jest.fn(() => Promise.resolve({ success: false })),
    DeliveryStatus: { ASSIGNED: 'ASSIGNED' },
    CustomerCancellationReason: {
        CHANGED_MIND: 'CHANGED_MIND',
        OTHER: 'OTHER',
    },
}));

jest.mock('expo-clipboard', () => ({
    setStringAsync: jest.fn(() => Promise.resolve()),
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

describe('Client Screens', () => {
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

    it('renders CustomerDashboard', () => {
        const { getByText } = renderWithProvider(<CustomerDashboard />);
        expect(getByText('Active Delivery')).toBeTruthy();
    });

    it('renders BookServiceScreen', () => {
        const { getByText } = renderWithProvider(<BookServiceScreen />);
        expect(getByText('Book a Service')).toBeTruthy();
    });

    it('renders SearchingRiderScreen', () => {
        mockRoute.params = {
            trackingId: 'TRK-123',
            pickupAddress: 'Pickup',
            dropoffAddress: 'Dropoff',
        };
        const { getByText } = renderWithProvider(<SearchingRiderScreen />);
        expect(getByText('Searching for Riders')).toBeTruthy();
    });

    it('renders TrackOrderScreen', () => {
        const { getByText } = renderWithProvider(<TrackOrderScreen />);
        expect(getByText('Arriving in 10 mins')).toBeTruthy();
    });

    it('renders DeliveryLogScreen', () => {
        const { getByText } = renderWithProvider(<DeliveryLogScreen />);
        expect(getByText('Delivery History')).toBeTruthy();
    });

    it('renders RatesScreen', () => {
        const { getByText } = renderWithProvider(<RatesScreen />);
        expect(getByText('System Rates')).toBeTruthy();
    });

    it('renders ReportScreen', () => {
        const { getByText } = renderWithProvider(<ReportScreen />);
        expect(getByText('Report an Issue')).toBeTruthy();
    });

    it('renders CustomerCancellationConfirmScreen', () => {
        mockRoute.params = {
            deliveryId: 'DEL-1',
            reason: 'CHANGED_MIND',
            refundStatus: 'PENDING',
        };
        const { getByText } = renderWithProvider(<CustomerCancellationConfirmScreen />);
        expect(getByText(/Order Cancelled/i)).toBeTruthy();
        expect(getByText('DEL-1')).toBeTruthy();
    });
});
