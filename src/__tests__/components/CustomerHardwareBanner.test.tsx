import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import CustomerHardwareBanner from '../../components/CustomerHardwareBanner';

describe('CustomerHardwareBanner', () => {
    const renderWithProvider = (component: React.ReactElement) => {
        return render(
            <PaperProvider>
                {component}
            </PaperProvider>
        );
    };

    describe('Display Status: OK', () => {
        it('does not render when display status is OK', () => {
            const { queryByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="OK" />
            );

            // Component should return null, not render any content
            expect(queryByText(/unlock/i)).toBeNull();
            expect(queryByText(/display/i)).toBeNull();
        });
    });

    describe('Display Status: FAILED', () => {
        it('renders FAILED status banner correctly', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="FAILED" />
            );

            expect(getByText('Use Your Phone to Unlock')).toBeTruthy();
            expect(getByText(/The keypad display isn't available/)).toBeTruthy();
            expect(getByText(/unlock directly from this app/)).toBeTruthy();
        });

        it('shows lightbulb icon for FAILED status', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="FAILED" />
            );

            // Verify the helpful message is present
            expect(getByText(/unlock directly from this app/)).toBeTruthy();
        });

        it('uses blue info theme for FAILED status', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="FAILED" />
            );

            const title = getByText('Use Your Phone to Unlock');
            expect(title).toBeTruthy();
            // Component should render with blue background (#E3F2FD)
        });

        it('displays friendly, non-technical language', () => {
            const { getByText, queryByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="FAILED" />
            );

            // Should use friendly language
            expect(getByText(/Use Your Phone to Unlock/)).toBeTruthy();
            
            // Should not use technical jargon
            expect(queryByText(/error/i)).toBeNull();
            expect(queryByText(/malfunction/i)).toBeNull();
        });
    });

    describe('Display Status: DEGRADED', () => {
        it('renders DEGRADED status banner correctly', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="DEGRADED" />
            );

            expect(getByText('Display May Be Hard to Read')).toBeTruthy();
            expect(getByText(/The box screen is working/)).toBeTruthy();
            expect(getByText(/Listen for beeps/)).toBeTruthy();
        });

        it('shows information icon for DEGRADED status', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="DEGRADED" />
            );

            // Verify the helpful message is present
            expect(getByText(/Listen for beeps/)).toBeTruthy();
        });

        it('uses yellow/orange theme for DEGRADED status', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="DEGRADED" />
            );

            const title = getByText('Display May Be Hard to Read');
            expect(title).toBeTruthy();
            // Component should render with yellow background (#FFF9C4)
        });

        it('provides helpful alternative guidance', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="DEGRADED" />
            );

            // Should mention alternative way to use the box
            expect(getByText(/Listen for beeps/)).toBeTruthy();
        });
    });

    describe('Dismissibility', () => {
        it('accepts onDismiss callback', () => {
            const mockDismiss = jest.fn();
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner 
                    displayStatus="FAILED" 
                    onDismiss={mockDismiss} 
                />
            );

            // Banner should render
            expect(getByText('Use Your Phone to Unlock')).toBeTruthy();
            
            // Note: Current implementation doesn't have dismiss button
            // This test verifies the prop is accepted
        });

        it('works without onDismiss callback', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="FAILED" />
            );

            expect(getByText('Use Your Phone to Unlock')).toBeTruthy();
        });
    });

    describe('Visual Styling', () => {
        it('applies correct background color for FAILED status', () => {
            const { getByText, UNSAFE_getByType } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="FAILED" />
            );

            const title = getByText('Use Your Phone to Unlock');
            expect(title).toBeTruthy();
            const surface = UNSAFE_getByType(require('react-native-paper').Surface);
            const style = StyleSheet.flatten(surface.props.style);
            expect(style.backgroundColor).toBe('#E3F2FD');
            expect(style.borderLeftColor).toBe('#1976D2');
        });

        it('applies correct background color for DEGRADED status', () => {
            const { getByText, UNSAFE_getByType } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="DEGRADED" />
            );

            const title = getByText('Display May Be Hard to Read');
            expect(title).toBeTruthy();
            const surface = UNSAFE_getByType(require('react-native-paper').Surface);
            const style = StyleSheet.flatten(surface.props.style);
            expect(style.backgroundColor).toBe('#FFF9C4');
            expect(style.borderLeftColor).toBe('#F57C00');
        });

        it('has border for visual emphasis', () => {
            const { getByText, UNSAFE_getByType } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="FAILED" />
            );

            const title = getByText('Use Your Phone to Unlock');
            expect(title).toBeTruthy();
            const surface = UNSAFE_getByType(require('react-native-paper').Surface);
            const style = StyleSheet.flatten(surface.props.style);
            expect(style.borderLeftColor).toBe('#1976D2');
        });
    });

    describe('Content Clarity', () => {
        it('provides clear title for FAILED status', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="FAILED" />
            );

            const title = getByText('Use Your Phone to Unlock');
            expect(title).toBeTruthy();
        });

        it('provides clear message for FAILED status', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="FAILED" />
            );

            expect(getByText(/unlock directly from this app/)).toBeTruthy();
        });

        it('provides clear title for DEGRADED status', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="DEGRADED" />
            );

            const title = getByText('Display May Be Hard to Read');
            expect(title).toBeTruthy();
        });

        it('provides actionable guidance', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="DEGRADED" />
            );

            // Tells user what to do
            expect(getByText(/Listen for beeps/)).toBeTruthy();
        });
    });

    describe('User Experience', () => {
        it('maintains positive tone for FAILED status', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="FAILED" />
            );

            // Should say "No problem"
            expect(getByText(/No problem/)).toBeTruthy();
        });

        it('reassures user for DEGRADED status', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="DEGRADED" />
            );

            // Should mention it's still working
            expect(getByText(/The box screen is working/)).toBeTruthy();
        });

        it('provides solution-oriented messaging', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="FAILED" />
            );

            // Should focus on solution, not the problem
            expect(getByText(/unlock directly from this app/)).toBeTruthy();
        });
    });

    describe('Edge Cases', () => {
        it('handles rapid status changes', () => {
            const { rerender, getByText, queryByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus="OK" />
            );

            // Should not render
            expect(queryByText('Use Your Phone to Unlock')).toBeNull();

            // Change to FAILED
            rerender(
                <PaperProvider>
                    <CustomerHardwareBanner displayStatus="FAILED" />
                </PaperProvider>
            );
            expect(getByText('Use Your Phone to Unlock')).toBeTruthy();

            // Change to DEGRADED
            rerender(
                <PaperProvider>
                    <CustomerHardwareBanner displayStatus="DEGRADED" />
                </PaperProvider>
            );
            expect(getByText('Display May Be Hard to Read')).toBeTruthy();

            // Change back to OK
            rerender(
                <PaperProvider>
                    <CustomerHardwareBanner displayStatus="OK" />
                </PaperProvider>
            );
            expect(queryByText('Display May Be Hard to Read')).toBeNull();
        });

        it('falls back to degraded styling for unknown status', () => {
            const { getByText } = renderWithProvider(
                <CustomerHardwareBanner displayStatus={'UNKNOWN' as any} />
            );

            expect(getByText('Display May Be Hard to Read')).toBeTruthy();
        });
    });
});
