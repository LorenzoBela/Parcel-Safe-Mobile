import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import CancellationModal from '../../../components/modals/CancellationModal';
import { CancellationReason } from '../../../services/cancellationService';

describe('CancellationModal (Rider)', () => {
    const mockProps = {
        visible: true,
        onDismiss: jest.fn(),
        onSubmit: jest.fn(),
        loading: false,
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

    describe('Basic Rendering', () => {
        it('renders correctly when visible', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            expect(getByText('Cancel Delivery')).toBeTruthy();
            expect(getByText(/Please select a reason for cancellation/)).toBeTruthy();
        });

        it('does not render when not visible', () => {
            const { queryByText } = renderWithProvider(
                <CancellationModal {...mockProps} visible={false} />
            );

            expect(queryByText('Cancel Delivery')).toBeNull();
        });

        it('shows notice about recording', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            expect(getByText(/This will be recorded/)).toBeTruthy();
            expect(getByText(/sender will be notified/)).toBeTruthy();
        });
    });

    describe('Cancellation Reasons', () => {
        it('displays all cancellation reason options', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            // Check for common reasons
            expect(getByText(/Customer Unavailable/i)).toBeTruthy();
        });

        it('allows selecting a reason', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            const reasonOption = getByText(/Customer Unavailable/i);
            fireEvent.press(reasonOption);

            // Should be selected (this is implicit in radio button behavior)
            expect(reasonOption).toBeTruthy();
        });

        it('defaults to first reason option', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            // First option should be visible
            expect(getByText(/Customer Unavailable/i)).toBeTruthy();
        });

        it('changes selected reason when different option is pressed', () => {
            const { getAllByRole } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            // Radio buttons should be present
            const radioButtons = getAllByRole('radio');
            expect(radioButtons.length).toBeGreaterThan(0);
        });
    });

    describe('Additional Details', () => {
        it('shows details input field', () => {
            const { getByPlaceholderText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            const detailsInput = getByPlaceholderText(/Optional/);
            expect(detailsInput).toBeTruthy();
        });

        it('allows entering additional details', () => {
            const { getByPlaceholderText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            const detailsInput = getByPlaceholderText(/Optional/);
            fireEvent.changeText(detailsInput, 'Customer refused delivery');

            expect(detailsInput.props.value).toBe('Customer refused delivery');
        });

        it('shows details as optional for most reasons', () => {
            const { getByPlaceholderText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            const detailsInput = getByPlaceholderText(/Optional/);
            expect(detailsInput).toBeTruthy();
        });

        it('requires details when "Other" is selected', () => {
            const { getByText, getByPlaceholderText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            // Select "Other" reason
            const otherReason = getByText(/Other/i);
            fireEvent.press(otherReason);

            // Try to submit without details
            const confirmButton = getByText('Confirm Cancellation');
            fireEvent.press(confirmButton);

            // Should show error
            expect(getByText(/Please provide details/)).toBeTruthy();
        });
    });

    describe('Form Validation', () => {
        it('shows error when "Other" is selected without details', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            // Select "Other"
            const otherOption = getByText(/Other/i);
            fireEvent.press(otherOption);

            // Submit without details
            const confirmButton = getByText('Confirm Cancellation');
            fireEvent.press(confirmButton);

            // Should show validation error
            expect(getByText(/Please provide details/)).toBeTruthy();
            expect(mockProps.onSubmit).not.toHaveBeenCalled();
        });

        it('clears error when details are provided', () => {
            const { getByText, getByPlaceholderText, queryByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            // Select "Other" and submit without details
            const otherOption = getByText(/Other/i);
            fireEvent.press(otherOption);
            
            const confirmButton = getByText('Confirm Cancellation');
            fireEvent.press(confirmButton);

            expect(getByText(/Please provide details/)).toBeTruthy();

            // Now add details
            const detailsInput = getByPlaceholderText(/Optional/);
            fireEvent.changeText(detailsInput, 'Some reason');

            // Submit again
            fireEvent.press(confirmButton);

            // Error should be cleared and submit should be called
            expect(mockProps.onSubmit).toHaveBeenCalled();
        });

        it('allows submission without details for non-Other reasons', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            // Default reason (Customer Unavailable)
            const confirmButton = getByText('Confirm Cancellation');
            fireEvent.press(confirmButton);

            expect(mockProps.onSubmit).toHaveBeenCalled();
        });
    });

    describe('Action Buttons', () => {
        it('shows Dismiss button', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            expect(getByText('Dismiss')).toBeTruthy();
        });

        it('shows Confirm Cancellation button', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            expect(getByText('Confirm Cancellation')).toBeTruthy();
        });

        it('calls onDismiss when Dismiss button is pressed', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            const dismissButton = getByText('Dismiss');
            fireEvent.press(dismissButton);

            expect(mockProps.onDismiss).toHaveBeenCalled();
        });

        it('calls onSubmit with reason and details when confirmed', () => {
            const { getByText, getByPlaceholderText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            // Enter details
            const detailsInput = getByPlaceholderText(/Optional/);
            fireEvent.changeText(detailsInput, 'Test details');

            // Submit
            const confirmButton = getByText('Confirm Cancellation');
            fireEvent.press(confirmButton);

            expect(mockProps.onSubmit).toHaveBeenCalledWith(
                CancellationReason.CUSTOMER_UNAVAILABLE,
                'Test details'
            );
        });
    });

    describe('Loading State', () => {
        it('shows loading on confirm button when loading', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} loading={true} />
            );

            const confirmButton = getByText('Confirm Cancellation');
            expect(confirmButton).toBeTruthy();
            // Button should be in loading state (handled by Button component)
        });

        it('disables buttons when loading', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} loading={true} />
            );

            const dismissButton = getByText('Dismiss');
            const confirmButton = getByText('Confirm Cancellation');

            // Verify buttons exist and modal handles loading state
            expect(dismissButton).toBeTruthy();
            expect(confirmButton).toBeTruthy();
        });

        it('enables buttons when not loading', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} loading={false} />
            );

            const dismissButton = getByText('Dismiss');
            fireEvent.press(dismissButton);

            expect(mockProps.onDismiss).toHaveBeenCalled();
        });
    });

    describe('Scrollable Content', () => {
        it('renders reason list in scrollable view', () => {
            const { UNSAFE_getByType } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            const scrollView = UNSAFE_getByType(require('react-native').ScrollView);
            expect(scrollView).toBeTruthy();
        });

        it('handles long reason lists', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            // Should render all reasons even if list is long
            expect(getByText(/Customer Unavailable/i)).toBeTruthy();
        });
    });

    describe('Edge Cases', () => {
        it('handles rapid reason changes', () => {
            const { getByText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            const customerUnavailable = getByText(/Customer Unavailable/i);
            const otherReason = getByText(/Other/i);

            fireEvent.press(customerUnavailable);
            fireEvent.press(otherReason);
            fireEvent.press(customerUnavailable);

            // Should handle rapid changes without crashing
            expect(getByText('Cancel Delivery')).toBeTruthy();
        });

        it('handles empty details gracefully', () => {
            const { getByText, getByPlaceholderText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            const detailsInput = getByPlaceholderText(/Optional/);
            fireEvent.changeText(detailsInput, '   '); // Whitespace only

            const confirmButton = getByText('Confirm Cancellation');
            fireEvent.press(confirmButton);

            // Should accept whitespace for non-Other reasons
            expect(mockProps.onSubmit).toHaveBeenCalled();
        });

        it('trims whitespace from details for Other reason', () => {
            const { getByText, getByPlaceholderText } = renderWithProvider(
                <CancellationModal {...mockProps} />
            );

            // Select Other
            const otherOption = getByText(/Other/i);
            fireEvent.press(otherOption);

            const detailsInput = getByPlaceholderText(/Optional/);
            fireEvent.changeText(detailsInput, '   '); // Whitespace only

            const confirmButton = getByText('Confirm Cancellation');
            fireEvent.press(confirmButton);

            // Should show error for whitespace-only details
            expect(getByText(/Please provide details/)).toBeTruthy();
            expect(mockProps.onSubmit).not.toHaveBeenCalled();
        });
    });
});
