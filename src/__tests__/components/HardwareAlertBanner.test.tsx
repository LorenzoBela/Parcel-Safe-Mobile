import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { HardwareAlertBanner, HardwareAlertList } from '../../components/HardwareAlertBanner';
import { HardwareAlert } from '../../services/hardwareStatusService';

describe('HardwareAlertBanner', () => {
    const mockAlert: HardwareAlert = {
        id: '1',
        title: 'Battery Low',
        message: 'Battery at 10%',
        severity: 'warning',
        timestamp: Date.now(),
        action: 'Charge device',
        type: 'display', // Using valid type from union
    };

    const mockDismiss = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders correctly with default props', () => {
        const { getByText } = render(<HardwareAlertBanner alert={mockAlert} />);
        expect(getByText('Battery Low')).toBeTruthy();
        expect(getByText('Battery at 10%')).toBeTruthy();
        expect(getByText('Charge device')).toBeTruthy();
        expect(getByText('⚠️')).toBeTruthy(); // Warning icon
    });

    it('renders critical alert without dismiss button', () => {
        const criticalAlert: HardwareAlert = { ...mockAlert, severity: 'critical', title: 'System Failure', type: 'reboot' };
        const { getByText, queryByText } = render(<HardwareAlertBanner alert={criticalAlert} onDismiss={mockDismiss} />);

        expect(getByText('System Failure')).toBeTruthy();
        expect(queryByText('✕')).toBeNull(); // critical alerts generally not dismissible via X in this component logic
    });

    it('renders info alert with dismiss button', () => {
        const infoAlert: HardwareAlert = { ...mockAlert, severity: 'info', title: 'Update Available' };
        const { getByText } = render(<HardwareAlertBanner alert={infoAlert} onDismiss={mockDismiss} />);

        expect(getByText('Update Available')).toBeTruthy();
        const dismissBtn = getByText('✕');
        fireEvent.press(dismissBtn);
        expect(mockDismiss).toHaveBeenCalled();
    });

    it('does not show action if showAction is false', () => {
        const { queryByText } = render(<HardwareAlertBanner alert={mockAlert} showAction={false} />);
        expect(queryByText('Charge device')).toBeNull();
    });

    it('applies severity colors for warning alerts', () => {
        const warningAlert: HardwareAlert = { ...mockAlert, severity: 'warning', title: 'Warning Alert' };
        const { UNSAFE_getAllByType } = render(<HardwareAlertBanner alert={warningAlert} />);

        const views = UNSAFE_getAllByType(require('react-native').View);
        const container = views.find((view: any) => {
            const style = StyleSheet.flatten(view.props.style);
            return style?.backgroundColor && style?.borderColor;
        });

        const style = StyleSheet.flatten(container.props.style);
        expect(style.backgroundColor).toBe('#fef3c7');
        expect(style.borderColor).toBe('#f59e0b');
    });
});

describe('HardwareAlertList', () => {
    const alerts: HardwareAlert[] = [
        { id: '1', title: 'A1', message: 'M1', severity: 'info', timestamp: 0, type: 'solenoid' },
        { id: '2', title: 'A2', message: 'M2', severity: 'error', timestamp: 0, type: 'camera' },
    ];

    it('renders nothing when empty', () => {
        const { toJSON } = render(<HardwareAlertList alerts={[]} />);
        expect(toJSON()).toBeNull();
    });

    it('renders list of alerts', () => {
        const { getByText } = render(<HardwareAlertList alerts={alerts} />);
        expect(getByText('A1')).toBeTruthy();
        expect(getByText('A2')).toBeTruthy();
    });

    it('passes dismiss callback with ID', () => {
        const onDismiss = jest.fn();
        const { getAllByText } = render(<HardwareAlertList alerts={alerts} onDismiss={onDismiss} />);

        // Find all dismiss buttons (X)
        const dismissBtns = getAllByText('✕');
        fireEvent.press(dismissBtns[0]); // Press first one

        expect(onDismiss).toHaveBeenCalledWith('1');
    });

    it('hides action text when showAction is false', () => {
        const alertsWithAction: HardwareAlert[] = [
            { id: '1', title: 'A1', message: 'M1', severity: 'info', timestamp: 0, type: 'solenoid', action: 'Do action' },
        ];

        const { queryByText } = render(
            <HardwareAlertList alerts={alertsWithAction} showAction={false} />
        );

        expect(queryByText('M1')).toBeTruthy();
        expect(queryByText('Do action')).toBeNull();
    });
});
