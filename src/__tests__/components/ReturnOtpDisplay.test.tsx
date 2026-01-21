import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import ReturnOtpDisplay from '../../components/ReturnOtpDisplay';
import { Provider as PaperProvider } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';

// Mock clipboard
jest.mock('expo-clipboard', () => ({
    setStringAsync: jest.fn(),
}));

// Mock Alert
jest.spyOn(Alert, 'alert');

// Mock Service
jest.mock('../../services/cancellationService', () => ({
    getReturnOtpRemainingHours: jest.fn(() => 23),
}));

describe('ReturnOtpDisplay', () => {
    const mockProps = {
        otp: '123456',
        issuedAt: Date.now(),
        onCopy: jest.fn(),
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

    it('renders correctly in full mode', () => {
        const { getByText } = renderWithProvider(<ReturnOtpDisplay {...mockProps} />);
        expect(getByText('Return Authorization OTP')).toBeTruthy();
        expect(getByText('123456')).toBeTruthy();
        expect(getByText('Valid for 23 hours')).toBeTruthy();
    });

    it('renders correctly in compact mode', () => {
        const { getByText, queryByText } = renderWithProvider(<ReturnOtpDisplay {...mockProps} compact={true} />);
        expect(getByText('123456')).toBeTruthy();
        expect(queryByText('Return Authorization OTP')).toBeNull();
    });

    it('handles clipboard copy', async () => {
        const { getByText } = renderWithProvider(<ReturnOtpDisplay {...mockProps} />);

        // Find the OTP code which is wrapped in a Touchable or the IconButton.
        // The component has a large Touchable wrapper for the OTP box.
        // Let's create an event by pressing the text or finding the button.

        // The structure has a TouchableOpacity wrapping the Surface.
        // We can click the text '123456' which bubbles up.
        await act(async () => {
            fireEvent.press(getByText('123456'));
        });

        expect(Clipboard.setStringAsync).toHaveBeenCalledWith('123456');
        expect(Alert.alert).toHaveBeenCalledWith('Copied!', 'OTP copied to clipboard');
        expect(mockProps.onCopy).toHaveBeenCalled();
    });

    it('hides validity if showValidity is false', () => {
        const { queryByText } = renderWithProvider(<ReturnOtpDisplay {...mockProps} showValidity={false} />);
        expect(queryByText(/Valid for/)).toBeNull();
    });

    it('does not require onCopy to be provided', async () => {
        const { getByText } = renderWithProvider(
            <ReturnOtpDisplay otp="222333" issuedAt={Date.now()} />
        );

        await act(async () => {
            fireEvent.press(getByText('222333'));
        });

        expect(Clipboard.setStringAsync).toHaveBeenCalledWith('222333');
        expect(Alert.alert).toHaveBeenCalledWith('Copied!', 'OTP copied to clipboard');
    });

    it('hides validity in compact mode when showValidity is false', () => {
        const { queryByText } = renderWithProvider(
            <ReturnOtpDisplay {...mockProps} compact={true} showValidity={false} />
        );

        expect(queryByText(/Valid for/)).toBeNull();
    });
});
