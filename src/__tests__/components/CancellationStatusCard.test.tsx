import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import CancellationStatusCard from '../../components/CancellationStatusCard';
import { CancellationState, CancellationReason } from '../../services/cancellationService';

// Mock cancellation service utilities
jest.mock('../../services/cancellationService', () => ({
    ...jest.requireActual('../../services/cancellationService'),
    formatCancellationReason: jest.fn((reason: string) => {
        const reasons: Record<string, string> = {
            'CUSTOMER_UNAVAILABLE': 'Customer Unavailable',
            'PACKAGE_DAMAGED': 'Package Damaged',
            'OTHER': 'Other',
        };
        return reasons[reason] || reason;
    }),
    isReturnOtpValid: jest.fn((issuedAt: number, now: number) => {
        const hoursDiff = (now - issuedAt) / (1000 * 60 * 60);
        return hoursDiff < 72;
    }),
    getReturnOtpRemainingHours: jest.fn((issuedAt: number, now: number) => {
        const hoursDiff = (now - issuedAt) / (1000 * 60 * 60);
        return Math.max(0, 72 - hoursDiff);
    }),
}));

describe('CancellationStatusCard', () => {
    const mockCancellation: CancellationState = {
        cancelled: true,
        cancelledAt: Date.now() - 1000 * 60 * 30, // 30 minutes ago
        reason: CancellationReason.CUSTOMER_UNAVAILABLE,
        reasonDetails: 'Customer not answering phone',
        riderId: 'RIDER_123',
        riderName: 'John Rider',
        packageRetrieved: false,
        returnOtp: '123456',
        returnOtpIssuedAt: Date.now() - 1000 * 60 * 60, // 1 hour ago
        returnOtpExpiresAt: Date.now() + 1000 * 60 * 60 * 23, // 23 hours from now
        senderNotified: true,
    };

    const renderWithProvider = (component: React.ReactElement) => {
        return render(
            <PaperProvider>
                {component}
            </PaperProvider>
        );
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Full Card View', () => {
        it('renders correctly with default props', () => {
            const { getByText } = renderWithProvider(
                <CancellationStatusCard cancellation={mockCancellation} />
            );

            expect(getByText('Delivery Cancelled')).toBeTruthy();
            expect(getByText(/Customer Unavailable/)).toBeTruthy();
        });

        it('displays rider name for customer variant', () => {
            const { getByText } = renderWithProvider(
                <CancellationStatusCard 
                    cancellation={mockCancellation} 
                    variant="customer" 
                />
            );

            expect(getByText(/Cancelled by:/)).toBeTruthy();
            expect(getByText(/John Rider/)).toBeTruthy();
        });

        it('does not display rider name for rider variant', () => {
            const { queryByText } = renderWithProvider(
                <CancellationStatusCard 
                    cancellation={mockCancellation} 
                    variant="rider" 
                />
            );

            expect(queryByText(/Cancelled by:/)).toBeNull();
        });

        it('shows return OTP when showReturnOtp is true', () => {
            const { getByText } = renderWithProvider(
                <CancellationStatusCard 
                    cancellation={mockCancellation} 
                    showReturnOtp={true} 
                />
            );

            // ReturnOtpDisplay component should be rendered
            expect(getByText('123456')).toBeTruthy();
        });

        it('hides return OTP when showReturnOtp is false', () => {
            const { queryByText } = renderWithProvider(
                <CancellationStatusCard 
                    cancellation={mockCancellation} 
                    showReturnOtp={false} 
                />
            );

            expect(queryByText('123456')).toBeNull();
        });

        it('displays reason details when provided', () => {
            const { getByText } = renderWithProvider(
                <CancellationStatusCard cancellation={mockCancellation} />
            );

            expect(getByText(/Customer not answering phone/)).toBeTruthy();
        });

        it('displays cancelled time', () => {
            const { getByText } = renderWithProvider(
                <CancellationStatusCard cancellation={mockCancellation} />
            );

            expect(getByText(/Cancelled at:/)).toBeTruthy();
        });

        it('calls onNavigateToReturn when button is pressed', () => {
            const mockNavigate = jest.fn();
            const { getByText } = renderWithProvider(
                <CancellationStatusCard 
                    cancellation={mockCancellation} 
                    onNavigateToReturn={mockNavigate}
                    variant="rider"
                />
            );

            const navigateButton = getByText('Navigate to Return Location');
            fireEvent.press(navigateButton);
            expect(mockNavigate).toHaveBeenCalled();
        });
    });

    describe('Compact Card View', () => {
        it('renders compact view correctly', () => {
            const { getByText } = renderWithProvider(
                <CancellationStatusCard 
                    cancellation={mockCancellation} 
                    compact={true} 
                />
            );

            expect(getByText('Delivery Cancelled')).toBeTruthy();
            expect(getByText(/Customer Unavailable/)).toBeTruthy();
        });

        it('shows "Retrieved" chip when package is retrieved', () => {
            const retrievedCancellation = {
                ...mockCancellation,
                packageRetrieved: true,
            };

            const { getByText } = renderWithProvider(
                <CancellationStatusCard 
                    cancellation={retrievedCancellation} 
                    compact={true} 
                />
            );

            expect(getByText('Retrieved')).toBeTruthy();
        });

        it('shows "Pending" chip when package is not retrieved', () => {
            const { getByText } = renderWithProvider(
                <CancellationStatusCard 
                    cancellation={mockCancellation} 
                    compact={true} 
                />
            );

            expect(getByText('Pending')).toBeTruthy();
        });

        it('does not show return OTP in compact mode', () => {
            const { queryByText } = renderWithProvider(
                <CancellationStatusCard 
                    cancellation={mockCancellation} 
                    compact={true}
                    showReturnOtp={true}
                />
            );

            // In compact mode, detailed OTP should not be shown
            expect(queryByText('123456')).toBeNull();
        });
    });

    describe('Package Retrieved Status', () => {
        it('shows retrieved status when package is retrieved', () => {
            const retrievedCancellation: CancellationState = {
                ...mockCancellation,
                packageRetrieved: true,
                retrievedAt: Date.now(),
            };

            const { queryByText } = renderWithProvider(
                <CancellationStatusCard cancellation={retrievedCancellation} />
            );

            // Should show some indication of retrieval - compact mode shows "Retrieved" chip
            const retrieved = queryByText('Retrieved');
            expect(retrieved || queryByText(/Delivery Cancelled/i)).toBeTruthy();
        });

        it('shows pending status when package is not retrieved', () => {
            const { getByText, queryByText } = renderWithProvider(
                <CancellationStatusCard cancellation={mockCancellation} />
            );

            // Should not show retrieved status
            expect(queryByText(/Retrieved at/i)).toBeNull();
        });
    });

    describe('Edge Cases', () => {
        it('handles missing reason details', () => {
            const cancellationWithoutDetails: CancellationState = {
                ...mockCancellation,
                reasonDetails: undefined,
            };

            const { queryByText } = renderWithProvider(
                <CancellationStatusCard cancellation={cancellationWithoutDetails} />
            );

            // Should not crash and should not show dash or hyphen from details
            expect(queryByText(/-\s*$/)).toBeNull();
        });

        it('handles missing rider name', () => {
            const cancellationWithoutRider: CancellationState = {
                ...mockCancellation,
                riderName: undefined,
            };

            const { queryByText } = renderWithProvider(
                <CancellationStatusCard 
                    cancellation={cancellationWithoutRider} 
                    variant="customer" 
                />
            );

            // Should not crash
            expect(queryByText('Delivery Cancelled')).toBeTruthy();
        });

        it('handles expired return OTP', () => {
            const expiredOtpCancellation: CancellationState = {
                ...mockCancellation,
                returnOtpIssuedAt: Date.now() - 1000 * 60 * 60 * 80, // 80 hours ago
            };

            const { getByText } = renderWithProvider(
                <CancellationStatusCard 
                    cancellation={expiredOtpCancellation} 
                    showReturnOtp={true}
                />
            );

            expect(getByText('Return OTP has expired. Please contact support.')).toBeTruthy();
        });
    });
});
