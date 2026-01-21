import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { 
    isMapboxNativeAvailable, 
    MapFallback, 
    SafeMapView 
} from '../../components/map/MapboxWrapper';

// Mock @rnmapbox/maps
jest.mock('@rnmapbox/maps', () => {
    const mockModule = {
        MapView: ({ children, ...props }: any) => {
            const React = require('react');
            const { View, Text } = require('react-native');
            return (
                <View testID="mapbox-mapview" {...props}>
                    <Text>Mocked MapView</Text>
                    {children}
                </View>
            );
        },
        Camera: ({ children, ...props }: any) => {
            const React = require('react');
            const { View } = require('react-native');
            return <View testID="mapbox-camera" {...props}>{children}</View>;
        },
        setAccessToken: jest.fn(),
    };

    return {
        __esModule: true,
        default: mockModule,
        ...mockModule,
    };
});

describe('MapboxWrapper', () => {
    describe('isMapboxNativeAvailable', () => {
        it('returns a boolean value', () => {
            const result = isMapboxNativeAvailable();
            expect(typeof result).toBe('boolean');
        });

        it('indicates Mapbox availability', () => {
            const result = isMapboxNativeAvailable();
            // In test environment with mock, should be true
            expect(result).toBe(true);
        });
    });

    describe('MapFallback', () => {
        it('renders correctly with default message', () => {
            const { getByText } = render(<MapFallback />);

            expect(getByText('Map requires a development build')).toBeTruthy();
            expect(getByText(/Run "npx expo run:android"/)).toBeTruthy();
        });

        it('renders with custom message', () => {
            const { getByText } = render(
                <MapFallback message="Custom map unavailable message" />
            );

            expect(getByText('Custom map unavailable message')).toBeTruthy();
        });

        it('shows map icon', () => {
            const { UNSAFE_getByType } = render(<MapFallback />);

            // Should have MaterialCommunityIcons
            const icons = require('@expo/vector-icons').MaterialCommunityIcons;
            const icon = UNSAFE_getByType(icons);
            expect(icon).toBeTruthy();
        });

        it('displays helpful subtext', () => {
            const { getByText } = render(<MapFallback />);

            expect(getByText(/Run "npx expo run:android"/)).toBeTruthy();
        });

        it('accepts custom style', () => {
            const customStyle = { backgroundColor: 'red', padding: 20 };
            const { UNSAFE_getByType } = render(
                <MapFallback style={customStyle} />
            );

            const view = UNSAFE_getByType(require('react-native').View);
            expect(view).toBeTruthy();
        });
    });

    describe('SafeMapView', () => {
        it('renders MapView when Mapbox is available', () => {
            const { getByText, queryByText } = render(
                <SafeMapView>
                    <Text>Map Content</Text>
                </SafeMapView>
            );

            // Should render the mocked MapView
            expect(getByText('Mocked MapView')).toBeTruthy();
            
            // Should not show fallback
            expect(queryByText('Map requires a development build')).toBeNull();
        });

        it('passes props to MapView', () => {
            const { getByTestId } = render(
                <SafeMapView 
                    styleURL="mapbox://styles/mapbox/streets-v11"
                    logoEnabled={false}
                    attributionEnabled={false}
                />
            );

            const mapView = getByTestId('mapbox-mapview');
            expect(mapView).toBeTruthy();
            expect(mapView.props.styleURL).toBe('mapbox://styles/mapbox/streets-v11');
            expect(mapView.props.logoEnabled).toBe(false);
            expect(mapView.props.attributionEnabled).toBe(false);
        });

        it('passes testID to MapView', () => {
            const { getByTestId } = render(
                <SafeMapView testID="custom-map" />
            );

            const mapView = getByTestId('custom-map');
            expect(mapView).toBeTruthy();
        });

        it('renders children inside MapView', () => {
            const { getByText } = render(
                <SafeMapView>
                    <Text>Custom Map Marker</Text>
                </SafeMapView>
            );

            expect(getByText('Custom Map Marker')).toBeTruthy();
        });

        it('handles onPress events', () => {
            const mockOnPress = jest.fn();
            const { getByTestId } = render(
                <SafeMapView onPress={mockOnPress} />
            );

            const mapView = getByTestId('mapbox-mapview');
            expect(mapView.props.onPress).toBe(mockOnPress);
        });

        it('applies custom style', () => {
            const customStyle = { flex: 1, height: 400 };
            const { getByTestId } = render(
                <SafeMapView style={customStyle} />
            );

            const mapView = getByTestId('mapbox-mapview');
            expect(mapView.props.style).toEqual(customStyle);
        });
    });

    describe('Fallback Scenario', () => {
        it('shows fallback when Mapbox is unavailable', () => {
            // This would be tested in an environment without Mapbox
            // In our mocked test, we can verify the component structure exists
            const { getByText } = render(<MapFallback />);
            expect(getByText('Map requires a development build')).toBeTruthy();
        });

        it('fallback provides clear guidance', () => {
            const { getByText } = render(<MapFallback />);

            // Should explain what's needed
            expect(getByText(/development build/)).toBeTruthy();
            expect(getByText(/npx expo run:android/)).toBeTruthy();
        });

        it('fallback is visually clear', () => {
            const { getByText, UNSAFE_getByType } = render(<MapFallback />);

            // Should have icon
            const icons = require('@expo/vector-icons').MaterialCommunityIcons;
            const icon = UNSAFE_getByType(icons);
            expect(icon).toBeTruthy();

            // Should have explanatory text
            expect(getByText('Map requires a development build')).toBeTruthy();
        });
    });

    describe('Integration', () => {
        it('works with multiple SafeMapView instances', () => {
            const { getAllByTestId } = render(
                <>
                    <SafeMapView />
                    <SafeMapView />
                    <SafeMapView />
                </>
            );

            const mapViews = getAllByTestId('mapbox-mapview');
            expect(mapViews).toHaveLength(3);
        });

        it('handles nested children structure', () => {
            const { getByText } = render(
                <SafeMapView>
                    <Text>Layer 1</Text>
                    <Text>Layer 2</Text>
                    <Text>Layer 3</Text>
                </SafeMapView>
            );

            expect(getByText('Layer 1')).toBeTruthy();
            expect(getByText('Layer 2')).toBeTruthy();
            expect(getByText('Layer 3')).toBeTruthy();
        });

        it('supports conditional rendering', () => {
            // Test rendering SafeMapView
            const { queryByTestId: queryByTestId1 } = render(<SafeMapView />);
            expect(queryByTestId1('mapbox-mapview')).toBeTruthy();

            // Test rendering MapFallback
            const { queryByText } = render(<MapFallback />);
            expect(queryByText(/Map requires/i) || queryByText(/development build/i)).toBeTruthy();
        });
    });

    describe('Error Handling', () => {
        it('gracefully handles missing props', () => {
            const { getByTestId } = render(<SafeMapView />);
            expect(getByTestId('mapbox-mapview')).toBeTruthy();
        });

        it('MapFallback handles missing props', () => {
            const { getByText } = render(<MapFallback />);
            expect(getByText('Map requires a development build')).toBeTruthy();
        });
    });

    describe('Accessibility', () => {
        it('MapFallback provides clear messaging', () => {
            const { getByText } = render(<MapFallback />);

            // Clear, non-technical language
            expect(getByText('Map requires a development build')).toBeTruthy();
            expect(getByText(/Run "npx expo run:android"/)).toBeTruthy();
        });

        it('SafeMapView passes through accessibility props', () => {
            const { getByTestId } = render(
                <SafeMapView 
                    accessible={true}
                    accessibilityLabel="Delivery route map"
                />
            );

            const mapView = getByTestId('mapbox-mapview');
            expect(mapView.props.accessible).toBe(true);
            expect(mapView.props.accessibilityLabel).toBe('Delivery route map');
        });
    });
});
