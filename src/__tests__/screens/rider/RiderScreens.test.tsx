import React from 'react';
import { render, act } from '@testing-library/react-native';
import { Provider as PaperProvider } from 'react-native-paper';

import ArrivalScreen from '../../../screens/rider/ArrivalScreen';
import AssignedDeliveriesScreen from '../../../screens/rider/AssignedDeliveriesScreen';
import BoxControlsScreen from '../../../screens/rider/BoxControlsScreen';
import CancellationConfirmationScreen from '../../../screens/rider/CancellationConfirmationScreen';
import DeliveryCompletionScreen from '../../../screens/rider/DeliveryCompletionScreen';
import DeliveryRecordsScreen from '../../../screens/rider/DeliveryRecordsScreen';
import HardwareStatusScreen from '../../../screens/rider/HardwareStatusScreen';
import ReturnPackageScreen from '../../../screens/rider/ReturnPackageScreen';
import RiderDashboard from '../../../screens/rider/RiderDashboard';
import RiderSupportScreen from '../../../screens/rider/RiderSupportScreen';
import TheftAlertScreen from '../../../screens/rider/TheftAlertScreen';
import TrackMyBoxScreen from '../../../screens/rider/TrackMyBoxScreen';

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

jest.mock('react-native-maps', () => {
    const React = require('react');
    const { View } = require('react-native');
    return {
        __esModule: true,
        default: ({ children }: any) => <View>{children}</View>,
        Marker: ({ children }: any) => <View>{children}</View>,
        PROVIDER_GOOGLE: 'google',
    };
});

jest.mock('lottie-react-native', () => {
    const React = require('react');
    const View = require('react-native').View;
    return class LottieView extends React.Component {
        play = jest.fn();
        reset = jest.fn();
        pause = jest.fn();
        render() {
            return <View>{this.props.children}</View>;
        }
    };
});

jest.mock('../../../hooks/useLocationRedundancy', () => ({
    useLocationRedundancy: jest.fn(() => ({
        isPrimaryAvailable: true,
        isFallbackAvailable: true,
        status: 'OK',
        source: 'box',
        isBoxOnline: true,
        phoneGpsActive: false,
        startMonitoring: jest.fn(), // Added missing function
    })),
    getStatusMessage: jest.fn(() => 'OK'),
    getStatusColor: jest.fn(() => '#4CAF50'),
}));

jest.mock('../../../hooks/useHardwareStatus', () => ({
    useHardwareStatus: jest.fn(() => ({
        health: {
            solenoid: { status: 'OK' },
            camera: { status: 'OK' },
            display: { status: 'OK' },
            battery: { percent: 90, status: 'OK' },
        },
        alerts: [],
        isLoading: false,
        error: null,
        overallStatus: 'HEALTHY',
        statusText: 'All Systems OK',
        statusColor: '#4CAF50',
        isSafe: true,
        safetyReason: '',
        canProceed: true,
        proceedWarnings: [],
        dismissAlert: jest.fn(),
        acknowledgeReboot: jest.fn(),
        refresh: jest.fn(),
    })),
}));

jest.mock('../../../services/firebaseClient', () => ({
    subscribeToBattery: jest.fn(() => () => undefined),
    subscribeToTamper: jest.fn(() => () => undefined),
    subscribeToLocation: jest.fn(() => () => undefined),
    subscribeToKeypad: jest.fn(() => () => undefined),
    subscribeToHinge: jest.fn(() => () => undefined),
    subscribeToLockout: jest.fn(() => () => undefined),
    subscribeToOtpStatus: jest.fn(() => () => undefined),
    resetLockout: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../services/offlineCache', () => ({
    offlineCache: {
        getPendingSyncs: jest.fn(() => []),
        getSyncStatus: jest.fn(() => Promise.resolve({ pendingCount: 0 })), // Added missing function
    },
}));

jest.mock('../../../services/SafetyLogic', () => ({
    isSpeedAnomaly: jest.fn(() => false),
    isClockSyncRequired: jest.fn(() => false),
    canAddToPhotoQueue: jest.fn(() => true),
    isGpsStale: jest.fn(() => false),
    SAFETY_CONSTANTS: {},
}));

jest.mock('../../../services/recallService', () => ({
    __esModule: true,
    default: {
        checkRecallStatus: jest.fn(() => Promise.resolve(false)),
        listenForRecall: jest.fn((id, cb) => cb(false, null)), // Added missing function
    },
}));

jest.mock('@react-native-community/netinfo', () => ({
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() => Promise.resolve({ isConnected: true })),
}));

jest.mock('../../../services/riderMatchingService', () => ({
    subscribeToRiderRequests: jest.fn(() => () => undefined),
    acceptOrder: jest.fn(() => Promise.resolve()),
    rejectOrder: jest.fn(() => Promise.resolve()),
    updateRiderStatus: jest.fn(() => Promise.resolve()),
    removeRiderFromOnline: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../services/pushNotificationService', () => ({
    registerForPushNotifications: jest.fn(() => Promise.resolve('token')),
    setupNotificationChannels: jest.fn(() => Promise.resolve()),
    showIncomingOrderNotification: jest.fn(),
    addNotificationReceivedListener: jest.fn(() => () => undefined),
}));

jest.mock('../../../services/cancellationService', () => ({
    requestCancellation: jest.fn(() => Promise.resolve({ success: true })),
    subscribeToCancellation: jest.fn(() => () => undefined),
    markPackageRetrieved: jest.fn(() => Promise.resolve(true)),
    formatCancellationReason: jest.fn(() => 'Other'),
    getReturnOtpRemainingHours: jest.fn(() => 24),
    RETURN_OTP_VALIDITY_MS: 86400000,
    CancellationReason: { CUSTOMER_UNAVAILABLE: 'CUSTOMER_UNAVAILABLE', OTHER: 'OTHER' },
}));

jest.mock('../../../services/deliveryReassignmentService', () => ({
    subscribeToReassignment: jest.fn(() => () => undefined),
    getReassignmentType: jest.fn(() => 'incoming'),
    startAutoAckTimer: jest.fn(() => () => undefined),
    acknowledgeReassignment: jest.fn(() => Promise.resolve()),
    isReassignmentPending: jest.fn(() => false),
}));

jest.mock('../../../services/adminOverrideService', () => ({
    subscribeToAdminOverride: jest.fn(() => () => undefined),
    getOverrideNotificationMessage: jest.fn(() => 'Override detected'),
}));

jest.mock('../../../services/bleOtpService', () => ({
    bleOtpService: {
        startScan: jest.fn(() => Promise.resolve([])),
        stopScan: jest.fn(() => Promise.resolve()),
        connect: jest.fn(() => Promise.resolve(true)),
        transferOtp: jest.fn(() => Promise.resolve({ success: true })),
    },
}));

jest.mock('../../../services/theftService', () => ({
    subscribeToTheftStatus: jest.fn((boxId, callback) => {
        // Immediately invoke callback with mock data
        callback({
            state: 'SECURE',
            is_stolen: false,
            reported_at: null,
            lockdown_active: false
        });
        return () => undefined;
    }),
    reportTheft: jest.fn(() => Promise.resolve()),
    getTheftSeverity: jest.fn(() => 'LOW'),
    getTheftSeverityColor: jest.fn(() => '#FF9800'),
    formatTheftState: jest.fn(() => 'Monitoring'),
    subscribeToBoxLocation: jest.fn(() => () => undefined),
    getLocationHistory: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../../services/customerNotHomeService', () => ({
    initWaitTimerState: jest.fn(() => ({ startTime: Date.now(), status: 'WAITING' })),
    startWaitTimer: jest.fn(() => ({ startTime: Date.now(), status: 'WAITING' })),
    isWaitTimerExpired: jest.fn(() => false),
    getFormattedRemainingTime: jest.fn(() => '10:00'),
    markCustomerArrived: jest.fn(() => Promise.resolve()),
    initiateReturn: jest.fn(() => Promise.resolve()),
    recordArrivalPhoto: jest.fn((state: any) => state),
    recordNotificationSent: jest.fn((state: any) => state),
    canInitiateReturn: jest.fn(() => true),
    writeWaitTimerToFirebase: jest.fn(() => Promise.resolve()),
    sendDriverWaitingNotification: jest.fn(() => Promise.resolve()),
    CONFIG: {},
}));

jest.mock('../../../services/addressUpdateService', () => ({
    checkGeofence: jest.fn(() => ({ isInside: true, distanceMeters: 10 })),
    createDefaultGeofence: jest.fn(() => ({ radiusMeters: 50 })),
    expandGeofence: jest.fn((geo: any) => geo),
    createAddressUpdateRequest: jest.fn(() => ({})),
    validateAddressUpdateRequest: jest.fn(() => ({ valid: true })),
    submitAddressUpdate: jest.fn(() => Promise.resolve()),
    CONFIG: {},
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
        CircleLayer: () => null,
        PointAnnotation: ({ children }: any) => children || null,
        setAccessToken: jest.fn(),
        setTelemetryEnabled: jest.fn(),
        StyleURL: { Dark: 'dark', Light: 'light' },
    },
}));

jest.mock('../../../services/backgroundLocationService', () => ({
    startBackgroundLocation: jest.fn(() => Promise.resolve()),
    stopBackgroundLocation: jest.fn(() => Promise.resolve()),
    isBackgroundLocationRunning: jest.fn(() => false),
    subscribeToBackgroundLocationState: jest.fn(() => () => undefined),
}));

const renderWithProvider = (component: React.ReactElement) =>
    render(<PaperProvider>{component}</PaperProvider>);

describe('Rider Screens', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        mockRoute.params = {};
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('renders AssignedDeliveriesScreen', () => {
        const { getByText } = renderWithProvider(<AssignedDeliveriesScreen />);
        expect(getByText('My Queue')).toBeTruthy();
    });

    it('renders BoxControlsScreen', () => {
        const { getByText } = renderWithProvider(<BoxControlsScreen />);
        expect(getByText('Live Telemetry')).toBeTruthy();
    });

    it('renders ArrivalScreen', () => {
        mockRoute.params = { deliveryId: 'DEL-1', boxId: 'BOX-1' };
        const { getByText } = renderWithProvider(<ArrivalScreen />);
        expect(getByText('Arrival & Verification')).toBeTruthy();
    });

    it('renders DeliveryCompletionScreen', () => {
        const { getByText } = renderWithProvider(<DeliveryCompletionScreen />);
        expect(getByText('Delivery Successful!')).toBeTruthy();
    });

    it('renders DeliveryRecordsScreen', () => {
        const { getByText } = renderWithProvider(<DeliveryRecordsScreen />);
        expect(getByText(/History & Earnings/i)).toBeTruthy();
    });

    it('renders HardwareStatusScreen', () => {
        const { getByText } = render(
            <HardwareStatusScreen
                route={{ params: { boxId: 'BOX-1', deliveryId: 'DEL-1' } }}
                navigation={mockNavigation}
            />
        );
        expect(getByText('Box ID: BOX-1')).toBeTruthy();
        expect(getByText(/Safe for Delivery/i)).toBeTruthy();
    });

    it('renders ReturnPackageScreen', () => {
        mockRoute.params = { deliveryId: 'DEL-1', boxId: 'BOX-1', returnOtp: '123456' };
        const { getByText } = renderWithProvider(<ReturnPackageScreen />);
        expect(getByText('Navigating to Pickup')).toBeTruthy();
    });

    it('renders TheftAlertScreen', () => {
        mockRoute.params = { boxId: 'BOX-1', riderId: 'RIDER-1' };
        const { getByText, queryByText } = renderWithProvider(<TheftAlertScreen />);
        // It will show 'Box Security' if not stolen, or 'Theft Reported' if stolen.
        // It should also show 'Report Theft' button if not stolen.
        // Or we can just check if any of the key elements are present.
        const title = queryByText(/Theft Alert/i) || queryByText(/Box Security/i) || queryByText(/Report Theft/i);
        expect(title).toBeTruthy();
    });

    it('renders TrackMyBoxScreen', () => {
        mockRoute.params = { boxId: 'BOX-1' };
        const { getByText } = renderWithProvider(<TrackMyBoxScreen />);
        expect(getByText(/Locating box/i)).toBeTruthy();
    });

    it('renders CancellationConfirmationScreen', () => {
        mockRoute.params = { deliveryId: 'DEL-1', returnOtp: '123456', boxId: 'BOX-1' };
        const { getByText } = renderWithProvider(<CancellationConfirmationScreen />);
        expect(getByText('Delivery Cancelled')).toBeTruthy();
    });

    it('renders RiderDashboard', () => {
        const { getByText } = renderWithProvider(<RiderDashboard />);
        expect(getByText('Current Job')).toBeTruthy();
    });
});
