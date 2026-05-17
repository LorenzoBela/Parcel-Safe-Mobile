import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import ReturnOtpDisplay from '../../components/ReturnOtpDisplay';
import { Provider as PaperProvider } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import { PremiumAlert } from '../../services/PremiumAlertService';

// Mock clipboard
jest.mock('expo-clipboard', () => ({
    setStringAsync: jest.fn(),
}));

// Mock Alert
jest.spyOn(PremiumAlert, 'alert');


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
        expect(getByText('Return OTP')).toBeTruthy();
        expect(getByText('123456')).toBeTruthy();
    });

    it('renders correctly in compact mode', () => {
        const { getByText, queryByText } = renderWithProvider(<ReturnOtpDisplay {...mockProps} compact={true} />);
        expect(getByText('123456')).toBeTruthy();
        expect(queryByText('Return OTP')).toBeNull();
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
        expect(PremiumAlert.alert).toHaveBeenCalledWith('COPIED!', 'OTP COPIED TO CLIPBOARD');
        expect(mockProps.onCopy).toHaveBeenCalled();
    });

    it('does not require onCopy to be provided', async () => {
        const { getByText } = renderWithProvider(
            <ReturnOtpDisplay otp="222333" issuedAt={Date.now()} />
        );

        await act(async () => {
            fireEvent.press(getByText('222333'));
        });

        expect(Clipboard.setStringAsync).toHaveBeenCalledWith('222333');
        expect(PremiumAlert.alert).toHaveBeenCalledWith('COPIED!', 'OTP COPIED TO CLIPBOARD');
    });
});
