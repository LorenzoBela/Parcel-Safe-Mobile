/**
 * MapboxWrapper.tsx
 * 
 * A compatibility wrapper for @rnmapbox/maps that gracefully handles
 * environments where native code isn't available (like Expo Go).
 * 
 * Usage: Import MapboxGL from this file instead of '@rnmapbox/maps'
 */

import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Flag to track if MapboxGL is available
let isMapboxAvailable = false;
let MapboxGLModule: any = null;

// Defer the check to avoid top-level errors
const initMapbox = () => {
    if (MapboxGLModule !== null) return; // Already initialized

    try {
        // Attempt to require the native module
        const module = require('@rnmapbox/maps');


        MapboxGLModule = module.default || module;


        // Test if native code is actually available by checking a key property
        const hasSetAccessToken = MapboxGLModule && typeof MapboxGLModule.setAccessToken === 'function';


        if (hasSetAccessToken) {
            // Do a deeper check - try to access MapView
            const hasMapView = !!MapboxGLModule.MapView;


            if (hasMapView) {
                isMapboxAvailable = true;
                // console.log('[MapboxWrapper] ✓ Native module detected as AVAILABLE');
            } else {
                console.log('[MapboxWrapper] ✗ MapView component not found');
            }
        } else {
            console.log('[MapboxWrapper] ✗ setAccessToken function not found, typeof:', typeof MapboxGLModule?.setAccessToken);
        }
    } catch (error) {
        console.log('[MapboxWrapper] @rnmapbox/maps not available:', error);
        isMapboxAvailable = false;
        MapboxGLModule = null;
    }
};

// Initialize on first import
try {
    initMapbox();
} catch (e) {
    console.log('[MapboxWrapper] Failed to initialize:', e);
    isMapboxAvailable = false;
}

/**
 * Check if Mapbox native code is available
 */
export const isMapboxNativeAvailable = (): boolean => isMapboxAvailable;

/**
 * Fallback component shown when Mapbox isn't available
 */
interface MapFallbackProps {
    message?: string;
    style?: any;
}

export const MapFallback: React.FC<MapFallbackProps> = ({
    message = 'Map requires a development build',
    style
}) => (
    <View style={[styles.fallback, style]}>
        <MaterialCommunityIcons name="map-outline" size={64} color="#666" />
        <Text style={styles.fallbackText}>{message}</Text>
        <Text style={styles.fallbackSubtext}>
            Run "npx expo run:android" to enable maps
        </Text>
    </View>
);

/**
 * Safe MapView that shows fallback when native code isn't available
 */
interface SafeMapViewProps {
    style?: any;
    styleURL?: string;
    logoEnabled?: boolean;
    attributionEnabled?: boolean;
    children?: React.ReactNode;
    onPress?: (event: any) => void;
    [key: string]: any;
}

export const SafeMapView: React.FC<SafeMapViewProps> = ({
    style,
    children,
    ...props
}) => {
    if (!isMapboxAvailable || !MapboxGLModule) {
        return <MapFallback style={style} />;
    }

    const RealMapView = MapboxGLModule.MapView;
    return (
        <RealMapView style={style} {...props}>
            {children}
        </RealMapView>
    );
};

/**
 * Create mock components for when Mapbox isn't available
 */
const createMockComponent = (name: string) => {
    const MockComponent = React.forwardRef((props: any, ref) => {
        const { children, ...restProps } = props;
        if (isMapboxAvailable && MapboxGLModule && MapboxGLModule[name]) {
            const RealComponent = MapboxGLModule[name];
            return <RealComponent {...restProps} ref={ref}>{children}</RealComponent>;
        }
        // Return null for non-visual components
        return null;
    });
    MockComponent.displayName = `Safe${name}`;
    return MockComponent;
};

// Create safe versions of commonly used components
const SafeCamera = createMockComponent('Camera');
const SafePointAnnotation = createMockComponent('PointAnnotation');
const SafeShapeSource = createMockComponent('ShapeSource');
const SafeLineLayer = createMockComponent('LineLayer');
const SafeCircleLayer = createMockComponent('CircleLayer');
const SafeFillLayer = createMockComponent('FillLayer');
const SafeMarkerView = createMockComponent('MarkerView');
const SafeUserLocation = createMockComponent('UserLocation');
const SafeSymbolLayer = createMockComponent('SymbolLayer');
const SafeImages = createMockComponent('Images');

/**
 * Safe wrapper for setAccessToken
 */
export const setAccessToken = (token: string): void => {
    if (isMapboxAvailable && MapboxGLModule) {
        try {
            MapboxGLModule.setAccessToken(token);
        } catch (error) {
            console.warn('[MapboxWrapper] Failed to set access token:', error);
        }
    } else {
        console.log('[MapboxWrapper] Skipping setAccessToken - native module not available');
    }
};

/**
 * Safe wrapper for setTelemetryEnabled
 */
export const setTelemetryEnabled = (enabled: boolean): void => {
    if (isMapboxAvailable && MapboxGLModule) {
        try {
            MapboxGLModule.setTelemetryEnabled(enabled);
        } catch (error) {
            console.warn('[MapboxWrapper] Failed to set telemetry:', error);
        }
    }
};

/**
 * StyleURL constants (with fallbacks)
 */
export const StyleURL = {
    Street: (isMapboxAvailable && MapboxGLModule?.StyleURL?.Street) || 'mapbox://styles/mapbox/streets-v12',
    Dark: (isMapboxAvailable && MapboxGLModule?.StyleURL?.Dark) || 'mapbox://styles/mapbox/dark-v11',
    Light: (isMapboxAvailable && MapboxGLModule?.StyleURL?.Light) || 'mapbox://styles/mapbox/light-v11',
    Outdoors: (isMapboxAvailable && MapboxGLModule?.StyleURL?.Outdoors) || 'mapbox://styles/mapbox/outdoors-v12',
    Satellite: (isMapboxAvailable && MapboxGLModule?.StyleURL?.Satellite) || 'mapbox://styles/mapbox/satellite-v9',
    SatelliteStreets: (isMapboxAvailable && MapboxGLModule?.StyleURL?.SatelliteStreets) || 'mapbox://styles/mapbox/satellite-streets-v12',
};

const styles = StyleSheet.create({
    fallback: {
        flex: 1,
        backgroundColor: '#1a1a2e',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    fallbackText: {
        color: '#888',
        fontSize: 16,
        marginTop: 16,
        textAlign: 'center',
    },
    fallbackSubtext: {
        color: '#555',
        fontSize: 12,
        marginTop: 8,
        textAlign: 'center',
    },
});

// Default export mimics the @rnmapbox/maps structure
const MapboxGL = {
    MapView: SafeMapView,
    Camera: SafeCamera,
    PointAnnotation: SafePointAnnotation,
    ShapeSource: SafeShapeSource,
    LineLayer: SafeLineLayer,
    CircleLayer: SafeCircleLayer,
    MarkerView: SafeMarkerView,
    UserLocation: SafeUserLocation,
    FillLayer: SafeFillLayer,
    SymbolLayer: SafeSymbolLayer,
    Images: SafeImages,
    setAccessToken,
    setTelemetryEnabled,
    StyleURL,
    isAvailable: isMapboxNativeAvailable,
};

export { MapboxGL };
export default MapboxGL;
