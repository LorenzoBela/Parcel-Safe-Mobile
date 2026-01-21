import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import ReassignmentAlertModal from '../../components/ReassignmentAlertModal';
import { ReassignmentState, getRemainingAutoAckSeconds } from '../../services/deliveryReassignmentService';

// Mock the service functions
jest.mock('../../services/deliveryReassignmentService', () => ({
    getRemainingAutoAckSeconds: jest.fn(() => 30),
    getReassignmentAlertMessage: jest.fn((state, type) =>
        type === 'outgoing' ? 'Reassigned AWAY' : 'Reassigned TO YOU'
    ),
    formatRemainingTime: jest.fn(() => '0:30'),
}));

// Mock Animations to avoid native driver issues in tests
// Mock Animated to prevent native driver issues
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
    return rn;
});

describe('ReassignmentAlertModal UI/UX', () => {
    const mockState: ReassignmentState = {
        pending: true,
        old_rider_id: 'RIDER_OLD',
        new_rider_id: 'RIDER_NEW',
        delivery_id: 'DEL_123',
        acknowledged: false,
        triggered_at: Date.now(),
    };

    const mockAcknowledge = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders correctly for Outgoing reassignment (Red Theme)', () => {
        const { getByText, getByTestId } = render(
            <ReassignmentAlertModal
                visible={true}
                state={mockState}
                type="outgoing"
                onAcknowledge={mockAcknowledge}
            />
        );

        // Check Text
        expect(getByText('Delivery Reassignment')).toBeTruthy();
        expect(getByText('Reassigned AWAY')).toBeTruthy();
        expect(getByText('Acknowledge')).toBeTruthy();

        // Check Icon (MaterialCommunityIcons name prop verification is tricky in unit tests without deep mocks, 
        // usually we check for existence of elements or accessibilty labels if added)
    });

    it('renders correctly for Incoming reassignment (Green Theme)', () => {
        const { getByText } = render(
            <ReassignmentAlertModal
                visible={true}
                state={mockState}
                type="incoming"
                onAcknowledge={mockAcknowledge}
            />
        );

        expect(getByText('New Assignment')).toBeTruthy();
        expect(getByText('Reassigned TO YOU')).toBeTruthy();
    });

    it('calls onAcknowledge when button is pressed', () => {
        const { getByText } = render(
            <ReassignmentAlertModal
                visible={true}
                state={mockState}
                type="outgoing"
                onAcknowledge={mockAcknowledge}
            />
        );

        const button = getByText('Acknowledge');
        fireEvent.press(button);

        expect(mockAcknowledge).toHaveBeenCalledTimes(1);
    });

    it('shows formatted countdown text', () => {
        const { getByText } = render(
            <ReassignmentAlertModal
                visible={true}
                state={mockState}
                type="incoming"
                onAcknowledge={mockAcknowledge}
            />
        );

        expect(getByText(/Auto-acknowledge in 0:30/)).toBeTruthy();
    });

    it('requests remaining time on mount', () => {
        render(
            <ReassignmentAlertModal
                visible={true}
                state={mockState}
                type="outgoing"
                onAcknowledge={mockAcknowledge}
            />
        );

        expect(getRemainingAutoAckSeconds).toHaveBeenCalledWith(mockState);
    });

    it('returns null when state is missing', () => {
        const { toJSON } = render(
            <ReassignmentAlertModal
                visible={true}
                state={null}
                type="outgoing"
                onAcknowledge={mockAcknowledge}
            />
        );

        expect(toJSON()).toBeNull();
    });

    it('returns null when type is missing', () => {
        const { toJSON } = render(
            <ReassignmentAlertModal
                visible={true}
                state={mockState}
                type={null}
                onAcknowledge={mockAcknowledge}
            />
        );

        expect(toJSON()).toBeNull();
    });




});
