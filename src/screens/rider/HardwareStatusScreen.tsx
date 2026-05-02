/**
 * Hardware Status Screen
 * 
 * Full-page view of box hardware health for riders.
 * Shows EC-21, EC-22, EC-23, EC-25, EC-90, EC-91 status and alerts.
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHardwareStatus } from '../../hooks/useHardwareStatus';
import { HardwareAlertList } from '../../components/HardwareAlertBanner';
import { HardwareStatusBadge, StatusDot } from '../../components/HardwareStatusBadge';
import { subscribeToPower, PowerState, subscribeToResourceConflict, ResourceConflictState, subscribeToBoxState, BoxState, subscribeToBattery, DualBatteryState } from '../../services/firebaseClient';
import {
    BoxPairingState,
    isPairingActive,
    subscribeToRiderPairing,
} from '../../services/boxPairingService';
import useAuthStore from '../../store/authStore';

interface HardwareStatusScreenProps {
    route?: {
        params?: {
            boxId?: string;
            deliveryId?: string;
        };
    };
    navigation: any;
}

export default function HardwareStatusScreen({ route, navigation }: HardwareStatusScreenProps) {
    const [pairingState, setPairingState] = useState<BoxPairingState | null>(null);
    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;
    const riderId = authedUserId;
    const isPaired = isPairingActive(pairingState);
    const boxId = isPaired ? (pairingState?.box_id ?? route?.params?.boxId ?? null) : null;
    const deliveryId = route?.params?.deliveryId;
    const [refreshing, setRefreshing] = useState(false);

    // EC-90: Power State
    const [powerState, setPowerState] = useState<PowerState | null>(null);
    const [batteryState, setBatteryState] = useState<DualBatteryState | null>(null);

    // Geofence / theft state from hardware telemetry
    const [boxState, setBoxState] = useState<BoxState | null>(null);

    // EC-91: Resource Conflict State
    const [resourceConflict, setResourceConflict] = useState<ResourceConflictState | null>(null);

    const {
        health,
        alerts,
        isLoading,
        error,
        overallStatus,
        statusText,
        statusColor,
        isSafe,
        safetyReason,
        canProceed,
        proceedWarnings,
        dismissAlert,
        acknowledgeReboot,
        refresh,
    } = useHardwareStatus(boxId, deliveryId);

    // EC-90: Subscribe to Power State
    useEffect(() => {
        if (!boxId) return;
        const unsubscribe = subscribeToPower(boxId, setPowerState);
        return () => unsubscribe();
    }, [boxId]);

    useEffect(() => {
        if (!boxId) return;
        const unsubscribe = subscribeToBattery(boxId, setBatteryState);
        return () => unsubscribe();
    }, [boxId]);

    // EC-91: Subscribe to Resource Conflict State
    useEffect(() => {
        if (!boxId) return;
        const unsubscribe = subscribeToResourceConflict(boxId, setResourceConflict);
        return () => unsubscribe();
    }, [boxId]);

    // Subscribe to box state for geofence / theft telemetry
    useEffect(() => {
        if (!boxId) return;
        const unsubscribe = subscribeToBoxState(boxId, setBoxState);
        return () => unsubscribe();
    }, [boxId]);

    useEffect(() => {
        if (!riderId) return;

        const unsubscribe = subscribeToRiderPairing(riderId, (state) => {
            setPairingState(isPairingActive(state) ? state : null);
        });
        return unsubscribe;
    }, [riderId]);

    const onRefresh = async () => {
        setRefreshing(true);
        refresh();
        setTimeout(() => setRefreshing(false), 1000);
    };

    const handleAcknowledgeReboot = async () => {
        await acknowledgeReboot();
        refresh();
    };

    const getBatteryValueColor = (percentage?: number) => {
        if (percentage == null) return undefined;
        if (percentage <= 10) return '#ef4444';
        if (percentage <= 20) return '#eab308';
        return undefined;
    };

    if (!isPaired || !boxId) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.errorContainer}>
                    <Text style={styles.errorIcon}>🔒</Text>
                    <Text style={styles.errorText}>Pair a box to view hardware health</Text>
                    <Text style={styles.errorSubtext}>Scan the QR on your box to continue.</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={() => navigation.navigate('PairBox')}>
                        <Text style={styles.retryText}>Pair Box</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    if (error) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.errorContainer}>
                    <Text style={styles.errorIcon}>⚠️</Text>
                    <Text style={styles.errorText}>Unable to load hardware status</Text>
                    <Text style={styles.errorSubtext}>{error}</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={refresh}>
                        <Text style={styles.retryText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView
                style={styles.scrollView}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >
                {/* Header Status Card */}
                <View style={[styles.statusCard, { borderColor: statusColor }]}>
                    <View style={styles.statusHeader}>
                        <HardwareStatusBadge
                            status={overallStatus}
                            size="large"
                            loading={isLoading}
                        />
                    </View>
                    <Text style={styles.boxId}>Box ID: {boxId}</Text>

                    {/* Safety Status */}
                    <View style={styles.safetyContainer}>
                        {isSafe ? (
                            <View style={styles.safetyBadge}>
                                <Text style={styles.safeIcon}>✅</Text>
                                <Text style={styles.safeText}>Safe for Delivery</Text>
                            </View>
                        ) : (
                            <View style={[styles.safetyBadge, styles.unsafeBadge]}>
                                <Text style={styles.safeIcon}>🚫</Text>
                                <Text style={styles.unsafeText}>{safetyReason}</Text>
                            </View>
                        )}
                    </View>
                </View>

                {/* Alerts Section */}
                {alerts.length > 0 && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Active Alerts</Text>
                        <HardwareAlertList alerts={alerts} onDismiss={dismissAlert} />
                    </View>
                )}

                {/* Proceed Warnings */}
                {proceedWarnings.length > 0 && canProceed && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Warnings</Text>
                        {proceedWarnings.map((warning, index) => (
                            <View key={index} style={styles.warningItem}>
                                <Text style={styles.warningIcon}>⚠️</Text>
                                <Text style={styles.warningText}>{warning}</Text>
                            </View>
                        ))}
                    </View>
                )}

                {/* Hardware Components Status */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Hardware Components</Text>

                    {/* Lock Mechanism */}
                    <View style={styles.componentCard}>
                        <View style={styles.componentHeader}>
                            <Text style={styles.componentIcon}>🔐</Text>
                            <Text style={styles.componentTitle}>Lock Mechanism</Text>
                            <StatusDot
                                status={
                                    health.solenoid?.status === 'OK' && !health.lockHealth?.overheated ? 'HEALTHY' :
                                        health.solenoid?.status === 'STUCK_OPEN' ? 'OUT_OF_SERVICE' :
                                            health.solenoid?.status === 'STUCK_CLOSED' || health.lockHealth?.overheated ? 'CRITICAL' :
                                                'HEALTHY'
                                }
                            />
                        </View>
                        <View style={styles.componentDetails}>
                            <DetailRow
                                label="Status"
                                value={health.solenoid?.status || 'OK'}
                            />
                            {health.solenoid?.retry_count && health.solenoid.retry_count > 0 && (
                                <DetailRow
                                    label="Retry Attempts"
                                    value={health.solenoid.retry_count.toString()}
                                />
                            )}
                            {health.solenoid?.out_of_service && (
                                <DetailRow
                                    label="Service Status"
                                    value="OUT OF SERVICE"
                                    valueColor="#ef4444"
                                />
                            )}
                            {health.lockHealth?.overheated && (
                                <DetailRow
                                    label="Temperature"
                                    value="OVERHEATED"
                                    valueColor="#ef4444"
                                />
                            )}
                        </View>
                    </View>

                    {/* Camera */}
                    <View style={styles.componentCard}>
                        <View style={styles.componentHeader}>
                            <Text style={styles.componentIcon}>📷</Text>
                            <Text style={styles.componentTitle}>Camera</Text>
                            <StatusDot
                                status={
                                    health.camera?.has_hardware_error ? 'CRITICAL' :
                                        health.camera?.status === 'FAILED' ? 'WARNING' :
                                            'HEALTHY'
                                }
                            />
                        </View>
                        <View style={styles.componentDetails}>
                            <DetailRow
                                label="Status"
                                value={health.camera?.status || 'OK'}
                            />
                            {health.camera?.last_capture_attempts && health.camera.last_capture_attempts > 1 && (
                                <DetailRow
                                    label="Last Capture Attempts"
                                    value={health.camera.last_capture_attempts.toString()}
                                />
                            )}
                            {health.camera?.has_hardware_error && (
                                <DetailRow
                                    label="Hardware Error"
                                    value="Requires Service"
                                    valueColor="#ef4444"
                                />
                            )}
                            {health.camera?.last_upload_object_path && (
                                <DetailRow
                                    label="Last Photo"
                                    value={health.camera.last_upload_object_path}
                                />
                            )}
                        </View>
                    </View>

                    {/* EC-82: Keypad */}
                    <View style={styles.componentCard}>
                        <View style={styles.componentHeader}>
                            <Text style={styles.componentIcon}>⌨️</Text>
                            <Text style={styles.componentTitle}>Keypad</Text>
                            <StatusDot
                                status={health.keypad?.is_stuck ? 'CRITICAL' : 'HEALTHY'}
                            />
                        </View>
                        <View style={styles.componentDetails}>
                            <DetailRow
                                label="Status"
                                value={health.keypad?.is_stuck ? 'MALFUNCTION' : 'OK'}
                                valueColor={health.keypad?.is_stuck ? '#ef4444' : undefined}
                            />
                            {health.keypad?.is_stuck && (
                                <DetailRow
                                    label="Stuck Key"
                                    value={`'${health.keypad.stuck_key}'`}
                                    valueColor="#ef4444"
                                />
                            )}
                        </View>
                    </View>

                    {/* EC-83: Hinge */}
                    <View style={styles.componentCard}>
                        <View style={styles.componentHeader}>
                            <Text style={styles.componentIcon}>🚪</Text>
                            <Text style={styles.componentTitle}>Hinge Sensor</Text>
                            <StatusDot
                                status={
                                    health.hinge?.status === 'DAMAGED' ? 'CRITICAL' :
                                        health.hinge?.status === 'FLAPPING' ? 'WARNING' :
                                            'HEALTHY'
                                }
                            />
                        </View>
                        <View style={styles.componentDetails}>
                            <DetailRow
                                label="Status"
                                value={health.hinge?.status || 'OK'}
                                valueColor={
                                    health.hinge?.status === 'DAMAGED' ? '#ef4444' :
                                        health.hinge?.status === 'FLAPPING' ? '#eab308' : undefined
                                }
                            />
                            {health.hinge?.event_count !== undefined && health.hinge.event_count > 0 && (
                                <DetailRow
                                    label="Events"
                                    value={health.hinge.event_count.toString()}
                                />
                            )}
                        </View>
                    </View>

                    {/* EC-86: Display */}
                    <View style={styles.componentCard}>
                        <View style={styles.componentHeader}>
                            <Text style={styles.componentIcon}>🖥️</Text>
                            <Text style={styles.componentTitle}>I2C Display</Text>
                            <StatusDot
                                status={
                                    health.display?.status === 'FAILED' ? 'CRITICAL' :
                                        health.display?.status === 'DEGRADED' ? 'WARNING' :
                                            'HEALTHY'
                                }
                            />
                        </View>
                        <View style={styles.componentDetails}>
                            <DetailRow
                                label="Status"
                                value={health.display?.status || 'OK'}
                                valueColor={
                                    health.display?.status === 'FAILED' ? '#ef4444' :
                                        health.display?.status === 'DEGRADED' ? '#eab308' : undefined
                                }
                            />
                            <DetailRow
                                label="Error Count"
                                value={String(health.display?.error_count || 0)}
                            />
                            {health.display?.needs_service && (
                                <Text style={styles.warningText}>⚠️ Requires Maintenance</Text>
                            )}
                        </View>
                    </View>

                    {/* System */}
                    <View style={styles.componentCard}>
                        <View style={styles.componentHeader}>
                            <Text style={styles.componentIcon}>🔄</Text>
                            <Text style={styles.componentTitle}>System</Text>
                            <StatusDot
                                status={health.reboot?.rebooted ? 'WARNING' : 'HEALTHY'}
                            />
                        </View>
                        <View style={styles.componentDetails}>
                            <DetailRow
                                label="Status"
                                value={health.reboot?.rebooted ? 'Recently Rebooted' : 'Stable'}
                            />
                            {health.reboot?.boot_count && (
                                <DetailRow
                                    label="Boot Count"
                                    value={health.reboot.boot_count.toString()}
                                />
                            )}
                            {health.reboot?.rebooted && health.reboot.had_active_delivery && (
                                <>
                                    <DetailRow
                                        label="Recovery"
                                        value="Delivery Auto-Resumed"
                                        valueColor="#22c55e"
                                    />
                                    <TouchableOpacity
                                        style={styles.acknowledgeButton}
                                        onPress={handleAcknowledgeReboot}
                                    >
                                        <Text style={styles.acknowledgeText}>Acknowledge</Text>
                                    </TouchableOpacity>
                                </>
                            )}
                        </View>
                    </View>

                    {/* EC-90: Power / Battery */}
                    <View style={styles.componentCard}>
                        <View style={styles.componentHeader}>
                            <Text style={styles.componentIcon}>🔋</Text>
                            <Text style={styles.componentTitle}>Battery / Power</Text>
                            <StatusDot
                                status={
                                    powerState?.solenoid_blocked ? 'CRITICAL' :
                                        powerState?.status === 'WARNING' ? 'WARNING' :
                                            'HEALTHY'
                                }
                            />
                        </View>
                        <View style={styles.componentDetails}>
                            <DetailRow
                                label="Voltage"
                                value={powerState ? `${powerState.voltage.toFixed(1)}V` : '-- V'}
                                valueColor={
                                    powerState?.status === 'CRITICAL' || powerState?.status === 'DEAD' ? '#ef4444' :
                                        powerState?.status === 'WARNING' ? '#eab308' : undefined
                                }
                            />
                            <DetailRow
                                label="MCU Battery"
                                value={batteryState?.main?.percentage != null ? `${Math.round(batteryState.main.percentage)}%` : '--'}
                                valueColor={getBatteryValueColor(batteryState?.main?.percentage)}
                            />
                            <DetailRow
                                label="Lock Battery"
                                value={batteryState?.secondary?.percentage != null ? `${Math.round(batteryState.secondary.percentage)}%` : '--'}
                                valueColor={getBatteryValueColor(batteryState?.secondary?.percentage)}
                            />
                            <DetailRow
                                label="Status"
                                value={powerState?.status || 'UNKNOWN'}
                            />
                            {powerState?.solenoid_blocked && (
                                <DetailRow
                                    label="Unlock"
                                    value="BLOCKED - Low Voltage"
                                    valueColor="#ef4444"
                                />
                            )}
                        </View>
                    </View>

                    {/* EC-91: Resource Conflict */}
                    <View style={styles.componentCard}>
                        <View style={styles.componentHeader}>
                            <Text style={styles.componentIcon}>⚙️</Text>
                            <Text style={styles.componentTitle}>Resource Status</Text>
                            <StatusDot
                                status={
                                    resourceConflict?.in_critical_section ? 'WARNING' :
                                        (resourceConflict?.wdt_resets || 0) > 0 ? 'WARNING' :
                                            'HEALTHY'
                                }
                            />
                        </View>
                        <View style={styles.componentDetails}>
                            <DetailRow
                                label="Status"
                                value={resourceConflict?.in_critical_section ? 'Box Busy' : 'Ready'}
                            />
                            {resourceConflict?.queued_events !== undefined && resourceConflict.queued_events > 0 && (
                                <DetailRow
                                    label="Queued Events"
                                    value={resourceConflict.queued_events.toString()}
                                />
                            )}
                            {resourceConflict?.wdt_resets !== undefined && resourceConflict.wdt_resets > 0 && (
                                <DetailRow
                                    label="WDT Resets"
                                    value={resourceConflict.wdt_resets.toString()}
                                    valueColor="#eab308"
                                />
                            )}
                        </View>
                    </View>

                    {/* EC-92/94: Geofence & EC-81: Theft Guard */}
                    <View style={styles.componentCard}>
                        <View style={styles.componentHeader}>
                            <Text style={styles.componentIcon}>📍</Text>
                            <Text style={styles.componentTitle}>Geofence / Security</Text>
                            <StatusDot
                                status={
                                    boxState?.theft_state === 'STOLEN' || boxState?.theft_state === 'LOCKDOWN' ? 'CRITICAL' :
                                        boxState?.theft_state === 'SUSPICIOUS' ? 'WARNING' :
                                            boxState?.geo_state === 'INSIDE' ? 'HEALTHY' :
                                                'WARNING'
                                }
                            />
                        </View>
                        <View style={styles.componentDetails}>
                            <DetailRow
                                label="Geofence"
                                value={boxState?.geo_state || 'N/A'}
                                valueColor={boxState?.geo_state === 'INSIDE' ? '#22c55e' : undefined}
                            />
                            <DetailRow
                                label="Distance"
                                value={boxState?.geo_dist_m != null ? `${Math.round(boxState.geo_dist_m)}m` : '-- m'}
                            />
                            <DetailRow
                                label="Security"
                                value={boxState?.theft_state || 'NORMAL'}
                                valueColor={
                                    boxState?.theft_state === 'STOLEN' || boxState?.theft_state === 'LOCKDOWN' ? '#ef4444' :
                                        boxState?.theft_state === 'SUSPICIOUS' ? '#eab308' : undefined
                                }
                            />
                        </View>
                    </View>
                </View>

                {/* Action Buttons */}
                <View style={styles.actionsSection}>
                    {!canProceed && (
                        <TouchableOpacity
                            style={styles.supportButton}
                            onPress={() => {/* Open support */ }}
                        >
                            <Text style={styles.supportButtonText}>📞 Contact Support</Text>
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => navigation.goBack()}
                    >
                        <Text style={styles.backButtonText}>← Back to Delivery</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

// Helper component for detail rows
function DetailRow({
    label,
    value,
    valueColor
}: {
    label: string;
    value: string;
    valueColor?: string;
}) {
    return (
        <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={[styles.detailValue, valueColor && { color: valueColor }]}>
                {value}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    scrollView: {
        flex: 1,
    },
    statusCard: {
        backgroundColor: '#fff',
        margin: 16,
        padding: 20,
        borderRadius: 16,
        borderWidth: 2,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    statusHeader: {
        marginBottom: 12,
    },
    boxId: {
        fontSize: 14,
        color: '#666',
        marginBottom: 16,
    },
    safetyContainer: {
        width: '100%',
    },
    safetyBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#dcfce7',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
    },
    unsafeBadge: {
        backgroundColor: '#fee2e2',
    },
    safeIcon: {
        fontSize: 18,
        marginRight: 8,
    },
    safeText: {
        color: '#166534',
        fontFamily: 'Inter_600SemiBold',
        fontSize: 14,
    },
    unsafeText: {
        color: '#991b1b',
        fontFamily: 'Inter_600SemiBold',
        fontSize: 14,
        textAlign: 'center',
    },
    section: {
        marginHorizontal: 16,
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
        color: '#333',
        marginBottom: 12,
    },
    warningItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fef3c7',
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
    },
    warningIcon: {
        fontSize: 16,
        marginRight: 8,
    },
    warningText: {
        flex: 1,
        color: '#92400e',
        fontSize: 13,
    },
    componentCard: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    componentHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    componentIcon: {
        fontSize: 20,
        marginRight: 10,
    },
    componentTitle: {
        flex: 1,
        fontSize: 15,
        fontFamily: 'Inter_600SemiBold',
        color: '#333',
    },
    componentDetails: {
        borderTopWidth: 1,
        borderTopColor: '#f0f0f0',
        paddingTop: 12,
    },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 6,
    },
    detailLabel: {
        fontSize: 13,
        color: '#666',
    },
    detailValue: {
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
        color: '#333',
    },
    acknowledgeButton: {
        backgroundColor: '#3b82f6',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 6,
        alignSelf: 'flex-start',
        marginTop: 8,
    },
    acknowledgeText: {
        color: '#fff',
        fontFamily: 'Inter_600SemiBold',
        fontSize: 13,
    },
    actionsSection: {
        padding: 16,
        gap: 12,
    },
    supportButton: {
        backgroundColor: '#ef4444',
        paddingVertical: 14,
        borderRadius: 10,
        alignItems: 'center',
    },
    supportButtonText: {
        color: '#fff',
        fontFamily: 'Inter_700Bold',
        fontSize: 15,
    },
    backButton: {
        backgroundColor: '#fff',
        paddingVertical: 14,
        borderRadius: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ddd',
    },
    backButtonText: {
        color: '#666',
        fontFamily: 'Inter_600SemiBold',
        fontSize: 15,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    errorIcon: {
        fontSize: 48,
        marginBottom: 16,
    },
    errorText: {
        fontSize: 18,
        fontFamily: 'Inter_600SemiBold',
        color: '#333',
        marginBottom: 8,
    },
    errorSubtext: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        marginBottom: 20,
    },
    retryButton: {
        backgroundColor: '#3b82f6',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
    },
    retryText: {
        color: '#fff',
        fontFamily: 'Inter_600SemiBold',
    },
});
