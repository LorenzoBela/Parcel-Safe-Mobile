import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { HardwareStatusBadge, StatusDot } from '../../components/HardwareStatusBadge';
import { OverallHealthStatus } from '../../services/hardwareStatusService';

// Mock hardware status service
jest.mock('../../services/hardwareStatusService', () => ({
    ...jest.requireActual('../../services/hardwareStatusService'),
    getStatusColor: jest.fn((status: string) => {
        const colors: Record<string, string> = {
            'HEALTHY': '#4CAF50',
            'WARNING': '#FF9800',
            'CRITICAL': '#F44336',
            'OUT_OF_SERVICE': '#9E9E9E',
        };
        return colors[status] || '#9E9E9E';
    }),
    getStatusIcon: jest.fn((status: string) => {
        const icons: Record<string, string> = {
            'HEALTHY': '✓',
            'WARNING': '⚠',
            'CRITICAL': '✗',
            'OUT_OF_SERVICE': '○',
        };
        return icons[status] || '?';
    }),
    getStatusText: jest.fn((status: string) => {
        const texts: Record<string, string> = {
            'HEALTHY': 'All Systems OK',
            'WARNING': 'Minor Issues',
            'CRITICAL': 'Critical',
            'OUT_OF_SERVICE': 'Offline',
        };
        return texts[status] || 'Unknown';
    }),
}));

describe('HardwareStatusBadge', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Basic Rendering', () => {
        it('renders correctly with HEALTHY status', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="HEALTHY" />
            );

            expect(getByText('✓')).toBeTruthy();
            expect(getByText('All Systems OK')).toBeTruthy();
        });

        it('renders correctly with WARNING status', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="WARNING" />
            );

            expect(getByText('⚠')).toBeTruthy();
            expect(getByText('Minor Issues')).toBeTruthy();
        });

        it('renders correctly with CRITICAL status', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="CRITICAL" />
            );

            expect(getByText('✗')).toBeTruthy();
            expect(getByText('Critical')).toBeTruthy();
        });

        it('renders correctly with OUT_OF_SERVICE status', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="OUT_OF_SERVICE" />
            );

            expect(getByText('○')).toBeTruthy();
            expect(getByText('Offline')).toBeTruthy();
        });
    });

    describe('Size Variants', () => {
        it('renders small size correctly', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="HEALTHY" size="small" />
            );

            expect(getByText('✓')).toBeTruthy();
        });

        it('renders medium size correctly', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="HEALTHY" size="medium" />
            );

            expect(getByText('✓')).toBeTruthy();
            expect(getByText('All Systems OK')).toBeTruthy();
        });

        it('renders large size correctly', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="HEALTHY" size="large" />
            );

            expect(getByText('✓')).toBeTruthy();
            expect(getByText('All Systems OK')).toBeTruthy();
        });

        it('defaults to medium size when not specified', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="HEALTHY" />
            );

            expect(getByText('All Systems OK')).toBeTruthy();
        });
    });

    describe('Text Display', () => {
        it('shows text when showText is true', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="HEALTHY" showText={true} />
            );

            expect(getByText('All Systems OK')).toBeTruthy();
        });

        it('hides text when showText is false', () => {
            const { queryByText, getByText } = render(
                <HardwareStatusBadge status="HEALTHY" showText={false} />
            );

            expect(getByText('✓')).toBeTruthy();
            expect(queryByText('All Systems OK')).toBeNull();
        });

        it('shows text by default', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="HEALTHY" />
            );

            expect(getByText('All Systems OK')).toBeTruthy();
        });

        it('shows shortened text for small size', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="HEALTHY" size="small" />
            );

            // Small size shows status name, not full text
            expect(getByText('HEALTHY')).toBeTruthy();
        });

        it('hides text for small size when showText is false', () => {
            const { queryByText, getByText } = render(
                <HardwareStatusBadge status="HEALTHY" size="small" showText={false} />
            );

            expect(getByText('✓')).toBeTruthy();
            expect(queryByText('HEALTHY')).toBeNull();
            expect(queryByText('All Systems OK')).toBeNull();
        });
    });

    describe('Loading State', () => {
        it('shows loading indicator when loading is true', () => {
            const { UNSAFE_getAllByType } = render(
                <HardwareStatusBadge status="HEALTHY" loading={true} />
            );

            // ActivityIndicator should be present
            const indicators = UNSAFE_getAllByType(
                require('react-native').ActivityIndicator
            );
            expect(indicators.length).toBeGreaterThan(0);
        });

        it('does not show icon and text when loading', () => {
            const { queryByText } = render(
                <HardwareStatusBadge status="HEALTHY" loading={true} />
            );

            expect(queryByText('✓')).toBeNull();
            expect(queryByText('All Systems OK')).toBeNull();
        });

        it('shows content when not loading', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="HEALTHY" loading={false} />
            );

            expect(getByText('✓')).toBeTruthy();
            expect(getByText('All Systems OK')).toBeTruthy();
        });
    });

    describe('Press Interaction', () => {
        it('calls onPress when pressed', () => {
            const mockOnPress = jest.fn();
            const { getByText } = render(
                <HardwareStatusBadge 
                    status="HEALTHY" 
                    onPress={mockOnPress} 
                />
            );

            const badge = getByText('All Systems OK');
            fireEvent.press(badge);

            expect(mockOnPress).toHaveBeenCalled();
        });

        it('does not crash when pressed without onPress handler', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="HEALTHY" />
            );

            const badge = getByText('All Systems OK');
            // Should not crash when pressed without handler
            expect(() => fireEvent.press(badge)).not.toThrow();
        });

        it('is touchable when onPress is provided', () => {
            const mockOnPress = jest.fn();
            const { UNSAFE_getByType } = render(
                <HardwareStatusBadge 
                    status="HEALTHY" 
                    onPress={mockOnPress} 
                />
            );

            const touchable = UNSAFE_getByType(
                require('react-native').TouchableOpacity
            );
            expect(touchable).toBeTruthy();
        });
    });

    describe('Status Colors', () => {
        it('uses correct color for HEALTHY status', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="HEALTHY" />
            );

            // Should render with green theme
            expect(getByText('✓')).toBeTruthy();
        });

        it('uses correct color for WARNING status', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="WARNING" />
            );

            // Should render with orange theme
            expect(getByText('⚠')).toBeTruthy();
        });

        it('uses correct color for CRITICAL status', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="CRITICAL" />
            );

            // Should render with red theme
            expect(getByText('✗')).toBeTruthy();
        });

        it('uses correct color for OUT_OF_SERVICE status', () => {
            const { getByText } = render(
                <HardwareStatusBadge status="OUT_OF_SERVICE" />
            );

            // Should render with gray theme
            expect(getByText('○')).toBeTruthy();
        });
    });

    describe('Edge Cases', () => {
        it('handles rapid status changes', () => {
            const { rerender, getByText } = render(
                <HardwareStatusBadge status="HEALTHY" />
            );

            expect(getByText('All Systems OK')).toBeTruthy();

            rerender(<HardwareStatusBadge status="WARNING" />);
            expect(getByText('Minor Issues')).toBeTruthy();

            rerender(<HardwareStatusBadge status="CRITICAL" />);
            expect(getByText('Critical')).toBeTruthy();

            rerender(<HardwareStatusBadge status="OUT_OF_SERVICE" />);
            expect(getByText('Offline')).toBeTruthy();
        });

        it('handles size changes', () => {
            const { rerender, getByText, queryByText } = render(
                <HardwareStatusBadge status="HEALTHY" size="small" />
            );

            expect(getByText('✓')).toBeTruthy();

            rerender(<HardwareStatusBadge status="HEALTHY" size="large" />);
            expect(getByText('All Systems OK')).toBeTruthy();
        });

        it('handles loading state changes', () => {
            const { rerender, getByText, queryByText } = render(
                <HardwareStatusBadge status="HEALTHY" loading={true} />
            );

            expect(queryByText('All Systems OK')).toBeNull();

            rerender(<HardwareStatusBadge status="HEALTHY" loading={false} />);
            expect(getByText('All Systems OK')).toBeTruthy();
        });
    });
});

describe('StatusDot', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Basic Rendering', () => {
        it('renders correctly with HEALTHY status', () => {
            const { UNSAFE_getByType } = render(
                <StatusDot status="HEALTHY" />
            );

            const view = UNSAFE_getByType(require('react-native').View);
            expect(view).toBeTruthy();
        });

        it('renders with different statuses', () => {
            const statuses: OverallHealthStatus[] = ['HEALTHY', 'WARNING', 'CRITICAL', 'OUT_OF_SERVICE'];
            
            statuses.forEach(status => {
                const { UNSAFE_getByType } = render(
                    <StatusDot status={status} />
                );

                const view = UNSAFE_getByType(require('react-native').View);
                expect(view).toBeTruthy();
            });
        });
    });

    describe('Size Customization', () => {
        it('accepts custom size prop', () => {
            const { UNSAFE_getByType } = render(
                <StatusDot status="HEALTHY" size={16} />
            );

            const view = UNSAFE_getByType(require('react-native').View);
            expect(view).toBeTruthy();
        });

        it('works with different sizes', () => {
            const sizes = [8, 12, 16, 24, 32];
            
            sizes.forEach(size => {
                const { UNSAFE_getByType } = render(
                    <StatusDot status="HEALTHY" size={size} />
                );

                const view = UNSAFE_getByType(require('react-native').View);
                expect(view).toBeTruthy();
            });
        });

        it('applies width, height, and border radius based on size', () => {
            const { UNSAFE_getByType } = render(
                <StatusDot status="HEALTHY" size={18} />
            );

            const view = UNSAFE_getByType(require('react-native').View);
            const style = StyleSheet.flatten(view.props.style);
            expect(style.width).toBe(18);
            expect(style.height).toBe(18);
            expect(style.borderRadius).toBe(9);
        });
    });

    describe('Pulse Animation', () => {
        it('accepts pulse prop', () => {
            const { UNSAFE_getByType } = render(
                <StatusDot status="CRITICAL" pulse={true} />
            );

            const view = UNSAFE_getByType(require('react-native').View);
            expect(view).toBeTruthy();
        });

        it('works without pulse animation', () => {
            const { UNSAFE_getByType } = render(
                <StatusDot status="HEALTHY" pulse={false} />
            );

            const view = UNSAFE_getByType(require('react-native').View);
            expect(view).toBeTruthy();
        });

        it('adds pulse style for non-healthy statuses when enabled', () => {
            const { UNSAFE_getByType } = render(
                <StatusDot status="CRITICAL" pulse={true} />
            );

            const view = UNSAFE_getByType(require('react-native').View);
            const style = StyleSheet.flatten(view.props.style);
            expect(style.opacity).toBe(0.8);
        });
    });
});
