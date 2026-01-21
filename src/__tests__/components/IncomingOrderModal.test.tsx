import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import IncomingOrderModal from '../../components/IncomingOrderModal';
import { Provider as PaperProvider } from 'react-native-paper';

// Mock Animated
jest.mock('react-native', () => {
    const rn = jest.requireActual('react-native');
    rn.Animated.timing = (value, config) => ({
        start: (callback) => callback && callback(),
    });
    rn.Animated.spring = (value, config) => ({
        start: (callback) => callback && callback(),
    });
    rn.Animated.loop = () => ({
        start: () => { },
    });
    rn.Animated.sequence = () => ({
        start: () => { },
    });
    rn.Vibration = {
        vibrate: jest.fn(),
        cancel: jest.fn(),
    };
    return rn;
});

describe('IncomingOrderModal', () => {
    const mockRequest = {
        requestId: 'REQ_123',
        bookingId: 'BOOK_123',
        pickupAddress: '123 Pickup St',
        pickupLat: 14.5,
        pickupLng: 121.0,
        dropoffAddress: '456 Dropoff Ave',
        dropoffLat: 14.6,
        dropoffLng: 121.1,
        distanceToPickupKm: 2.5,
        estimatedFare: 150.00,
        expiresAt: Date.now() + 30000, // 30 seconds from now
        customerName: 'John Doe',
        customerId: 'CUST_123',
        packageDetails: 'Small Box',
        status: 'pending',
        createdAt: Date.now(),
    };

    const mockProps = {
        visible: true,
        request: mockRequest,
        requestId: 'REQ_123',
        onAccept: jest.fn(),
        onReject: jest.fn(),
        onExpire: jest.fn(),
    };

    const renderWithProvider = (component) => {
        return render(
            <PaperProvider>
                {component}
            </PaperProvider>
        );
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('renders correctly when visible', () => {
        const { getByText } = renderWithProvider(<IncomingOrderModal {...mockProps} />);

        expect(getByText('New Order Request')).toBeTruthy();
        expect(getByText('123 Pickup St')).toBeTruthy();
        expect(getByText('456 Dropoff Ave')).toBeTruthy();
        expect(getByText('₱150.00')).toBeTruthy();
    });

    it('does not render when not visible/no request', () => {
        const { queryByText } = renderWithProvider(<IncomingOrderModal {...mockProps} request={null} />);
        expect(queryByText('New Order Request')).toBeNull();
    });

    it('calls onAccept when Accept button is pressed', () => {
        const { getByText } = renderWithProvider(<IncomingOrderModal {...mockProps} />);
        const acceptButton = getByText('Accept');
        fireEvent.press(acceptButton);
        expect(mockProps.onAccept).toHaveBeenCalled();
    });

    it('calls onReject when Reject button is pressed', () => {
        const { getByText } = renderWithProvider(<IncomingOrderModal {...mockProps} />);
        const rejectButton = getByText('Reject');
        fireEvent.press(rejectButton);
        expect(mockProps.onReject).toHaveBeenCalled();
    });

    it('calls onExpire when timer runs out', () => {
        renderWithProvider(<IncomingOrderModal {...mockProps} />);

        // Fast-forward time by 32 seconds (timeout is 30s)
        act(() => {
            jest.advanceTimersByTime(32000);
        });

        expect(mockProps.onExpire).toHaveBeenCalled();
    });


});
