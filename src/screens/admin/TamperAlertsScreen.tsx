import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, StyleSheet, FlatList, Dimensions } from 'react-native';
import { Text, Card, Avatar, ActivityIndicator } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import MapboxGL from '../../components/map/MapboxWrapper';
import { subscribeToStolenBoxes, TheftStatus } from '../../services/firebaseClient';
import { supabase } from '../../services/supabaseClient';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
const DEFAULT_CENTER: [number, number] = [121.0244, 14.5547];

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const navigation = useNavigation<any>();

    const [stolenBoxes, setStolenBoxes] = useState<Record<string, TheftStatus> | null>(null);
    const [tamperLogs, setTamperLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);

    const [cameraCenter, setCameraCenter] = useState<[number, number]>(DEFAULT_CENTER);
    const [cameraZoom, setCameraZoom] = useState<number>(12);
    const shapeSourceRef = useRef<any>(null);

    useEffect(() => {
        if (MAPBOX_TOKEN) {
            MapboxGL.setAccessToken(MAPBOX_TOKEN);
        }

        // Fetch logs
        fetchAuditLogs();

        // Subscribe to Stolen Boxes
        const unsub = subscribeToStolenBoxes((boxes) => {
            setStolenBoxes(boxes);
        });

        return () => {
            unsub();
        };
    }, []);

    const fetchAuditLogs = async () => {
        setLoading(true);
        if (!supabase) return;

        const { data: logs, error } = await supabase
            .from('audit_logs')
            .select('*')
            .in('action', ['TAMPER_ALERT', 'FORCE_UNLOCK', 'UNAUTHORIZED_ACCESS'])
            .order('created_at', { ascending: false })
            .limit(50);

        if (logs) {
            setTamperLogs(logs as AuditLog[]);
        } else if (error) {
            console.error('Failed to fetch tamper logs', error);
        }
        setLoading(false);
    };

    const activeBoxes = useMemo(() => {
        if (!stolenBoxes) return [];
        return Object.entries(stolenBoxes).map(([id, status]) => {
            return {
                id,
                lat: status.last_known_location?.lat || 0,
                lng: status.last_known_location?.lng || 0,
                status: status.state,
                reportedAt: status.reported_at
            };
        }).filter(b => b.lat !== 0 && b.lng !== 0);
    }, [stolenBoxes]);

    // Center map on first stolen box if any
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

    const renderItem = ({ item }: { item: AuditLog }) => (
        <Card style={styles.card}>
            <Card.Title
                title={`Alert: ${item.action.replace(/_/g, ' ')}`}
                subtitle={`${item.box_id || 'Unknown Box'} • ${formatTimeAgo(item.created_at)}`}
                left={(props) => <Avatar.Icon {...props} icon="shield-alert-outline" style={{ backgroundColor: '#F44336' }} />}
            />
            <Card.Content>
                <Text variant="bodyMedium">
                    {item.details?.reason || item.details?.message || 'No additional details provided.'}
                </Text>
            </Card.Content>
        </Card>
    );

    const featureCollection = {
        type: 'FeatureCollection',
        features: activeBoxes.map(b => ({
            type: 'Feature',
            id: b.id,
            properties: {
                id: b.id,
                selected: b.id === selectedBoxId
            },
            geometry: {
                type: 'Point',
                coordinates: [b.lng, b.lat]
            }
        }))
    };

    return (
        <View style={styles.container}>
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
                                    circleColor: '#F44336',
                                    circleRadius: [
                                        'case', ['get', 'selected'], 12, 8
                                    ],
                                    circleStrokeWidth: 3,
                                    circleStrokeColor: '#ffffff',
                                    circlePitchAlignment: 'map'
                                }}
                            />
                        </MapboxGL.ShapeSource>
                    </MapboxGL.MapView>
                ) : (
                    <View style={styles.mapFallback}>
                        <Text style={{ color: '#666' }}>Map disabled: Missing Mapbox Token</Text>
                    </View>
                )}

                {/* Overlay active count */}
                <View style={styles.mapOverlay}>
                    <Card style={styles.overlayCard}>
                        <Card.Content style={styles.overlayContent}>
                            <MaterialCommunityIcons name="alert" size={20} color="#F44336" />
                            <Text variant="titleSmall" style={{ marginLeft: 8, color: '#F44336', fontWeight: 'bold' }}>
                                {activeBoxes.length} Stolen Boxes
                            </Text>
                        </Card.Content>
                    </Card>
                </View>
            </View>

            <View style={styles.listContainer}>
                <Text variant="titleMedium" style={styles.listHeader}>Recent Tamper Events</Text>
                {loading ? (
                    <ActivityIndicator style={{ marginTop: 20 }} />
                ) : (
                    <FlatList
                        data={tamperLogs}
                        renderItem={renderItem}
                        keyExtractor={item => item.id}
                        contentContainerStyle={styles.listContent}
                        ListEmptyComponent={
                            <Text style={styles.emptyText}>No recent tamper events.</Text>
                        }
                    />
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    mapContainer: {
        height: Dimensions.get('window').height * 0.45,
        position: 'relative',
    },
    mapFallback: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#e0e0e0',
    },
    mapOverlay: {
        position: 'absolute',
        top: 16,
        left: 16,
    },
    overlayCard: {
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
    },
    overlayContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    listContainer: {
        flex: 1,
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        marginTop: -10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 5,
    },
    listHeader: {
        padding: 16,
        fontWeight: 'bold',
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    listContent: {
        padding: 16,
    },
    card: {
        marginBottom: 12,
        backgroundColor: '#fff',
        borderColor: '#ffcdd2',
        borderWidth: 1,
        elevation: 2,
    },
    emptyText: {
        textAlign: 'center',
        color: '#666',
        marginTop: 20,
    }
});
