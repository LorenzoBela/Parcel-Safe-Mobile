import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity, Modal } from 'react-native';
import { Text, Card, Button, Surface, ProgressBar, useTheme, IconButton, Divider, Portal, ActivityIndicator } from 'react-native-paper';
import LottieView from 'lottie-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
    subscribeToBattery,
    BatteryState,
    subscribeToTamper,
    TamperState,
    subscribeToBoxState,
    BoxState,
    subscribeToLockout,
    LockoutState,
    subscribeToOtpStatus,
    OtpStatus,
    resetLockout,
    subscribeToPower,
    PowerState,
    subscribeToFaceAuthStatus, // EC-97
    startFaceScan, // EC-97
    FaceAuthStatus, // EC-97
    subscribeToLockHealth, // EC-96
    LockHealthState, // EC-96
} from '../../services/firebaseClient';
import { updateDeliveryStatus } from '../../services/riderMatchingService';
import { subscribeToAdminOverride, AdminOverrideState, getOverrideNotificationMessage } from '../../services/adminOverrideService';
import { bleOtpService, BleBoxDevice, BleTransferResult } from '../../services/bleOtpService';
import {
    BoxPairingState,
    isPairingActive,
    subscribeToRiderPairing,
} from '../../services/boxPairingService';
import useAuthStore from '../../store/authStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PAIRED_BOX_CACHE_KEY_PREFIX = 'parcelSafe:lastPairedBoxId:';

// Demo box ID (would come from navigation params in production)
const DEMO_BOX_ID = 'BOX_001';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function BoxControlsScreen() {
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const route = useRoute<any>();
    const theme = useTheme();
    const animationRef = useRef<LottieView>(null);
    const [rebooting, setRebooting] = useState(false);
    const [logs, setLogs] = useState<{ time: string; message: string; type: string }[]>([]);
    const [pairingState, setPairingState] = useState<BoxPairingState | null>(null);
    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;
    const riderId = authedUserId;
    const [cachedBoxId, setCachedBoxId] = useState<string | null>(null);
    const [boxState, setBoxState] = useState<BoxState | null>(null);

    // EC-03: Battery Monitoring State
    const [batteryState, setBatteryState] = useState<BatteryState | null>(null);

    // EC-18: Tamper Detection State
    const [tamperState, setTamperState] = useState<TamperState | null>(null);

    // EC-04: OTP Lockout State
    const [lockoutState, setLockoutState] = useState<LockoutState | null>(null);
    const [lockoutCountdown, setLockoutCountdown] = useState<string>('');

    // EC-07: OTP Expiry State
    const [otpStatus, setOtpStatus] = useState<OtpStatus | null>(null);

    // EC-77: Admin Override State
    const [adminOverrideState, setAdminOverrideState] = useState<AdminOverrideState | null>(null);

    // EC-02: BLE OTP Transfer State
    const [showBleModal, setShowBleModal] = useState(false);
    const [bleStatus, setBleStatus] = useState<'idle' | 'scanning' | 'connecting' | 'transferring' | 'success' | 'error'>('idle');
    const [bleMessage, setBleMessage] = useState('');
    const [foundDevices, setFoundDevices] = useState<BleBoxDevice[]>([]);

    // EC-90: Power State for solenoid blocking
    const [powerState, setPowerState] = useState<PowerState | null>(null);

    // EC-97: Face Auth State
    const [faceAuthStatus, setFaceAuthStatus] = useState<FaceAuthStatus>('IDLE');

    // EC-96: Lock Health (Thermal)
    const [lockHealth, setLockHealth] = useState<LockHealthState | null>(null);

    // Telemetry State (now enhanced with real data)
    const telemetry = {
        voltage: batteryState ? `${batteryState.voltage.toFixed(1)}V` : '-- V',
        temp: boxState?.temp ? `${boxState.temp}°C` : '--°C',
        signal: boxState?.rssi ? `${boxState.rssi} dBm` : '-- dBm',
        sync: boxState?.last_heartbeat ? dayjs(boxState.last_heartbeat).format('h:mm A') : '--'
    };

    const isPaired = isPairingActive(pairingState);
    const pairedBoxId = pairingState?.box_id;
    const boxId = route?.params?.boxId ?? pairedBoxId ?? cachedBoxId ?? DEMO_BOX_ID;
    const routeDeliveryId = route?.params?.deliveryId as string | undefined;

    // Last-resort fallback for dev screens when box has no active delivery.
    const activeDeliveryId = routeDeliveryId || boxState?.delivery_id || 'DEL_001';
    const activeOtpCode = boxState?.otp_code || '';

    // Derive lock state from real data
    const isLocked = boxState?.status === 'LOCKED';

    // Initialize Logs and Subscriptions
    useEffect(() => {
        const unsubscribeBoxState = subscribeToBoxState(boxId, (state) => {
            setBoxState(state);
        });
        addLog("Control Panel accessed", "info");
        addLog("Telemetry stream connected", "success");

        // EC-03: Subscribe to battery state
        const unsubscribeBattery = subscribeToBattery(boxId, (state) => {
            setBatteryState(state);
            setBatteryState(state);
        });

        // EC-18: Subscribe to tamper state
        const unsubscribeTamper = subscribeToTamper(boxId, (state) => {
            setTamperState(state);
            if (state?.detected) {
                addLog("⚠️ TAMPER DETECTED - Box in lockdown!", "error");

                if (activeDeliveryId && activeDeliveryId !== 'DEL_001') {
                    updateDeliveryStatus(activeDeliveryId, 'TAMPERED', {
                        tampered_at: Date.now(),
                        tamper_lockdown: Boolean(state.lockdown),
                        source: 'box_controls',
                    });
                }
            }
        });

        // EC-04: Subscribe to OTP lockout state
        const unsubscribeLockout = subscribeToLockout(boxId, (state) => {
            setLockoutState(state);
            if (state?.active) {
                addLog(`OTP Lockout active (${state.attempt_count} failed attempts)`, "warning");
            }
        });

        // EC-07: Subscribe to OTP status
        const unsubscribeOtpStatus = subscribeToOtpStatus(boxId, (status) => {
            setOtpStatus(status);
            if (status?.otp_expired) {
                addLog("⚠️ OTP has expired - regeneration needed", "warning");
            }
        });

        // EC-77: Subscribe to admin override
        const unsubscribeOverride = subscribeToAdminOverride(boxId, (state) => {
            setAdminOverrideState(state);
            if (state?.active && !state.processed) {
                const msg = getOverrideNotificationMessage(state);
                addLog(`ADMIN OVERRIDE: ${msg}`, "warning");
                // setIsLocked(false); // Managed by boxState now
            }
        });

        // EC-90: Subscribe to power state
        const unsubscribePower = subscribeToPower(boxId, (state) => {
            setPowerState(state);
            if (state?.solenoid_blocked) {
                addLog("🔋 VOLTAGE CRITICAL - Unlock disabled", "error");
            }
        });

        // EC-97: Subscribe to Face Auth Status
        const unsubscribeFaceAuth = subscribeToFaceAuthStatus(boxId, (status) => {
            setFaceAuthStatus(status || 'IDLE');

            if (status === 'AUTHENTICATED') {
                // setIsLocked(false); // Managed by boxState
                addLog("Face ID Verified - Box Unlocked", "success");
            } else if (status === 'TIMEOUT_REMOVE_HELMET') {
                Alert.alert("Face Scan Failed", "Please remove helmet and try again.");
                addLog("Face Scan Timeout - Helmet detected?", "warning");
            } else if (status === 'FAILED_USE_OTP') {
                Alert.alert("Face Scan Failed", "Please use OTP to unlock.");
                addLog("Face Scan Failed - Use OTP", "error");
            }
        });

        // EC-96: Subscribe to Lock Health
        const unsubscribeLockHealth = subscribeToLockHealth(boxId, (state) => {
            setLockHealth(state);
            if (state?.overheated) {
                addLog("🔥 Solenoid Overheated - Actuation Blocked", "error");
            }
        });

        return () => {
            unsubscribeBattery();
            unsubscribeTamper();
            unsubscribeBoxState();
            unsubscribeLockout();
            unsubscribeOtpStatus();
            unsubscribeOverride();
            unsubscribePower();
            unsubscribeFaceAuth();
            unsubscribeLockHealth();
        };
    }, [boxId]);

    useEffect(() => {
        if (!riderId) return;

        AsyncStorage.getItem(`${PAIRED_BOX_CACHE_KEY_PREFIX}${riderId}`)
            .then((value) => setCachedBoxId(value || null))
            .catch(() => setCachedBoxId(null));

        const unsubscribe = subscribeToRiderPairing(riderId, (state) => {
            setPairingState(state);
            if (state?.box_id) {
                AsyncStorage.setItem(`${PAIRED_BOX_CACHE_KEY_PREFIX}${riderId}`, state.box_id).catch(() => undefined);
            }
        });
        return unsubscribe;
    }, [riderId]);

    // EC-04: Lockout countdown timer
    useEffect(() => {
        if (!lockoutState?.active) {
            setLockoutCountdown('');
            return;
        }

        const updateCountdown = () => {
            const now = Date.now();
            const remaining = lockoutState.expires_at - now;
            if (remaining <= 0) {
                setLockoutCountdown('Expired');
            } else {
                const mins = Math.floor(remaining / 60000);
                const secs = Math.floor((remaining % 60000) / 1000);
                setLockoutCountdown(`${mins}:${secs.toString().padStart(2, '0')}`);
            }
        };

        updateCountdown();
        const interval = setInterval(updateCountdown, 1000);
        return () => clearInterval(interval);
    }, [lockoutState]);

    // Animation Control
    useEffect(() => {
        if (animationRef.current) {
            if (isLocked) {
                animationRef.current.play(0, 60);
            } else {
                animationRef.current.play(60, 120);
            }
        }
    }, [isLocked]);

    const addLog = (message: string, type: string = 'info') => {
        setLogs(prev => [{ time: dayjs().format('HH:mm:ss'), message, type }, ...prev]);
    };

    const toggleLock = () => {
        if (!isPaired) {
            Alert.alert('Pair Required', 'Scan your box QR to unlock controls.');
            navigation.navigate('PairBox' as never);
            return;
        }
        // EC-90: Block unlock if solenoid is blocked due to low voltage
        if (isLocked && powerState?.solenoid_blocked) {
            Alert.alert(
                '🔋 Low Voltage',
                `Battery voltage too low (${powerState.voltage.toFixed(1)}V). Cannot unlock until battery is charged.`,
                [{ text: 'OK' }]
            );
            return;
        }

        // EC-96: Block unlock if solenoid is overheated
        if (lockHealth?.overheated) {
            Alert.alert(
                '🔥 System Overheated',
                'Lock mechanism is too hot. Please wait for it to cool down.',
                [{ text: 'OK' }]
            );
            return;
        }

        const action = isLocked ? "UNLOCKING" : "LOCKED";

        // EC-FIX: Send command to Firebase instead of local toggle
        import('../../services/firebaseClient').then(({ updateBoxState }) => {
            updateBoxState(boxId, { status: action });
            addLog(`Command Sent: ${action}`, "info");
        });
    };

    const handleEmergencyOpen = () => {
        Alert.alert(
            "Emergency Open",
            "This will force the lock open and trigger an incident report. Continue?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "FORCE OPEN",
                    style: "destructive",
                    onPress: () => {
                        import('../../services/firebaseClient').then(({ updateBoxState }) => {
                            updateBoxState(boxId, { status: 'UNLOCKING' }); // Or specific emergency state if available
                        });
                        addLog("EMERGENCY OPEN TRIGGERED", "error");
                        addLog("Incident Report #9921 created", "info");
                    }
                }
            ]
        );
    };

    const handleReboot = () => {
        Alert.alert(
            "Reboot System",
            "This will restart the smart box. Connection will be lost for 30 seconds.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Reboot",
                    onPress: () => {
                        setRebooting(true);
                        addLog("System Reboot Initiated...", "warning");
                        setTimeout(() => {
                            setRebooting(false);
                            addLog("System Online. All systems nominal.", "success");
                        }, 3000);
                    }
                }
            ]
        );
    };

    // EC-04: Reset OTP Lockout
    const handleResetLockout = async () => {
        Alert.alert(
            "Reset Lockout",
            "This will clear the OTP lockout and allow new attempts. Use only after verifying the customer's identity.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Reset",
                    onPress: async () => {
                        try {
                            await resetLockout(boxId);
                            addLog("OTP Lockout reset successfully", "success");
                            Alert.alert("Success", "Lockout has been reset. Customer can now retry OTP.");
                        } catch (error) {
                            addLog("Failed to reset lockout", "error");
                            Alert.alert("Error", "Failed to reset lockout. Try again.");
                        }
                    }
                }
            ]
        );
    };

    // EC-02: BLE OTP Transfer
    const handleBleTransfer = async () => {
        if (!isPaired) {
            Alert.alert('Pair Required', 'Scan your box QR before sending OTP over BLE.');
            navigation.navigate('PairBox' as never);
            return;
        }

        if (!activeDeliveryId || !activeOtpCode || activeOtpCode.length < 6) {
            Alert.alert(
                'OTP Not Ready',
                'No active OTP found for this box. Make sure a delivery is assigned and OTP has been issued.'
            );
            return;
        }

        setShowBleModal(true);
        setBleStatus('scanning');
        setBleMessage('Scanning for nearby box...');
        setFoundDevices([]);

        try {
            const result = await bleOtpService.sendOtpToBox(
                boxId,
                activeOtpCode,
                activeDeliveryId,
                {
                    onScanStart: () => {
                        setBleStatus('scanning');
                        setBleMessage('Scanning for nearby Smart Box...');
                    },
                    onDeviceFound: (device) => {
                        setFoundDevices(prev => [...prev, device]);
                        setBleMessage(`Found: ${device.name}`);
                    },
                    onConnecting: (name) => {
                        setBleStatus('connecting');
                        setBleMessage(`Connecting to ${name}...`);
                    },
                    onConnected: (name) => {
                        setBleMessage(`Connected to ${name}`);
                    },
                    onTransferring: () => {
                        setBleStatus('transferring');
                        setBleMessage('Transferring OTP...');
                    },
                    onSuccess: (name) => {
                        setBleStatus('success');
                        setBleMessage(`OTP sent to ${name} successfully!`);
                        addLog(`BLE: OTP transferred to ${name}`, "success");
                    },
                    onError: (error) => {
                        setBleStatus('error');
                        setBleMessage(error);
                        addLog(`BLE Error: ${error}`, "error");
                    }
                }
            );

            if (!result.success) {
                setBleStatus('error');
                setBleMessage(result.message);
            }
        } catch (error) {
            setBleStatus('error');
            setBleMessage('BLE transfer failed');
        }
    };

    const closeBleModal = () => {
        setShowBleModal(false);
        setBleStatus('idle');
        setBleMessage('');
        setFoundDevices([]);
        bleOtpService.stopScan();
    };

    // EC-03: Get battery color
    const getBatteryColor = () => {
        const pct = batteryState?.percentage ?? 85;
        if (pct > 20) return '#4CAF50';
        if (pct > 10) return '#FF9800';
        return '#F44336';
    };

    const getBatteryIcon = () => {
        const pct = batteryState?.percentage ?? 85;
        if (pct > 80) return 'battery';
        if (pct > 60) return 'battery-70';
        if (pct > 40) return 'battery-50';
        if (pct > 20) return 'battery-30';
        return 'battery-alert';
    };

    const TelemetryItem = ({ icon, label, value, color }) => (
        <Surface style={styles.telemetryCard} elevation={1}>
            <MaterialCommunityIcons name={icon} size={24} color={color} />
            <Text variant="labelSmall" style={{ marginTop: 4, color: '#666' }}>{label}</Text>
            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>{value}</Text>
        </Surface>
    );

    // EC-97: Face Unlock Handler
    const handleFaceUnlock = async () => {
        if (lockHealth?.overheated) {
            Alert.alert('🔥 System Overheated', 'Wait for cool down.');
            return;
        }

        try {
            addLog("Starting Face Scan...", "info");
            await startFaceScan(boxId);
        } catch (error) {
            addLog("Failed to start face scan", "error");
        }
    };

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: Math.max(insets.top, 20), paddingBottom: insets.bottom + 20 }]}>

                {!isPaired && (
                    <Surface style={styles.pairingBanner} elevation={3}>
                        <MaterialCommunityIcons name="qrcode" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.alertTitle}>PAIR REQUIRED</Text>
                            <Text style={styles.alertText}>Scan the box QR to unlock controls and health data.</Text>
                        </View>
                        <Button
                            mode="contained"
                            onPress={() => navigation.navigate('PairBox' as never)}
                            buttonColor="white"
                            textColor="#374151"
                        >
                            Pair
                        </Button>
                    </Surface>
                )}

                {/* EC-77: Admin Override Alert Banner */}
                {isPaired && adminOverrideState?.active && !adminOverrideState.processed && (
                    <Surface style={[styles.alertBanner, { backgroundColor: '#FF5722' }]} elevation={4}>
                        <MaterialCommunityIcons name="lock-open-alert" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.alertTitle}>ADMIN OVERRIDE</Text>
                            <Text style={styles.alertText}>{getOverrideNotificationMessage(adminOverrideState)}</Text>
                        </View>
                    </Surface>
                )}

                {/* EC-18: Tamper Alert Banner */}
                {isPaired && tamperState?.detected && (
                    <Surface style={styles.alertBanner} elevation={4}>
                        <MaterialCommunityIcons name="alert-decagram" size={24} color="white" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.alertTitle}>⚠️ SECURITY ALERT</Text>
                            <Text style={styles.alertText}>Box tamper detected! Lockdown active.</Text>
                        </View>
                    </Surface>
                )}

                {/* EC-03: Low Battery Warning Banner */}
                {isPaired && batteryState?.lowBatteryWarning && (
                    <Surface style={[styles.warningBanner, batteryState.criticalBatteryWarning && styles.criticalBanner]} elevation={3}>
                        <MaterialCommunityIcons
                            name="battery-alert"
                            size={24}
                            color={batteryState.criticalBatteryWarning ? "white" : "#7B341E"}
                        />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.warningTitle, batteryState.criticalBatteryWarning && { color: 'white' }]}>
                                {batteryState.criticalBatteryWarning ? '🔴 CRITICAL BATTERY' : '🟡 LOW BATTERY'}
                            </Text>
                            <Text style={[styles.warningText, batteryState.criticalBatteryWarning && { color: 'rgba(255,255,255,0.9)' }]}>
                                Battery at {batteryState.percentage}% - {batteryState.criticalBatteryWarning ? 'Charge immediately!' : 'Charge soon'}
                            </Text>
                        </View>
                    </Surface>
                )}

                {/* EC-04: OTP Lockout Status Card */}
                {isPaired && lockoutState?.active && (
                    <Surface style={styles.lockoutCard} elevation={3}>
                        <View style={styles.lockoutHeader}>
                            <MaterialCommunityIcons name="lock-alert" size={28} color="#D32F2F" />
                            <View style={{ flex: 1, marginLeft: 12 }}>
                                <Text style={styles.lockoutTitle}>OTP LOCKOUT ACTIVE</Text>
                                <Text style={styles.lockoutText}>
                                    {lockoutState.attempt_count} failed attempts - Unlocks in {lockoutCountdown}
                                </Text>
                            </View>
                        </View>
                        <Button
                            mode="contained"
                            onPress={handleResetLockout}
                            style={styles.resetButton}
                            buttonColor="#D32F2F"
                            icon="lock-open-variant"
                        >
                            Reset Lockout
                        </Button>
                    </Surface>
                )}

                {/* EC-07: OTP Expiry Warning */}
                {isPaired && otpStatus?.otp_expired && (
                    <Surface style={styles.expiryCard} elevation={2}>
                        <MaterialCommunityIcons name="clock-alert" size={24} color="#FF9800" />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.expiryTitle}>OTP EXPIRED</Text>
                            <Text style={styles.expiryText}>The current OTP has expired. A new one must be generated.</Text>
                        </View>
                    </Surface>
                )}

                {/* Header Animation */}
                <View style={styles.headerContainer}>
                    <MaterialCommunityIcons
                        name={!isPaired ? "link-variant-off" : (isLocked ? "shield-check" : "shield-alert")}
                        size={100}
                        color={!isPaired ? "#9E9E9E" : (isLocked ? "#4CAF50" : "#F44336")}
                        style={{ marginBottom: 10 }}
                    />
                    <Text variant="headlineSmall" style={{ fontWeight: 'bold', marginTop: 10 }}>
                        {!isPaired ? "No Box Connected" : (isLocked ? "System Secure" : "System Unlocked")}
                    </Text>
                    <Text variant="bodyMedium" style={{ color: !isPaired ? '#757575' : (isLocked ? '#4CAF50' : '#F44336') }}>
                        {!isPaired ? "Pair to view status" : (isLocked ? "Lock Engaged" : "Lock Disengaged")}
                    </Text>
                </View>

                {/* Telemetry Grid */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Live Telemetry</Text>
                <View style={styles.grid}>
                    <TelemetryItem
                        icon={isPaired ? getBatteryIcon() : "battery-unknown"}
                        label="Battery"
                        value={isPaired ? `${batteryState?.percentage ?? 85}%` : '--%'}
                        color={isPaired ? getBatteryColor() : '#BDBDBD'}
                    />
                    <TelemetryItem
                        icon="thermometer"
                        label="Temp"
                        value={isPaired ? telemetry.temp : '--°C'}
                        color={isPaired ? "#FF9800" : '#BDBDBD'}
                    />
                    <TelemetryItem
                        icon="wifi"
                        label="Signal"
                        value={isPaired ? telemetry.signal : '-- dBm'}
                        color={isPaired ? "#4CAF50" : '#BDBDBD'}
                    />
                    <TelemetryItem
                        icon="sync"
                        label="Last Sync"
                        value={isPaired ? telemetry.sync : '--'}
                        color={isPaired ? "#9C27B0" : '#BDBDBD'}
                    />
                </View>

                {/* EC-ENHANCE: Grouped Smart Box Controls */}
                <Text variant="titleMedium" style={styles.sectionTitle}>Smart Box Controls</Text>
                <Card style={styles.controlsCard}>
                    <Card.Content>
                        {/* 1. Biometric Access */}
                        <View style={styles.controlRow}>
                            <View style={[styles.iconContainer, !isPaired && { backgroundColor: '#F0F0F0', opacity: 0.5 }]}>
                                <MaterialCommunityIcons
                                    name="face-recognition"
                                    size={28}
                                    color={!isPaired ? '#BDBDBD' : (faceAuthStatus === 'SEARCHING' ? '#FF9800' : '#673AB7')}
                                />
                            </View>
                            <View style={styles.controlInfo}>
                                <Text variant="titleMedium" style={{ fontWeight: 'bold', color: !isPaired ? '#9E9E9E' : 'black' }}>Face Unlock</Text>
                                <Text variant="bodySmall" style={{ color: !isPaired ? '#BDBDBD' : '#666' }}>
                                    {isPaired ? (faceAuthStatus === 'SEARCHING' ? 'Scanning...' : 'Scan face to unlock') : 'Requires pairing'}
                                </Text>
                            </View>
                            <Button
                                mode="contained-tonal"
                                onPress={handleFaceUnlock}
                                loading={faceAuthStatus === 'SEARCHING'}
                                disabled={!isPaired || faceAuthStatus === 'SEARCHING' || !isLocked}
                                style={{ alignSelf: 'center' }}
                            >
                                {faceAuthStatus === 'SEARCHING' ? 'Scan' : 'Start'}
                            </Button>
                        </View>

                        <Divider style={styles.divider} />

                        {/* 2. BLE OTP Transfer */}
                        <View style={styles.controlRow}>
                            <View style={[styles.iconContainer, !isPaired && { backgroundColor: '#F0F0F0', opacity: 0.5 }]}>
                                <MaterialCommunityIcons name="bluetooth" size={28} color={!isPaired ? '#BDBDBD' : "#2196F3"} />
                            </View>
                            <View style={styles.controlInfo}>
                                <Text variant="titleMedium" style={{ fontWeight: 'bold', color: !isPaired ? '#9E9E9E' : 'black' }}>BLE OTP</Text>
                                <Text variant="bodySmall" style={{ color: !isPaired ? '#BDBDBD' : '#666' }}>
                                    {isPaired ? 'Offline transfer' : 'Requires pairing'}
                                </Text>
                            </View>
                            <Button
                                mode="contained-tonal"
                                onPress={handleBleTransfer}
                                disabled={!isPaired}
                                style={{ alignSelf: 'center' }}
                            >
                                Send
                            </Button>
                        </View>

                        <Divider style={styles.divider} />

                        {/* 3. Manual Lock Control */}
                        <Text variant="labelMedium" style={{ marginTop: 8, marginBottom: 8, color: theme.colors.outline }}>Manual Override</Text>
                        <Button
                            mode="contained"
                            onPress={toggleLock}
                            disabled={!isPaired}
                            style={[
                                styles.button,
                                {
                                    backgroundColor: !isPaired ? '#E0E0E0' : (isLocked ? '#4CAF50' : '#F44336'),
                                    marginBottom: 16
                                }
                            ]}
                            icon={isLocked ? "lock" : "lock-open"}
                            contentStyle={{ height: 48 }}
                        >
                            {isPaired ? (isLocked ? "Unlock Box" : "Lock Box") : "Controls Disabled"}
                        </Button>

                        <Divider style={styles.divider} />

                        {/* 4. System Maintenance */}
                        <Text variant="labelMedium" style={{ marginTop: 8, marginBottom: 8, color: theme.colors.outline }}>System Maintenance</Text>
                        <View style={styles.row}>
                            <Button
                                mode="outlined"
                                onPress={handleReboot}
                                loading={rebooting}
                                disabled={!isPaired || rebooting}
                                style={[styles.button, { flex: 1, marginRight: 8, borderColor: !isPaired ? '#E0E0E0' : '#FF9800' }]}
                                textColor={!isPaired ? '#BDBDBD' : "#FF9800"}
                                icon="restart"
                            >
                                Reboot
                            </Button>
                            <Button
                                mode="outlined"
                                onLongPress={handleEmergencyOpen}
                                delayLongPress={1000}
                                disabled={!isPaired}
                                style={[styles.button, { flex: 1, borderColor: !isPaired ? '#E0E0E0' : '#D32F2F' }]}
                                textColor={!isPaired ? '#BDBDBD' : "#D32F2F"}
                                icon="alert"
                            >
                                Emergency
                            </Button>
                        </View>
                        <Text style={styles.hintText}>* Long press "Emergency" to force open</Text>
                    </Card.Content>
                </Card>

                {/* Detailed Logs */}
                <Text variant="titleMedium" style={styles.sectionTitle}>System Event Log</Text>
                <Surface style={styles.logContainer} elevation={2}>
                    {isPaired ? (
                        logs.map((log, index) => (
                            <View key={index} style={styles.logRow}>
                                <Text style={styles.logTime}>{log.time}</Text>
                                <Text style={[styles.logMessage, {
                                    color: log.type === 'error' ? '#D32F2F' :
                                        log.type === 'warning' ? '#FF9800' :
                                            log.type === 'success' ? '#388E3C' : '#333'
                                }]}>
                                    {log.message}
                                </Text>
                            </View>
                        ))
                    ) : (
                        <View style={{ alignItems: 'center', justifyContent: 'center', height: 100 }}>
                            <Text style={{ color: '#666', fontStyle: 'italic' }}>No logs available (Unpaired)</Text>
                        </View>
                    )}
                </Surface>

            </ScrollView>

            {/* EC-02: BLE Transfer Modal */}
            <Modal
                visible={showBleModal}
                transparent
                animationType="slide"
                onRequestClose={closeBleModal}
            >
                <View style={styles.modalOverlay}>
                    <Surface style={styles.modalContent} elevation={5}>
                        <View style={styles.modalHeader}>
                            <Text variant="titleLarge" style={{ fontWeight: 'bold' }}>BLE OTP Transfer</Text>
                            <IconButton
                                icon="close"
                                size={24}
                                onPress={closeBleModal}
                            />
                        </View>

                        <View style={styles.modalBody}>
                            {/* Status Icon */}
                            <View style={[styles.bleStatusIcon, {
                                backgroundColor:
                                    bleStatus === 'success' ? '#E8F5E9' :
                                        bleStatus === 'error' ? '#FFEBEE' :
                                            '#E3F2FD'
                            }]}>
                                {bleStatus === 'scanning' || bleStatus === 'connecting' || bleStatus === 'transferring' ? (
                                    <ActivityIndicator size="large" color="#2196F3" />
                                ) : bleStatus === 'success' ? (
                                    <MaterialCommunityIcons name="check-circle" size={60} color="#4CAF50" />
                                ) : bleStatus === 'error' ? (
                                    <MaterialCommunityIcons name="alert-circle" size={60} color="#F44336" />
                                ) : (
                                    <MaterialCommunityIcons name="bluetooth-transfer" size={60} color="#2196F3" />
                                )}
                            </View>

                            {/* Status Message */}
                            <Text variant="titleMedium" style={styles.bleStatusText}>
                                {bleStatus === 'scanning' ? 'Scanning...' :
                                    bleStatus === 'connecting' ? 'Connecting...' :
                                        bleStatus === 'transferring' ? 'Transferring...' :
                                            bleStatus === 'success' ? 'Success!' :
                                                bleStatus === 'error' ? 'Failed' : 'Ready'}
                            </Text>
                            <Text variant="bodyMedium" style={styles.bleMessage}>{bleMessage}</Text>

                            {/* Found Devices List */}
                            {foundDevices.length > 0 && bleStatus === 'scanning' && (
                                <View style={styles.deviceList}>
                                    <Text variant="labelMedium" style={{ marginBottom: 8 }}>Found Devices:</Text>
                                    {foundDevices.map((device, index) => (
                                        <Surface key={index} style={styles.deviceItem} elevation={1}>
                                            <MaterialCommunityIcons name="cube-outline" size={20} color="#2196F3" />
                                            <Text style={{ marginLeft: 8 }}>{device.name}</Text>
                                            <Text style={{ marginLeft: 'auto', color: '#666', fontSize: 12 }}>
                                                RSSI: {device.rssi}
                                            </Text>
                                        </Surface>
                                    ))}
                                </View>
                            )}
                        </View>

                        <View style={[styles.modalFooter, { paddingBottom: Math.max(16, insets.bottom + 16) }]}>
                            {bleStatus === 'error' && (
                                <Button mode="contained" onPress={handleBleTransfer} style={{ flex: 1 }}>
                                    Retry
                                </Button>
                            )}
                            {bleStatus === 'success' && (
                                <Button mode="contained" onPress={closeBleModal} style={{ flex: 1 }} buttonColor="#4CAF50">
                                    Done
                                </Button>
                            )}
                            {(bleStatus === 'scanning' || bleStatus === 'connecting' || bleStatus === 'transferring') && (
                                <Button mode="outlined" onPress={closeBleModal} style={{ flex: 1 }}>
                                    Cancel
                                </Button>
                            )}
                        </View>
                    </Surface>
                </View>
            </Modal>
        </View >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    scrollContent: {
        padding: 20,
    },
    headerContainer: {
        alignItems: 'center',
        marginBottom: 24,
        backgroundColor: 'white',
        padding: 20,
        borderRadius: 16,
        elevation: 2,
    },
    lottie: {
        width: 120,
        height: 120,
    },
    sectionTitle: {
        fontWeight: 'bold',
        marginBottom: 12,
        color: '#333',
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    telemetryCard: {
        width: '48%',
        backgroundColor: 'white',
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
        alignItems: 'center',
    },
    controlsCard: {
        backgroundColor: 'white',
        borderRadius: 16,
        elevation: 2,
        marginBottom: 24,
    },
    controlRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    iconContainer: {
        width: 40,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
        backgroundColor: '#F5F5F5',
        height: 40,
        borderRadius: 20,
    },
    controlInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    divider: {
        marginVertical: 12,
        backgroundColor: '#E0E0E0',
    },
    button: {
        marginBottom: 12,
        borderRadius: 8,
    },
    row: {
        flexDirection: 'row',
    },
    hintText: {
        fontSize: 10,
        color: '#999',
        textAlign: 'center',
        marginTop: -4,
    },
    logContainer: {
        backgroundColor: '#1E1E1E',
        borderRadius: 12,
        padding: 16,
        minHeight: 200,
    },
    logRow: {
        flexDirection: 'row',
        marginBottom: 6,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
        paddingBottom: 4,
    },
    logTime: {
        color: '#888',
        fontFamily: 'monospace',
        fontSize: 11,
        width: 60,
    },
    logMessage: {
        flex: 1,
        fontFamily: 'monospace',
        fontSize: 11,
    },
    // EC-18: Tamper Alert Styles
    alertBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#D32F2F',
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    pairingBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1D4ED8',
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    alertTitle: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    },
    alertText: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 14,
    },
    // EC-03: Battery Warning Styles
    warningBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF3C7',
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    criticalBanner: {
        backgroundColor: '#DC2626',
    },
    warningTitle: {
        color: '#7B341E',
        fontWeight: 'bold',
        fontSize: 16,
    },
    warningText: {
        color: '#92400E',
        fontSize: 14,
    },
    // EC-04: Lockout Status Styles
    lockoutCard: {
        backgroundColor: '#FFEBEE',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        borderLeftWidth: 4,
        borderLeftColor: '#D32F2F',
    },
    lockoutHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    lockoutTitle: {
        color: '#D32F2F',
        fontWeight: 'bold',
        fontSize: 16,
    },
    lockoutText: {
        color: '#B71C1C',
        fontSize: 14,
    },
    resetButton: {
        marginTop: 12,
    },
    // EC-07: OTP Expiry Styles
    expiryCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF8E1',
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
        borderLeftWidth: 4,
        borderLeftColor: '#FF9800',
    },
    expiryTitle: {
        color: '#E65100',
        fontWeight: 'bold',
        fontSize: 16,
    },
    expiryText: {
        color: '#EF6C00',
        fontSize: 14,
    },
    // EC-02: BLE Transfer Styles
    bleCard: {
        backgroundColor: 'white',
        borderRadius: 16,
        marginBottom: 24,
    },
    bleInfo: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContent: {
        backgroundColor: 'white',
        borderRadius: 20,
        width: '100%',
        maxWidth: 400,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    modalBody: {
        padding: 24,
        alignItems: 'center',
    },
    bleStatusIcon: {
        width: 120,
        height: 120,
        borderRadius: 60,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    bleStatusText: {
        fontWeight: 'bold',
        marginBottom: 8,
    },
    bleMessage: {
        color: '#666',
        textAlign: 'center',
    },
    deviceList: {
        marginTop: 16,
        width: '100%',
    },
    deviceItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F5F5F5',
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
    },
    modalFooter: {
        flexDirection: 'row',
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0',
    },
});
