/**
 * TheftAlertScreen.tsx - EC-81: Top Box Stolen
 * 
 * Screen for riders to report theft, view tracking status, and download evidence.
 * Features:
 * - Report Theft button with confirmation
 * - Live theft status display
 * - Track My Box map link
 * - Evidence download for insurance
 * 
 * Firebase Path: /boxes/{mac_address}/theft_status
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Linking, Share } from 'react-native';
import { Text, Card, Button, Surface, Chip, useTheme, Avatar, Divider, TextInput, ActivityIndicator } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
    subscribeToTheftStatus,
    reportTheft,
    getLocationHistory,
    generateEvidencePackage,
    formatEvidenceAsText,
    getTheftSeverity,
    getTheftSeverityColor,
    formatTheftState,
    TheftStatus,
    LocationHistoryEntry,
} from '../../services/theftService';

dayjs.extend(relativeTime);

export default function TheftAlertScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const theme = useTheme();

    // Get boxId from navigation params or use demo ID
    const boxId = route.params?.boxId || 'BOX_001';
    const riderId = route.params?.riderId || 'RIDER_001';

    // State
    const [theftStatus, setTheftStatus] = useState<TheftStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [reporting, setReporting] = useState(false);
    const [notes, setNotes] = useState('');
    const [showNotesInput, setShowNotesInput] = useState(false);
    const [exportingEvidence, setExportingEvidence] = useState(false);

    // Subscribe to theft status
    useEffect(() => {
        const unsubscribe = subscribeToTheftStatus(boxId, (status) => {
            setTheftStatus(status);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [boxId]);

    // Report theft handler
    const handleReportTheft = async () => {
        Alert.alert(
            '🚨 Report Box Stolen',
            'Are you sure you want to report your box as stolen? This will alert the admin team and begin tracking.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Report Stolen',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setReporting(true);
                            await reportTheft(boxId, riderId, notes || undefined);
                            Alert.alert(
                                '✅ Theft Reported',
                                'Your box has been marked as stolen. The admin team has been notified and tracking is active.',
                                [{ text: 'OK' }]
                            );
                            setShowNotesInput(false);
                            setNotes('');
                        } catch (error) {
                            Alert.alert('Error', 'Failed to report theft. Please try again.');
                        } finally {
                            setReporting(false);
                        }
                    }
                }
            ]
        );
    };

    // Export evidence handler
    const handleExportEvidence = async () => {
        try {
            setExportingEvidence(true);
            const evidence = await generateEvidencePackage(boxId);
            const text = formatEvidenceAsText(evidence);

            await Share.share({
                message: text,
                title: `Theft Evidence - Box ${boxId}`,
            });
        } catch (error) {
            Alert.alert('Error', 'Failed to export evidence. Please try again.');
        } finally {
            setExportingEvidence(false);
        }
    };

    // Navigate to tracking map
    const handleTrackMyBox = () => {
        navigation.navigate('TrackMyBox', { boxId });
    };

    // Get severity info
    const severity = theftStatus
        ? getTheftSeverity(theftStatus)
        : 'NONE';
    const severityColor = getTheftSeverityColor(severity);

    const displayLabel = theftStatus
        ? formatTheftState(theftStatus.state)
        : 'Loading...';

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
                <Text style={{ marginTop: 16, color: '#666' }}>Loading theft status...</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
            {/* Header Banner */}
            <Surface style={[
                styles.headerBanner,
                { backgroundColor: theftStatus?.is_stolen ? '#D32F2F' : theme.colors.primary }
            ]} elevation={4}>
                <MaterialCommunityIcons
                    name={theftStatus?.is_stolen ? 'alert-circle' : 'shield-check'}
                    size={48}
                    color="white"
                />
                <View style={styles.headerText}>
                    <Text style={styles.headerTitle}>
                        {theftStatus?.is_stolen ? 'THEFT REPORTED' : 'Box Security'}
                    </Text>
                    <Text style={styles.headerSubtitle}>
                        {theftStatus?.is_stolen
                            ? 'Admin team has been notified'
                            : 'Your box is being monitored'}
                    </Text>
                </View>
            </Surface>

            {/* Current Status Card */}
            <Text style={styles.sectionTitle}>Current Status</Text>
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <View style={styles.statusRow}>
                        <View style={[styles.statusIcon, { backgroundColor: severityColor + '20' }]}>
                            <MaterialCommunityIcons
                                name={theftStatus?.is_stolen ? 'alert-circle' : 'shield-check'}
                                size={32}
                                color={severityColor}
                            />
                        </View>
                        <View style={styles.statusInfo}>
                            <Text style={[styles.statusLabel, { color: severityColor }]}>
                                {displayLabel}
                            </Text>
                            {theftStatus?.reported_at && (
                                <Text style={styles.statusTime}>
                                    Reported {dayjs(theftStatus.reported_at).fromNow()}
                                </Text>
                            )}
                        </View>
                        <Chip
                            compact
                            style={{ backgroundColor: severityColor + '20' }}
                            textStyle={{ color: severityColor }}
                        >
                            {severity}
                        </Chip>
                    </View>

                    {theftStatus?.lockdown_active && (
                        <>
                            <Divider style={{ marginVertical: 16 }} />
                            <View style={styles.lockdownBanner}>
                                <MaterialCommunityIcons name="lock" size={24} color="#D32F2F" />
                                <Text style={styles.lockdownText}>
                                    LOCKDOWN ACTIVE - All OTPs blocked
                                </Text>
                            </View>
                        </>
                    )}

                    {theftStatus?.last_known_location && (
                        <>
                            <Divider style={{ marginVertical: 16 }} />
                            <View style={styles.locationRow}>
                                <MaterialCommunityIcons name="map-marker" size={20} color="#666" />
                                <Text style={styles.locationText}>
                                    Last seen: {theftStatus.last_known_location.lat.toFixed(4)}, {theftStatus.last_known_location.lng.toFixed(4)}
                                </Text>
                            </View>
                        </>
                    )}
                </Card.Content>
            </Card>

            {/* Actions */}
            <Text style={styles.sectionTitle}>Actions</Text>

            {/* Track My Box */}
            {theftStatus?.is_stolen && (
                <Surface style={styles.actionCard} elevation={2}>
                    <View style={styles.actionHeader}>
                        <View style={[styles.actionIcon, { backgroundColor: '#2196F320' }]}>
                            <MaterialCommunityIcons name="map-search" size={28} color="#2196F3" />
                        </View>
                        <View style={styles.actionInfo}>
                            <Text style={styles.actionTitle}>Track My Box</Text>
                            <Text style={styles.actionDescription}>
                                View live location on map
                            </Text>
                        </View>
                    </View>
                    <Button
                        mode="contained"
                        onPress={handleTrackMyBox}
                        buttonColor="#2196F3"
                        style={styles.actionButton}
                    >
                        Open Map
                    </Button>
                </Surface>
            )}

            {/* Export Evidence */}
            {theftStatus?.is_stolen && (
                <Surface style={styles.actionCard} elevation={2}>
                    <View style={styles.actionHeader}>
                        <View style={[styles.actionIcon, { backgroundColor: '#9C27B020' }]}>
                            <MaterialCommunityIcons name="file-document" size={28} color="#9C27B0" />
                        </View>
                        <View style={styles.actionInfo}>
                            <Text style={styles.actionTitle}>Download Evidence</Text>
                            <Text style={styles.actionDescription}>
                                GPS trail + photos for insurance
                            </Text>
                        </View>
                    </View>
                    <Button
                        mode="contained"
                        onPress={handleExportEvidence}
                        buttonColor="#9C27B0"
                        style={styles.actionButton}
                        loading={exportingEvidence}
                        disabled={exportingEvidence}
                    >
                        {exportingEvidence ? 'Exporting...' : 'Export'}
                    </Button>
                </Surface>
            )}

            {/* Report Theft (only if not already reported) */}
            {!theftStatus?.is_stolen && (
                <Surface style={styles.reportCard} elevation={3}>
                    <View style={styles.reportHeader}>
                        <MaterialCommunityIcons name="alert-octagon" size={32} color="#D32F2F" />
                        <Text style={styles.reportTitle}>Report Theft</Text>
                    </View>
                    <Text style={styles.reportDescription}>
                        If your box has been stolen or you suspect unauthorized access,
                        report it immediately. This will alert the admin team and enable tracking.
                    </Text>

                    {showNotesInput ? (
                        <>
                            <TextInput
                                mode="outlined"
                                label="Additional notes (optional)"
                                value={notes}
                                onChangeText={setNotes}
                                multiline
                                numberOfLines={3}
                                style={styles.notesInput}
                            />
                            <View style={styles.reportButtons}>
                                <Button
                                    mode="outlined"
                                    onPress={() => setShowNotesInput(false)}
                                    style={{ flex: 1, marginRight: 8 }}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    mode="contained"
                                    onPress={handleReportTheft}
                                    buttonColor="#D32F2F"
                                    style={{ flex: 1 }}
                                    loading={reporting}
                                    disabled={reporting}
                                >
                                    Report Stolen
                                </Button>
                            </View>
                        </>
                    ) : (
                        <Button
                            mode="contained"
                            onPress={() => setShowNotesInput(true)}
                            buttonColor="#D32F2F"
                            style={styles.reportButton}
                            icon="alert"
                        >
                            Report My Box Stolen
                        </Button>
                    )}
                </Surface>
            )}

            {/* Contact Support */}
            <Surface style={styles.supportCard} elevation={1}>
                <MaterialCommunityIcons name="headphones" size={24} color="#666" />
                <View style={styles.supportInfo}>
                    <Text style={styles.supportTitle}>Need Help?</Text>
                    <Text style={styles.supportText}>Contact our 24/7 support team</Text>
                </View>
                <Button
                    mode="outlined"
                    onPress={() => Linking.openURL('tel:+639123456789')}
                    compact
                >
                    Call
                </Button>
            </Surface>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 32,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F7F9FC',
    },
    headerBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
        borderRadius: 16,
        marginBottom: 24,
    },
    headerText: {
        marginLeft: 16,
        flex: 1,
    },
    headerTitle: {
        color: 'white',
        fontSize: 20,
        fontWeight: 'bold',
    },
    headerSubtitle: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 14,
        marginTop: 4,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 12,
        marginTop: 8,
    },
    card: {
        marginBottom: 16,
        borderRadius: 12,
        backgroundColor: 'white',
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusIcon: {
        width: 60,
        height: 60,
        borderRadius: 30,
        justifyContent: 'center',
        alignItems: 'center',
    },
    statusInfo: {
        flex: 1,
        marginLeft: 16,
    },
    statusLabel: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    statusTime: {
        fontSize: 12,
        color: '#666',
        marginTop: 4,
    },
    lockdownBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFEBEE',
        padding: 12,
        borderRadius: 8,
    },
    lockdownText: {
        marginLeft: 12,
        color: '#D32F2F',
        fontWeight: 'bold',
    },
    locationRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    locationText: {
        marginLeft: 8,
        color: '#666',
        fontSize: 13,
    },
    actionCard: {
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
    },
    actionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    actionIcon: {
        width: 50,
        height: 50,
        borderRadius: 25,
        justifyContent: 'center',
        alignItems: 'center',
    },
    actionInfo: {
        flex: 1,
        marginLeft: 12,
    },
    actionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#333',
    },
    actionDescription: {
        fontSize: 13,
        color: '#666',
        marginTop: 2,
    },
    actionButton: {
        borderRadius: 8,
    },
    reportCard: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#FFCDD2',
    },
    reportHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    reportTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#D32F2F',
        marginLeft: 12,
    },
    reportDescription: {
        color: '#666',
        lineHeight: 20,
        marginBottom: 16,
    },
    notesInput: {
        marginBottom: 16,
        backgroundColor: 'white',
    },
    reportButtons: {
        flexDirection: 'row',
    },
    reportButton: {
        borderRadius: 8,
    },
    supportCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 16,
        marginTop: 8,
    },
    supportInfo: {
        flex: 1,
        marginLeft: 12,
    },
    supportTitle: {
        fontWeight: 'bold',
        color: '#333',
    },
    supportText: {
        fontSize: 12,
        color: '#666',
    },
});
