import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, Animated, StyleSheet, FlatList, Dimensions, TouchableOpacity, StatusBar } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import MapboxGL from '../../components/map/MapboxWrapper';
import { subscribeToAllHardware, subscribeToAllLocations, HardwareByBoxId, HardwareDiagnostics, clearTamperStatus } from '../../services/firebaseClient';
import type { LocationsByBoxId } from '../../types';
import { supabase } from '../../services/supabaseClient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../context/ThemeContext';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
const DEFAULT_CENTER: [number, number] = [121.0244, 14.5547];

const lightC = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA', text: '#000000',
    textSec: '#6B6B6B', red: '#FF3B30', accent: '#000000', mapFallback: '#F2F2F7',
    overlay: 'rgba(255,255,255,0.95)', alertBorder: '#FECACA',
};
const darkC = {
    bg: '#000000', card: '#141414', border: '#2C2C2E', text: '#FFFFFF',
    textSec: '#8E8E93', red: '#FF453A', accent: '#FFFFFF', mapFallback: '#1C1C1E',
    overlay: 'rgba(20,20,20,0.95)', alertBorder: '#3C1515',
};

interface AuditLog {
    id: string;
    action: string;
    details: any;
    user_id: string | null;
    box_id: string | null;
    delivery_id: string | null;
    created_at: string;
}

export default function TamperAlertsScreen() {
    const navigation = useNavigation<any>();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;

    const [hardware, setHardware] = useState<HardwareByBoxId | null>(null);
    const [locations, setLocations] = useState<LocationsByBoxId | null>(null);
    const [clearingBoxId, setClearingBoxId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);

    const [cameraCenter, setCameraCenter] = useState<[number, number]>(DEFAULT_CENTER);
    const [cameraZoom, setCameraZoom] = useState<number>(12);
    const shapeSourceRef = useRef<any>(null);

    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
        }
        
        setLoading(true);
        const unsubHw = subscribeToAllHardware((hw) => {
            setHardware(hw);
            setLoading(false);
        });
        const unsubLoc = subscribeToAllLocations((locs) => {
            setLocations(locs);
        });
        return () => { unsubHw(); unsubLoc(); };
    }, []);

    const activeBoxes = useMemo(() => {
        if (!hardware) return [];
        return Object.entries(hardware)
            .filter(([, status]) => status.tamper?.detected || status.tamper?.lockdown)
            .map(([id, status]) => {
                const loc = locations?.[id];
                return {
                    id,
                    lat: loc?.latitude ?? 0,
                    lng: loc?.longitude ?? 0,
                    status: 'TAMPERED' as const,
                    reportedAt: (status.tamper as any)?.timestamp_str || new Date().toISOString(),
                };
            });
    }, [hardware, locations]);

    useEffect(() => {
        if (activeBoxes.length > 0 && cameraCenter[0] === DEFAULT_CENTER[0] && cameraCenter[1] === DEFAULT_CENTER[1]) {
            setCameraCenter([activeBoxes[0].lng, activeBoxes[0].lat]);
            setCameraZoom(14);
        }
    }, [activeBoxes, cameraCenter]);

    const selectBox = (boxId: string) => {
        setSelectedBoxId(boxId);
        const box = activeBoxes.find((b) => b.id === boxId);
        if (box) {
            setCameraCenter([box.lng, box.lat]);
            setCameraZoom(15);
        }
    };

    const formatTimeAgo = (dateString: string | number) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
        if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
        return `${Math.floor(diffInSeconds / 86400)}d ago`;
    };

    const handleClearTamper = async (boxId: string) => {
        setClearingBoxId(boxId);
        try {
            await clearTamperStatus(boxId);
        } catch (e) {
            console.error('Failed to clear tamper', e);
        } finally {
            setClearingBoxId(null);
        }
    };

    const renderItem = ({ item }: { item: typeof activeBoxes[0] }) => (
        <View style={[styles.alertCard, { backgroundColor: c.card, borderColor: c.alertBorder }]}>
            <View style={[styles.alertIconWrap, { backgroundColor: isDarkMode ? '#3C1515' : '#FEE2E2' }]}>
                <MaterialCommunityIcons name="shield-alert-outline" size={20} color={c.red} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.alertTitle, { color: c.text }]}>
                    Tamper Detected
                </Text>
                <Text style={[styles.alertSub, { color: c.textSec }]}>
                    {item.id} · {formatTimeAgo(item.reportedAt)}
                </Text>
                <Text style={[styles.alertBody, { color: c.textSec }]}>
                    Unauthorized lid open or lock bypass.
                </Text>
            </View>
            <TouchableOpacity 
                style={[styles.clearButton, { backgroundColor: c.red }]} 
                onPress={() => handleClearTamper(item.id)}
                disabled={clearingBoxId === item.id}
            >
                {clearingBoxId === item.id ? (
                    <ActivityIndicator size={16} color="#FFF" />
                ) : (
                    <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600' }}>Clear</Text>
                )}
            </TouchableOpacity>
        </View>
    );

    const featureCollection = {
        type: 'FeatureCollection',
        features: activeBoxes.map(b => ({
            type: 'Feature',
            id: b.id,
            properties: { id: b.id, selected: b.id === selectedBoxId },
            geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
        })),
    };

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.container, { backgroundColor: c.bg }, screenAnim.style]}>
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />

            <View style={styles.mapContainer}>
                {MAPBOX_TOKEN ? (
                    <MapboxGL.MapView
                        style={StyleSheet.absoluteFillObject}
                        logoEnabled={false}
                        attributionEnabled={false}
                        onPress={() => setSelectedBoxId(null)}
                    >
                        <MapboxGL.Camera zoomLevel={cameraZoom} centerCoordinate={cameraCenter} animationDuration={1000} />
                        <MapboxGL.ShapeSource
                            id="stolen-boxes-source"
                            ref={shapeSourceRef}
                            shape={featureCollection as any}
                            onPress={(e: any) => {
                                const feature = e.features[0];
                                if (feature && feature.properties?.id) {
                                    selectBox(feature.properties.id);
                                }
                            }}
                        >
                            <MapboxGL.CircleLayer
                                id="stolen-boxes-circles"
                                style={{
                                    circleColor: c.red,
                                    circleRadius: ['case', ['get', 'selected'], 12, 8],
                                    circleStrokeWidth: 3,
                                    circleStrokeColor: isDarkMode ? '#000' : '#fff',
                                    circlePitchAlignment: 'map',
                                }}
                            />
                        </MapboxGL.ShapeSource>
                    </MapboxGL.MapView>
                ) : (
                    <View style={[styles.mapFallback, { backgroundColor: c.mapFallback }]}>
                        <Text style={{ color: c.textSec }}>Map unavailable: Missing Mapbox Token</Text>
                    </View>
                )}

                {/* Overlay badge */}
                <View style={styles.mapOverlay}>
                    <View style={[styles.overlayPill, { backgroundColor: c.overlay }]}>
                        <MaterialCommunityIcons name="alert-octagon" size={16} color={c.red} />
                        <Text style={[styles.overlayText, { color: c.red }]}>
                            {activeBoxes.length} Tamper Alerts
                        </Text>
                    </View>
                </View>
            </View>

            <View style={[styles.listContainer, { backgroundColor: c.bg }]}>
                <Text style={[styles.listHeader, { color: c.text, borderBottomColor: c.border }]}>
                    Tamper Alerts
                </Text>
                {loading ? (
                    <ActivityIndicator style={{ marginTop: 20 }} />
                ) : (
                    <FlatList
                        data={activeBoxes}
                        renderItem={renderItem}
                        keyExtractor={item => item.id}
                        contentContainerStyle={styles.listContent}
                        ListEmptyComponent={
                            <View style={styles.emptyWrap}>
                                <MaterialCommunityIcons name="shield-check-outline" size={40} color={c.textSec} />
                                <Text style={[styles.emptyText, { color: c.textSec }]}>No recent tamper events.</Text>
                            </View>
                        }
                    />
                )}
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    mapContainer: {
        height: Dimensions.get('window').height * 0.4,
        position: 'relative',
    },
    mapFallback: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    mapOverlay: {
        position: 'absolute',
        top: 50,
        left: 16,
    },
    overlayPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
    },
    overlayText: {
        fontSize: 13,
        fontWeight: '700',
    },
    listContainer: {
        flex: 1,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        marginTop: -12,
    },
    listHeader: {
        padding: 20,
        paddingBottom: 12,
        fontSize: 17,
        fontWeight: '700',
        borderBottomWidth: 0.5,
    },
    listContent: {
        padding: 16,
    },
    alertCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
    },
    alertIconWrap: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    alertTitle: {
        fontSize: 14,
        fontWeight: '700',
    },
    alertSub: {
        fontSize: 12,
        marginTop: 2,
    },
    alertBody: {
        fontSize: 12,
        marginTop: 4,
        lineHeight: 16,
    },    clearButton: {
        marginLeft: 12,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },    emptyWrap: {
        alignItems: 'center',
        paddingTop: 40,
        gap: 12,
    },
    emptyText: {
        textAlign: 'center',
    },
});
