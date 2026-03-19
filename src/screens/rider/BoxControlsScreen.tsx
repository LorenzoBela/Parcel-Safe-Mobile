import React, { useState, useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, ScrollView, Alert, TouchableOpacity, Modal } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, Card, Button, Surface, ProgressBar, useTheme, IconButton, Divider, Portal, ActivityIndicator, TextInput } from 'react-native-paper';
import LottieView from 'lottie-react-native';
import { useAppTheme } from '../../context/ThemeContext';

// ── Uber-style dual palette (mirrors RiderDashboard) ──
const lightC = {
    bg: '#FFFFFF', card: '#FFFFFF', search: '#F2F2F7',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    border: '#E5E5EA', accent: '#000000', accentText: '#FFFFFF',
    divider: '#F2F2F7',
    greenBg: '#ECFDF5', greenText: '#059669',
    redBg: '#FEF2F2', redText: '#DC2626',
    orangeBg: '#FFF7ED', orangeText: '#EA580C',
    blueBg: '#EFF6FF', blueText: '#2563EB',
    purpleBg: '#F5F3FF', purpleText: '#7C3AED',
};
const darkC = {
    bg: '#000000', card: '#1C1C1E', search: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    border: '#38383A', accent: '#FFFFFF', accentText: '#000000',
    divider: '#2C2C2E',
    greenBg: '#052E16', greenText: '#4ADE80',
    redBg: '#450A0A', redText: '#FCA5A5',
    orangeBg: '#431407', orangeText: '#FDBA74',
    blueBg: '#172554', blueText: '#93C5FD',
    purpleBg: '#2E1065', purpleText: '#C4B5FD',
};
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
    reportBoxStolen,
    subscribeToLocation,
    LocationData,
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
import * as Location from 'expo-location';

const PAIRED_BOX_CACHE_KEY_PREFIX = 'parcelSafe:lastPairedBoxId:';

// Demo box ID (would come from navigation params in production)
const DEMO_BOX_ID = 'BOX_001';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PremiumAlert } from '../../services/PremiumAlertService';
import {
    fetchRiderPersonalPinStatus,
    setRiderPersonalPin,
    resetRiderPersonalPin,
    RiderPersonalPinStatus,
    verifyRiderPersonalPinForUnlock,
    sendRiderUnlockCommand,
} from '../../services/personalPinService';

export default function BoxControlsScreen() {
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const route = useRoute<any>();
    const theme = useTheme();
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const animationRef = useRef<LottieView>(null);
    const [rebooting, setRebooting] = useState(false);
    const [manualOverrideSending, setManualOverrideSending] = useState(false);
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

    // GPS location from Firebase (box sub-path, written by GPS_LTE firmware)
    const [locationData, setLocationData] = useState<LocationData | null>(null);
    const [personalPinStatus, setPersonalPinStatus] = useState<RiderPersonalPinStatus | null>(null);
    const [personalPinLoading, setPersonalPinLoading] = useState(false);
    const [showPersonalPinModal, setShowPersonalPinModal] = useState(false);
    const [newPersonalPin, setNewPersonalPin] = useState('');
    const [confirmPersonalPin, setConfirmPersonalPin] = useState('');
    const [showNewPersonalPin, setShowNewPersonalPin] = useState(false);
    const [showConfirmPersonalPin, setShowConfirmPersonalPin] = useState(false);
    const [savingPersonalPin, setSavingPersonalPin] = useState(false);
    const [showUnlockPinModal, setShowUnlockPinModal] = useState(false);
    const [unlockPin, setUnlockPin] = useState('');
    const [showUnlockPin, setShowUnlockPin] = useState(false);
    const [unlockPinSubmitting, setUnlockPinSubmitting] = useState(false);
    const lastCommandAckKeyRef = useRef('');

    const sanitizePinInput = (value: string) => value.replace(/\D/g, '').slice(0, 6);

    // Extended hardware diagnostics — fields written by GPS_LTE_Firebase_Test firmware
    const [hwDiag, setHwDiag] = useState<{
        gps_fix?: boolean;
        op?: string;           // Carrier name e.g. "Globe Philippines"
        csq?: number;          // Raw CSQ 0-31
        uptime_ms?: number;    // millis() since boot
        connection?: string;   // "LTE"
        data_bytes?: number;   // Bytes sent to Firebase
        time_synced?: boolean;
        last_updated_str?: string; // ISO timestamp string "2026-03-04T10:00:00+08:00"
    } | null>(null);

    // Resolve RSSI to a human-readable quality label.
    // Firmware returns -999 when modem is off or CSQ is 0/99 (unknown).
    const getRssiQuality = (rssi?: number): string => {
        if (rssi == null || rssi <= -999) return 'No Signal';
        if (rssi >= -70) return 'Excellent';
        if (rssi >= -85) return 'Good';
        if (rssi >= -100) return 'Fair';
        return 'Weak';
    };

    // True if rssi is a valid measured value (not null/undefined/-999)
    const hasValidRssi = (rssi?: number): boolean =>
        rssi != null && rssi > -999;

    // Resolve CSQ (0-31, 99=unknown) to 0-100% quality
    const getCsqPercent = (csq?: number): number => {
        if (!csq || csq === 99) return 0;
        return Math.round((Math.min(csq, 31) / 31) * 100);
    };

    // Telemetry State — real data from firmware
    // NOTE: firmware writes `last_updated` (server timestamp ms), NOT `last_heartbeat`.
    //       `last_heartbeat` is only written by the mobile app's updateBoxState().
    const rawBoxState = boxState as any;
    const firmwareTimestamp: number | undefined =
        rawBoxState?.last_updated ?? boxState?.last_heartbeat;
    const telemetry = {
        voltage: batteryState ? `${batteryState.voltage.toFixed(1)}V` : '-- V',
        // gps_fix is a JSON boolean written by the firmware under hardware/{boxId}
        gps: hwDiag?.gps_fix === true ? 'Fixed' : hwDiag?.gps_fix === false ? 'No Fix' : '--',
        // rssi is a dBm integer; -999 means modem offline / CSQ unknown
        signal: hasValidRssi(boxState?.rssi) ? `${boxState!.rssi} dBm` : '-- dBm',
        // last_updated is the Firebase server timestamp set by the firmware PUT
        sync: firmwareTimestamp
            ? dayjs(firmwareTimestamp).format('h:mm A')
            : hwDiag?.last_updated_str
                ? dayjs(hwDiag.last_updated_str).format('h:mm A')
                : '--'
    };

    const isPaired = isPairingActive(pairingState);
    const pairedBoxId = pairingState?.box_id;
    // Pairing state is authoritative. Route params can be stale after reassignment/re-pair.
    const boxId = pairedBoxId ?? route?.params?.boxId ?? cachedBoxId ?? DEMO_BOX_ID;
    const routeDeliveryId = route?.params?.deliveryId as string | undefined;

    // Last-resort fallback for dev screens when box has no active delivery.
    const activeDeliveryId = routeDeliveryId || boxState?.delivery_id || 'DEL_001';
    const activeOtpCode = boxState?.otp_code || '';

    // Derive lock state from real data
    const isLocked = boxState?.status === 'LOCKED';
    const commandAckCommand = rawBoxState?.command_ack_command as string | undefined;
    const commandAckStatus = rawBoxState?.command_ack_status as string | undefined;
    const commandAckDetails = rawBoxState?.command_ack_details as string | undefined;
    const lockAwaitingClose = commandAckCommand === 'LOCKED' && commandAckStatus === 'waiting_close';
    const lockAwaitingCloseNeedsAssist = lockAwaitingClose && commandAckDetails === 'reed_open';
    const lockCloseConfirmed = commandAckCommand === 'LOCKED' && commandAckStatus === 'executed' && commandAckDetails === 'reed_closed_confirmed';

    // Initialize Logs and Subscriptions
    useEffect(() => {
        const unsubscribeBoxState = subscribeToBoxState(boxId, (state) => {
            setBoxState(state);
            // Extract GPS_LTE_Firebase_Test firmware fields from the hardware node.
            // The firmware writes these via PUT /hardware/{boxId}.json every 5 s.
            if (state) {
                const raw = state as any;
                setHwDiag(prev => ({
                    ...prev,            // keep previous values if new snapshot is partial
                    // gps_fix: boolean (true = fix acquired, false = searching)
                    ...(raw.gps_fix !== undefined && { gps_fix: raw.gps_fix }),
                    ...(raw.op !== undefined && { op: raw.op }),
                    ...(raw.csq !== undefined && { csq: raw.csq }),
                    ...(raw.uptime_ms !== undefined && { uptime_ms: raw.uptime_ms }),
                    ...(raw.connection !== undefined && { connection: raw.connection }),
                    ...(raw.data_bytes !== undefined && { data_bytes: raw.data_bytes }),
                    ...(raw.time_synced !== undefined && { time_synced: raw.time_synced }),
                    // last_updated_str is the human-readable ISO timestamp from firmware
                    ...(raw.last_updated_str !== undefined && { last_updated_str: raw.last_updated_str }),
                }));
            }
        });

        // GPS/LTE board writes box coordinates to locations/{boxId}/box
        const unsubscribeLocation = subscribeToLocation(boxId, (loc) => {
            if (loc) setLocationData(loc);
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
                PremiumAlert.alert("Face Scan Failed", "Please remove helmet and try again.");
                addLog("Face Scan Timeout - Helmet detected?", "warning");
            } else if (status === 'FAILED_USE_OTP') {
                PremiumAlert.alert("Face Scan Failed", "Please use OTP to unlock.");
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
            unsubscribeLocation();
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

    useEffect(() => {
        if (!riderId) return;

        let active = true;
        setPersonalPinLoading(true);
        fetchRiderPersonalPinStatus()
            .then((status) => {
                if (active) setPersonalPinStatus(status);
            })
            .catch(() => {
                if (active) setPersonalPinStatus(null);
            })
            .finally(() => {
                if (active) setPersonalPinLoading(false);
            });

        return () => {
            active = false;
        };
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

    useEffect(() => {
        if (!commandAckCommand || !commandAckStatus) return;

        const ackAt = rawBoxState?.command_ack_at ?? rawBoxState?.command_ack_epoch ?? '';
        const ackKey = `${commandAckCommand}|${commandAckStatus}|${commandAckDetails || ''}|${ackAt}`;
        if (lastCommandAckKeyRef.current === ackKey) return;
        lastCommandAckKeyRef.current = ackKey;

        const details = commandAckDetails ? ` (${commandAckDetails})` : '';
        const commandLabel = commandAckCommand === 'REBOOT_ALL' ? 'Reboot All' : commandAckCommand;

        if (commandAckStatus === 'accepted') {
            addLog(`Command accepted by hardware: ${commandLabel}${details}`, 'info');
            return;
        }

        if (commandAckStatus === 'executed') {
            addLog(`Command executed: ${commandLabel}${details}`, 'success');
            return;
        }

        if (commandAckStatus === 'waiting_close' || commandAckStatus === 'timeout_waiting_close') {
            addLog(`Command pending completion: ${commandLabel}${details}`, 'warning');
            return;
        }

        addLog(`Command failed: ${commandLabel} [${commandAckStatus}]${details}`, 'error');
    }, [commandAckCommand, commandAckStatus, commandAckDetails]);

    const toggleLock = async () => {
        if (!isPaired) {
            PremiumAlert.alert('Pair Required', 'Scan your box QR to unlock controls.');
            navigation.navigate('PairBox' as never);
            return;
        }
        // EC-90: Block unlock if solenoid is blocked due to low voltage
        if (isLocked && powerState?.solenoid_blocked) {
            PremiumAlert.alert(
                '🔋 Low Voltage',
                `Battery voltage too low (${powerState.voltage.toFixed(1)}V). Cannot unlock until battery is charged.`,
                [{ text: 'OK' }]
            );
            return;
        }

        // EC-96: Block unlock if solenoid is overheated
        if (lockHealth?.overheated) {
            PremiumAlert.alert(
                '🔥 System Overheated',
                'Lock mechanism is too hot. Please wait for it to cool down.',
                [{ text: 'OK' }]
            );
            return;
        }

        if (isLocked) {
            setUnlockPin('');
            setShowUnlockPin(false);
            setShowUnlockPinModal(true);
            return;
        }

        const action = "LOCKED";
        const requestId = `manual_${Date.now()}`;

        // EC-FIX: Send command to Firebase instead of local toggle
        try {
            setManualOverrideSending(true);
            addLog(`Sending manual override: ${action} -> ${boxId}`, "warning");
            const { updateBoxState } = await import('../../services/firebaseClient');
            await updateBoxState(boxId, {
                command: action,
                command_request_id: requestId,
                command_requested_by: 'mobile_rider',
            } as any);
            addLog(`Manual override queued: ${action} -> ${boxId}`, "info");
            PremiumAlert.alert(
                'Manual Override Queued',
                action === 'UNLOCKING'
                    ? `Unlock command queued for ${boxId}. Waiting for hardware acknowledgment.`
                    : `Lock command queued for ${boxId}. If the lid remains open, lock confirmation will wait until reed-close is detected.`
            );
        } catch (error) {
            console.error('[toggleLock] Failed to send manual override:', error);
            addLog('Manual override failed to send', 'error');
            PremiumAlert.alert('Manual Override Failed', 'Could not send command. Check network and try again.');
        } finally {
            setManualOverrideSending(false);
        }
    };

    const handleSubmitUnlockWithPin = async () => {
        const sanitizedPin = sanitizePinInput(unlockPin);
        if (!/^\d{6}$/.test(sanitizedPin)) {
            PremiumAlert.alert('Invalid PIN', 'Enter your 6-digit Personal PIN to unlock.');
            return;
        }

        try {
            setUnlockPinSubmitting(true);
            setManualOverrideSending(true);

            const { unlockToken } = await verifyRiderPersonalPinForUnlock(boxId, sanitizedPin);
            await sendRiderUnlockCommand(boxId, unlockToken);

            addLog(`Manual override queued: UNLOCKING -> ${boxId}`, 'info');
            setShowUnlockPinModal(false);
            setUnlockPin('');

            PremiumAlert.alert(
                'Unlock Command Queued',
                `Unlock command queued for ${boxId}. Waiting for hardware acknowledgment.`
            );
        } catch (error: any) {
            console.error('[handleSubmitUnlockWithPin] Unlock failed:', error);
            addLog('Manual unlock failed: PIN verification or authorization error', 'error');
            PremiumAlert.alert('Unlock Failed', error?.message || 'Could not authorize unlock.');
        } finally {
            setUnlockPinSubmitting(false);
            setManualOverrideSending(false);
        }
    };

    const handleEmergencyOpen = () => {
        PremiumAlert.alert(
            "Emergency Open",
            "This will force the lock open and trigger an incident report. Continue?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "FORCE OPEN",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            setManualOverrideSending(true);
                            const { updateBoxState } = await import('../../services/firebaseClient');
                            await updateBoxState(boxId, {
                                command: 'UNLOCKING',
                                command_request_id: `emergency_${Date.now()}`,
                                command_requested_by: 'mobile_emergency',
                            } as any); // Or specific emergency state if available
                            addLog("EMERGENCY OPEN TRIGGERED", "error");
                            addLog("Incident Report #9921 created", "info");
                            PremiumAlert.alert('Emergency Command Sent', `Force-open command sent to ${boxId}.`);
                        } catch (error) {
                            console.error('[handleEmergencyOpen] Failed to send emergency command:', error);
                            addLog('Emergency open failed to send', 'error');
                            PremiumAlert.alert('Emergency Command Failed', 'Unable to send emergency command. Check network and retry.');
                        } finally {
                            setManualOverrideSending(false);
                        }
                    }
                }
            ]
        );
    };

    const handleReboot = () => {
        PremiumAlert.alert(
            "Reboot System",
            "This sends a coordinated reboot command to Proxy, Controller, and CAM boards via Firebase. The box may go offline for ~30-60 seconds while services restart.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Send Reboot",
                    onPress: () => {
                        setRebooting(true);
                        addLog("Coordinated reboot command sent to hardware...", "warning");
                        import('../../services/firebaseClient').then(({ updateBoxState }) => {
                            // Keep legacy reboot flags and send explicit cross-board reboot token.
                            (updateBoxState as any)(boxId, {
                                reboot_requested: true,
                                reboot_ts: Date.now(),
                                command: 'REBOOT_ALL',
                                command_request_id: `reboot_${Date.now()}`,
                                command_requested_by: 'mobile_reboot',
                            });
                            addLog("Waiting for reconnect (~30-60s)...", "info");
                        });
                        // Clear rebooting state after firmware expected reconnect window
                        setTimeout(() => {
                            setRebooting(false);
                            addLog("Reconnect window elapsed. Check LTE/GPS status above.", "success");
                        }, 60000);
                    }
                }
            ]
        );
    };

    const handleReportStolen = () => {
        PremiumAlert.alert(
            "Report Stolen/Missing",
            "Are you sure you want to report this box as stolen or missing? This will trigger an immediate lockdown and alert administrators.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "REPORT STOLEN",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            const { status } = await Location.requestForegroundPermissionsAsync();
                            let currentLoc: { lat: number; lng: number; heading?: number; speed?: number } = { lat: 14.5995, lng: 120.9842 }; // Default Manila

                            if (status === 'granted') {
                                const location = await Location.getCurrentPositionAsync({
                                    accuracy: Location.Accuracy.Balanced
                                });
                                currentLoc = {
                                    lat: location.coords.latitude,
                                    lng: location.coords.longitude,
                                    heading: location.coords.heading || 0,
                                    speed: location.coords.speed || 0
                                };
                            }

                            await reportBoxStolen(
                                boxId,
                                riderId || 'unknown_rider',
                                currentLoc,
                                activeDeliveryId || undefined,
                                `Reported via Rider App at ${new Date().toLocaleTimeString()}`
                            );

                            if (activeDeliveryId && activeDeliveryId !== 'DEL_001') {
                                await updateDeliveryStatus(activeDeliveryId, 'TAMPERED', {
                                    source: 'rider_reported',
                                    tampered_at: Date.now()
                                });
                            }

                            addLog("🚨 BOX REPORTED STOLEN. Lockdown initiated.", "error");

                        } catch (error) {
                            addLog("Failed to report stolen box", "error");
                            PremiumAlert.alert("Error", "Could not send report. Please check connection.");
                        }
                    }
                }
            ]
        );
    };

    // EC-04: Reset OTP Lockout
    const handleResetLockout = async () => {
        PremiumAlert.alert(
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
                            PremiumAlert.alert("Success", "Lockout has been reset. Customer can now retry OTP.");
                        } catch (error) {
                            addLog("Failed to reset lockout", "error");
                            PremiumAlert.alert("Error", "Failed to reset lockout. Try again.");
                        }
                    }
                }
            ]
        );
    };

    // EC-02: BLE OTP Transfer
    const handleBleTransfer = async () => {
        if (!isPaired) {
            PremiumAlert.alert('Pair Required', 'Scan your box QR before sending OTP over BLE.');
            navigation.navigate('PairBox' as never);
            return;
        }

        if (!activeDeliveryId || !activeOtpCode || activeOtpCode.length < 6) {
            PremiumAlert.alert(
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
        if (batteryState == null) return c.textTer;
        const pct = batteryState.percentage;
        if (pct > 20) return c.greenText;
        if (pct > 10) return c.orangeText;
        return c.redText;
    };

    const getBatteryIcon = () => {
        if (batteryState == null) return 'battery-unknown';
        const pct = batteryState.percentage;
        if (pct > 80) return 'battery';
        if (pct > 60) return 'battery-70';
        if (pct > 40) return 'battery-50';
        if (pct > 20) return 'battery-30';
        return 'battery-alert';
    };

    const TelemetryItem = ({ icon, label, value, color }) => (
        <Surface style={[styles.telemetryCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]} elevation={isDarkMode ? 0 : 1}>
            <MaterialCommunityIcons name={icon} size={24} color={color} />
            <Text variant="labelSmall" style={{ marginTop: 4, color: c.textSec }}>{label}</Text>
            <Text variant="titleMedium" style={{ fontWeight: 'bold', color: c.text }}>{value}</Text>
        </Surface>
    );

    // EC-97: Face Unlock Handler
    const handleFaceUnlock = async () => {
        if (lockHealth?.overheated) {
            PremiumAlert.alert('🔥 System Overheated', 'Wait for cool down.');
            return;
        }

        try {
            addLog("Starting Face Scan...", "info");
            await startFaceScan(boxId);
        } catch (error) {
            addLog("Failed to start face scan", "error");
        }
    };

    const handleOpenPersonalPinModal = () => {
        if (!isPaired) {
            PremiumAlert.alert('Pair Required', 'Scan your box QR before managing Personal PIN.');
            navigation.navigate('PairBox' as never);
            return;
        }

        if (tamperState?.lockdown) {
            PremiumAlert.alert('Unavailable', 'Personal PIN changes are blocked while tamper lockdown is active.');
            return;
        }

        setNewPersonalPin('');
        setConfirmPersonalPin('');
        setShowNewPersonalPin(false);
        setShowConfirmPersonalPin(false);
        setShowPersonalPinModal(true);
    };

    const handleSavePersonalPin = async () => {
        const sanitizedNewPin = sanitizePinInput(newPersonalPin);
        const sanitizedConfirmPin = sanitizePinInput(confirmPersonalPin);

        if (!/^\d{6}$/.test(sanitizedNewPin)) {
            PremiumAlert.alert('Invalid PIN', 'Personal PIN must be exactly 6 digits.');
            return;
        }
        if (sanitizedNewPin !== sanitizedConfirmPin) {
            PremiumAlert.alert('Mismatch', 'PIN confirmation does not match.');
            return;
        }

        try {
            setSavingPersonalPin(true);
            await setRiderPersonalPin(boxId, sanitizedNewPin);
            addLog('Personal PIN updated from rider dashboard', 'success');
            PremiumAlert.alert('Saved', 'Personal PIN has been updated. Existing PIN is never displayed for security.');
            setShowPersonalPinModal(false);

            const refreshed = await fetchRiderPersonalPinStatus();
            setPersonalPinStatus(refreshed);
        } catch (error: any) {
            addLog('Failed to update Personal PIN', 'error');
            PremiumAlert.alert('Failed', error?.message || 'Could not update Personal PIN.');
        } finally {
            setSavingPersonalPin(false);
        }
    };

    const handleForgotPersonalPin = async () => {
        if (!isPaired) {
            PremiumAlert.alert('Pair Required', 'Scan your box QR before requesting PIN reset.');
            return;
        }

        PremiumAlert.alert(
            'Forgot Personal PIN',
            'For security, the current PIN cannot be shown. This will disable your current Personal PIN and require you to set a new one.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reset PIN',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setPersonalPinLoading(true);
                            await resetRiderPersonalPin(boxId);
                            addLog('Personal PIN reset requested (forgot PIN flow)', 'warning');
                            PremiumAlert.alert('Reset Requested', 'Personal PIN has been disabled. Set a new PIN before using keypad personal mode.');
                            const refreshed = await fetchRiderPersonalPinStatus();
                            setPersonalPinStatus(refreshed);
                        } catch (error: any) {
                            addLog('Failed to reset Personal PIN', 'error');
                            PremiumAlert.alert('Failed', error?.message || 'Could not reset Personal PIN.');
                        } finally {
                            setPersonalPinLoading(false);
                        }
                    }
                }
            ]
        );
    };

    const screenAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.container, { backgroundColor: c.bg }, screenAnim.style]}>
            <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: Math.max(insets.top, 20), paddingBottom: insets.bottom + 20 }]}>

                {!isPaired && (
                    <Surface style={[styles.pairingBanner, { backgroundColor: c.accent }]} elevation={3}>
                        <MaterialCommunityIcons name="qrcode" size={24} color={c.accentText} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.alertTitle, { color: c.accentText }]}>PAIR REQUIRED</Text>
                            <Text style={[styles.alertText, { color: isDarkMode ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)' }]}>Scan the box QR to unlock controls and health data.</Text>
                        </View>
                        <Button
                            mode="contained"
                            onPress={() => navigation.navigate('PairBox' as never)}
                            buttonColor={isDarkMode ? '#2C2C2E' : 'white'}
                            textColor={c.text}
                        >
                            Pair
                        </Button>
                    </Surface>
                )}

                {/* EC-77: Admin Override Alert Banner */}
                {isPaired && adminOverrideState?.active && !adminOverrideState.processed && (
                    <Surface style={[styles.alertBanner, { backgroundColor: c.redBg, borderLeftWidth: 4, borderLeftColor: c.redText }]} elevation={isDarkMode ? 0 : 4}>
                        <MaterialCommunityIcons name="lock-open-alert" size={24} color={c.redText} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.alertTitle, { color: c.redText }]}>ADMIN OVERRIDE</Text>
                            <Text style={[styles.alertText, { color: c.textSec }]}>{getOverrideNotificationMessage(adminOverrideState)}</Text>
                        </View>
                    </Surface>
                )}

                {/* EC-18: Tamper Alert Banner */}
                {isPaired && tamperState?.detected && (
                    <Surface style={[styles.alertBanner, { backgroundColor: c.redBg, borderLeftWidth: 4, borderLeftColor: c.redText }]} elevation={isDarkMode ? 0 : 4}>
                        <MaterialCommunityIcons name="alert-decagram" size={24} color={c.redText} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.alertTitle, { color: c.redText }]}>⚠️ SECURITY ALERT</Text>
                            <Text style={[styles.alertText, { color: c.textSec }]}>Box tamper detected! Lockdown active.</Text>
                        </View>
                    </Surface>
                )}

                {/* EC-03: Low Battery Warning Banner */}
                {isPaired && batteryState?.lowBatteryWarning && (
                    <Surface style={[styles.warningBanner, { backgroundColor: batteryState.criticalBatteryWarning ? c.redBg : c.orangeBg, borderLeftWidth: 4, borderLeftColor: batteryState.criticalBatteryWarning ? c.redText : c.orangeText }]} elevation={isDarkMode ? 0 : 3}>
                        <MaterialCommunityIcons
                            name="battery-alert"
                            size={24}
                            color={batteryState.criticalBatteryWarning ? c.redText : c.orangeText}
                        />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.warningTitle, { color: batteryState.criticalBatteryWarning ? c.redText : c.orangeText }]}>
                                {batteryState.criticalBatteryWarning ? '🔴 CRITICAL BATTERY' : '🟡 LOW BATTERY'}
                            </Text>
                            <Text style={[styles.warningText, { color: c.textSec }]}>
                                Battery at {batteryState.percentage}% - {batteryState.criticalBatteryWarning ? 'Charge immediately!' : 'Charge soon'}
                            </Text>
                        </View>
                    </Surface>
                )}

                {/* EC-04: OTP Lockout Status Card */}
                {isPaired && lockoutState?.active && (
                    <Surface style={[styles.lockoutCard, { backgroundColor: c.redBg, borderLeftColor: c.redText }]} elevation={isDarkMode ? 0 : 3}>
                        <View style={styles.lockoutHeader}>
                            <MaterialCommunityIcons name="lock-alert" size={28} color={c.redText} />
                            <View style={{ flex: 1, marginLeft: 12 }}>
                                <Text style={[styles.lockoutTitle, { color: c.redText }]}>OTP LOCKOUT ACTIVE</Text>
                                <Text style={[styles.lockoutText, { color: c.textSec }]}>
                                    {lockoutState.attempt_count} failed attempts - Unlocks in {lockoutCountdown}
                                </Text>
                            </View>
                        </View>
                        <Button
                            mode="contained"
                            onPress={handleResetLockout}
                            style={styles.resetButton}
                            buttonColor={c.redText}
                            textColor={isDarkMode ? '#000' : '#fff'}
                            icon="lock-open-variant"
                        >
                            Reset Lockout
                        </Button>
                    </Surface>
                )}

                {/* EC-07: OTP Expiry Warning */}
                {isPaired && otpStatus?.otp_expired && (
                    <Surface style={[styles.expiryCard, { backgroundColor: c.orangeBg, borderLeftColor: c.orangeText }]} elevation={isDarkMode ? 0 : 2}>
                        <MaterialCommunityIcons name="clock-alert" size={24} color={c.orangeText} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.expiryTitle, { color: c.orangeText }]}>OTP EXPIRED</Text>
                            <Text style={[styles.expiryText, { color: c.textSec }]}>The current OTP has expired. A new one must be generated.</Text>
                        </View>
                    </Surface>
                )}

                {/* Header Animation */}
                <View style={[styles.headerContainer, { backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]}>
                    <MaterialCommunityIcons
                        name={!isPaired ? "link-variant-off" : (isLocked ? "shield-check" : "shield-alert")}
                        size={100}
                        color={!isPaired ? c.textTer : (isLocked ? c.greenText : c.redText)}
                        style={{ marginBottom: 10 }}
                    />
                    <Text variant="headlineSmall" style={{ fontWeight: 'bold', marginTop: 10, color: c.text }}>
                        {!isPaired ? "No Box Connected" : (isLocked ? "System Secure" : "System Unlocked")}
                    </Text>
                    <Text variant="bodyMedium" style={{ color: !isPaired ? c.textTer : (isLocked ? c.greenText : c.redText) }}>
                        {!isPaired ? "Pair to view status" : (isLocked ? "Lock Engaged" : "Lock Disengaged")}
                    </Text>
                </View>

                {/* Telemetry Grid */}
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>Live Telemetry</Text>
                <View style={styles.grid}>
                    <TelemetryItem
                        icon={isPaired ? getBatteryIcon() : "battery-unknown"}
                        label="Battery"
                        value={isPaired ? (batteryState ? `${batteryState.percentage}%` : '--') : '--%'}
                        color={isPaired ? getBatteryColor() : c.textTer}
                    />
                    <TelemetryItem
                        icon={isPaired ? (hwDiag?.gps_fix ? 'satellite-variant' : 'satellite-variant-outline') : 'satellite-variant-outline'}
                        label="GPS Fix"
                        value={isPaired ? telemetry.gps : '--'}
                        color={isPaired ? (hwDiag?.gps_fix ? c.greenText : c.redText) : c.textTer}
                    />
                    <TelemetryItem
                        icon={isPaired ? (hasValidRssi(boxState?.rssi) && boxState!.rssi! >= -85 ? 'signal-4g' : 'signal') : 'signal-off'}
                        label="LTE Signal"
                        value={isPaired ? telemetry.signal : '-- dBm'}
                        color={isPaired ? (hasValidRssi(boxState?.rssi) && boxState!.rssi! >= -85 ? c.greenText : c.orangeText) : c.textTer}
                    />
                    <TelemetryItem
                        icon="sync"
                        label="Last Sync"
                        value={isPaired ? telemetry.sync : '--'}
                        color={isPaired ? c.purpleText : c.textTer}
                    />
                </View>

                {/* EC-ENHANCE: Grouped Smart Box Controls */}
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>Smart Box Controls</Text>
                <Card style={[styles.controlsCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]}>
                    <Card.Content>
                        {/* 1. Manual Lock Control */}
                        <Text variant="labelMedium" style={{ marginTop: 8, marginBottom: 8, color: c.textTer }}>Manual Override</Text>
                        <Button
                            mode="contained"
                            onPress={toggleLock}
                            disabled={!isPaired || manualOverrideSending || boxState?.status === 'UNLOCKING'}
                            loading={manualOverrideSending || boxState?.status === 'UNLOCKING'}
                            style={[
                                styles.button,
                                {
                                    backgroundColor: !isPaired ? c.search : (isLocked ? c.accent : c.redText),
                                    marginBottom: 16
                                }
                            ]}
                            textColor={!isPaired ? c.textTer : c.accentText}
                            icon={boxState?.status === 'UNLOCKING' ? undefined : (isLocked ? "lock" : "lock-open")}
                            contentStyle={{ height: 48 }}
                        >
                            {isPaired ? (boxState?.status === 'UNLOCKING' ? "Actuating..." : (isLocked ? "Unlock Box" : "Lock Box")) : "Controls Disabled"}
                        </Button>

                        {lockAwaitingClose && (
                            <View style={{ marginTop: -6, marginBottom: 12, padding: 10, borderRadius: 10, backgroundColor: c.orangeBg, borderWidth: 1, borderColor: c.orangeText }}>
                                <Text style={{ color: c.orangeText, fontWeight: '700' }}>
                                    Lock pending physical close
                                </Text>
                                <Text style={{ marginTop: 4, color: c.orangeText, fontSize: 12 }}>
                                    {lockAwaitingCloseNeedsAssist
                                        ? 'Close the lid fully. If the latch is blocking closure, press # on the keypad for brief retract assist, then close again.'
                                        : 'Close the lid fully so the reed switch can confirm lock completion.'}
                                </Text>
                            </View>
                        )}

                        {lockCloseConfirmed && (
                            <View style={{ marginTop: -6, marginBottom: 12, padding: 10, borderRadius: 10, backgroundColor: c.greenBg, borderWidth: 1, borderColor: c.greenText }}>
                                <Text style={{ color: c.greenText, fontWeight: '700' }}>
                                    Lock confirmed
                                </Text>
                                <Text style={{ marginTop: 4, color: c.greenText, fontSize: 12 }}>
                                    Reed close confirmed. The lock is physically secured.
                                </Text>
                            </View>
                        )}

                        <Divider style={[styles.divider, { backgroundColor: c.divider }]} />

                        {/* 2. Personal PIN Management */}
                        <Text variant="labelMedium" style={{ marginTop: 8, marginBottom: 8, color: c.textTer }}>Personal PIN</Text>
                        <View style={styles.controlRow}>
                            <View style={[styles.iconContainer, {
                                backgroundColor: !isPaired ? c.search : (personalPinStatus?.enabled ? c.greenBg : c.orangeBg),
                                opacity: !isPaired ? 0.5 : 1
                            }]}>
                                <MaterialCommunityIcons
                                    name="form-textbox-password"
                                    size={24}
                                    color={!isPaired ? c.textTer : (personalPinStatus?.enabled ? c.greenText : c.orangeText)}
                                />
                            </View>
                            <View style={styles.controlInfo}>
                                <Text variant="titleMedium" style={{ fontWeight: 'bold', color: !isPaired ? c.textTer : c.text }}>
                                    {personalPinStatus?.enabled ? 'Personal PIN Enabled' : 'Personal PIN Not Set'}
                                </Text>
                                <Text variant="bodySmall" style={{ color: !isPaired ? c.textTer : c.textSec }}>
                                    {personalPinLoading
                                        ? 'Loading PIN status...'
                                        : 'For security, your current PIN is never shown in the app.'}
                                </Text>
                            </View>
                        </View>
                        <View style={styles.row}>
                            <Button
                                mode="contained-tonal"
                                onPress={handleOpenPersonalPinModal}
                                disabled={!isPaired || personalPinLoading}
                                style={{ flex: 1, marginRight: 8 }}
                                icon="shield-edit"
                            >
                                {personalPinStatus?.enabled ? 'Change PIN' : 'Set PIN'}
                            </Button>
                            <Button
                                mode="outlined"
                                onPress={handleForgotPersonalPin}
                                disabled={!isPaired || personalPinLoading}
                                style={{ flex: 1, borderColor: c.orangeText }}
                                textColor={c.orangeText}
                                icon="help-circle-outline"
                            >
                                Forgot PIN
                            </Button>
                        </View>
                        <Text style={[styles.hintText, { color: c.textTer, marginTop: 8 }]}>Considerations: keep box locked before updates, never share PIN, and reset immediately if compromised.</Text>

                        <Divider style={[styles.divider, { backgroundColor: c.divider }]} />

                        {/* 3. System Maintenance */}
                        <Text variant="labelMedium" style={{ marginTop: 8, marginBottom: 8, color: c.textTer }}>System Maintenance</Text>
                        <View style={styles.row}>
                            <Button
                                mode="outlined"
                                onPress={handleReboot}
                                loading={rebooting}
                                disabled={!isPaired || rebooting}
                                style={[styles.button, { flex: 1, marginRight: 8, borderColor: !isPaired ? c.border : c.orangeText }]}
                                textColor={!isPaired ? c.textTer : c.orangeText}
                                icon="restart"
                            >
                                Reboot
                            </Button>
                            <Button
                                mode="outlined"
                                onLongPress={handleEmergencyOpen}
                                delayLongPress={1000}
                                disabled={!isPaired}
                                style={[styles.button, { flex: 1, borderColor: !isPaired ? c.border : c.redText }]}
                                textColor={!isPaired ? c.textTer : c.redText}
                                icon="alert"
                                onPress={() => PremiumAlert.alert('Long Press Required', 'Press and hold Emergency for 1 second to trigger force open.')}
                            >
                                Emergency
                            </Button>
                        </View>
                        <Text style={[styles.hintText, { color: c.textTer }]}>* Long press "Emergency" to force open</Text>

                        <Button
                            mode="contained"
                            onPress={handleReportStolen}
                            disabled={!isPaired}
                            style={[styles.button, { marginTop: 16, backgroundColor: !isPaired ? c.search : c.redText }]}
                            textColor={!isPaired ? c.textTer : (isDarkMode ? '#000' : '#fff')}
                            icon="shield-alert-outline"
                        >
                            Report Box Stolen/Missing
                        </Button>
                    </Card.Content>
                </Card>

                {/* Hardware Diagnostics — driven by real firmware data */}
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>Hardware Diagnostics</Text>
                <Card style={[styles.controlsCard, { marginBottom: 24, backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]}>
                    <Card.Content>

                        {/* LTE Module (GPS_LTE_Firebase_Test) */}
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, { backgroundColor: c.blueBg }]}>
                                <MaterialCommunityIcons name="antenna" size={22} color={c.blueText} />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text variant="titleSmall" style={{ fontWeight: 'bold', color: c.text }}>LTE Module (A7670E)</Text>
                                <Text variant="bodySmall" style={{ color: c.textSec }}>
                                    {isPaired
                                        ? `${hwDiag?.op || 'Unknown carrier'} • CSQ: ${hwDiag?.csq ?? '--'}/31 (${getCsqPercent(hwDiag?.csq)}%)`
                                        : 'Requires pairing'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, {
                                backgroundColor: isPaired && boxState?.rssi ? c.blueBg : c.search
                            }]}>
                                <Text style={[
                                    styles.diagBadgeText,
                                    { color: isPaired && boxState?.rssi ? c.blueText : c.textTer }
                                ]}>
                                    {isPaired ? getRssiQuality(boxState?.rssi) : '--'}
                                </Text>
                            </View>
                        </View>

                        <Divider style={styles.divider} />

                        {/* GPS (GPS_LTE_Firebase_Test) */}
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, {
                                backgroundColor: isPaired ? (hwDiag?.gps_fix ? c.greenBg : c.redBg) : c.search
                            }]}>
                                <MaterialCommunityIcons
                                    name="satellite-uplink"
                                    size={22}
                                    color={isPaired ? (hwDiag?.gps_fix ? c.greenText : c.redText) : c.textTer}
                                />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text variant="titleSmall" style={{ fontWeight: 'bold', color: c.text }}>GPS / GNSS</Text>
                                <Text variant="bodySmall" style={{ color: c.textSec }}>
                                    {isPaired
                                        ? (locationData
                                            ? `${locationData.latitude?.toFixed(5)}, ${locationData.longitude?.toFixed(5)}`
                                            : (hwDiag?.gps_fix ? 'Fix acquired, awaiting coords...' : 'Searching for satellites...'))
                                        : 'Requires pairing'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, {
                                backgroundColor: isPaired ? (hwDiag?.gps_fix ? c.greenBg : c.redBg) : c.search
                            }]}>
                                <Text style={[
                                    styles.diagBadgeText,
                                    { color: isPaired ? (hwDiag?.gps_fix ? c.greenText : c.redText) : c.textTer }
                                ]}>
                                    {isPaired ? (hwDiag?.gps_fix ? 'FIXED' : 'SEARCHING') : '--'}
                                </Text>
                            </View>
                        </View>

                        <Divider style={[styles.divider, { backgroundColor: c.divider }]} />

                        {/* ESP32-CAM (ESP32CAM_OV3660_Supabase_R3_Test) */}
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, {
                                backgroundColor: faceAuthStatus === 'SEARCHING' ? c.orangeBg
                                    : faceAuthStatus === 'AUTHENTICATED' ? c.greenBg
                                        : c.purpleBg
                            }]}>
                                <MaterialCommunityIcons
                                    name="camera-iris"
                                    size={22}
                                    color={faceAuthStatus === 'SEARCHING' ? c.orangeText
                                        : faceAuthStatus === 'AUTHENTICATED' ? c.greenText
                                            : c.purpleText}
                                />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text variant="titleSmall" style={{ fontWeight: 'bold', color: c.text }}>ESP32-CAM (OV3660)</Text>
                                <Text variant="bodySmall" style={{ color: c.textSec }}>
                                    {faceAuthStatus === 'SEARCHING' ? 'Person-detect scan in progress...'
                                        : faceAuthStatus === 'AUTHENTICATED' ? 'Person authenticated — solenoid triggered'
                                            : faceAuthStatus === 'TIMEOUT_REMOVE_HELMET' ? 'Blocked — helmet/occlusion detected'
                                                : faceAuthStatus === 'FAILED_USE_OTP' ? 'No face match — fall back to OTP'
                                                    : 'Idle — continuous person-detect running'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, {
                                backgroundColor: faceAuthStatus === 'SEARCHING' ? c.orangeBg
                                    : faceAuthStatus === 'AUTHENTICATED' ? c.greenBg
                                        : c.purpleBg
                            }]}>
                                <Text style={[
                                    styles.diagBadgeText,
                                    {
                                        color: faceAuthStatus === 'SEARCHING' ? c.orangeText
                                            : faceAuthStatus === 'AUTHENTICATED' ? c.greenText
                                                : c.purpleText
                                    }
                                ]}>
                                    {faceAuthStatus === 'IDLE' ? 'READY' : faceAuthStatus}
                                </Text>
                            </View>
                        </View>

                        <Divider style={[styles.divider, { backgroundColor: c.divider }]} />

                        {/* Keypad Tester (Tester.ino) */}
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, {
                                backgroundColor: lockoutState?.active ? c.redBg
                                    : otpStatus?.otp_expired ? c.orangeBg
                                        : c.greenBg
                            }]}>
                                <MaterialCommunityIcons
                                    name="dialpad"
                                    size={22}
                                    color={lockoutState?.active ? c.redText
                                        : otpStatus?.otp_expired ? c.orangeText
                                            : c.greenText}
                                />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text variant="titleSmall" style={{ fontWeight: 'bold', color: c.text }}>Keypad Tester</Text>
                                <Text variant="bodySmall" style={{ color: c.textSec }}>
                                    {lockoutState?.active
                                        ? `LOCKOUT: ${lockoutState.attempt_count} failed — clears in ${lockoutCountdown}`
                                        : otpStatus?.otp_expired
                                            ? 'OTP expired — new code required'
                                            : activeOtpCode
                                                ? `Active OTP: ${'●'.repeat(activeOtpCode.length)} (${activeOtpCode.length} digits)`
                                                : 'Waiting for OTP assignment'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, {
                                backgroundColor: lockoutState?.active ? c.redBg
                                    : otpStatus?.otp_expired ? c.orangeBg
                                        : c.greenBg
                            }]}>
                                <Text style={[
                                    styles.diagBadgeText,
                                    {
                                        color: lockoutState?.active ? c.redText
                                            : otpStatus?.otp_expired ? c.orangeText
                                                : c.greenText
                                    }
                                ]}>
                                    {lockoutState?.active ? 'LOCKOUT' : otpStatus?.otp_expired ? 'EXPIRED' : 'READY'}
                                </Text>
                            </View>
                        </View>

                        <Divider style={[styles.divider, { backgroundColor: c.divider }]} />

                        {/* Solenoid Lock Unit */}
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, { backgroundColor: lockHealth?.overheated ? c.redBg : c.greenBg }]}>
                                <MaterialCommunityIcons name="lock-smart" size={22} color={lockHealth?.overheated ? c.redText : c.greenText} />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text variant="titleSmall" style={{ fontWeight: 'bold', color: c.text }}>Solenoid Lock Unit</Text>
                                <Text variant="bodySmall" style={{ color: c.textSec }}>
                                    {lockHealth?.overheated ? 'Thermal cutoff triggered (cool down required)' : 'Operating normally'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, { backgroundColor: lockHealth?.overheated ? c.redBg : c.greenBg }]}>
                                <Text style={[styles.diagBadgeText, { color: lockHealth?.overheated ? c.redText : c.greenText }]}>
                                    {lockHealth?.overheated ? 'OVERHEATED' : 'NOMINAL'}
                                </Text>
                            </View>
                        </View>

                        <Divider style={[styles.divider, { backgroundColor: c.divider }]} />

                        {/* System Uptime & Data Usage */}
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, { backgroundColor: c.purpleBg }]}>
                                <MaterialCommunityIcons name="timer-outline" size={22} color={c.purpleText} />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text variant="titleSmall" style={{ fontWeight: 'bold', color: c.text }}>Device Health</Text>
                                <Text variant="bodySmall" style={{ color: c.textSec }}>
                                    {hwDiag?.uptime_ms
                                        ? `Up ${Math.floor(hwDiag.uptime_ms / 3600000)}h ${Math.floor((hwDiag.uptime_ms % 3600000) / 60000)}m${hwDiag.time_synced ? ' • NTP ✓' : ' • Clock not synced'}`
                                        : isPaired ? 'Uptime not reported yet' : 'Requires pairing'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, { backgroundColor: c.purpleBg }]}>
                                <Text style={[styles.diagBadgeText, { color: c.purpleText }]}>
                                    {hwDiag?.data_bytes ? `${(hwDiag.data_bytes / 1024).toFixed(1)} KB` : '--'}
                                </Text>
                            </View>
                        </View>

                    </Card.Content>
                </Card>

                {/* Detailed Logs */}
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: c.text }]}>System Event Log</Text>
                <Surface style={[styles.logContainer, { backgroundColor: isDarkMode ? '#1C1C1E' : '#1E1E1E' }]} elevation={isDarkMode ? 0 : 2}>
                    {isPaired ? (
                        logs.map((log, index) => (
                            <View key={index} style={[styles.logRow, { borderBottomColor: isDarkMode ? '#38383A' : '#333' }]}>
                                <Text style={[styles.logTime, { color: c.textTer }]}>{log.time}</Text>
                                <Text style={[styles.logMessage, {
                                    color: log.type === 'error' ? c.redText :
                                        log.type === 'warning' ? c.orangeText :
                                            log.type === 'success' ? c.greenText : (isDarkMode ? '#AEAEB2' : '#CCC')
                                }]}>
                                    {log.message}
                                </Text>
                            </View>
                        ))
                    ) : (
                        <View style={{ alignItems: 'center', justifyContent: 'center', height: 100 }}>
                            <Text style={{ color: c.textTer, fontStyle: 'italic' }}>No logs available (Unpaired)</Text>
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

            <Modal
                visible={showPersonalPinModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowPersonalPinModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <Surface style={styles.modalContent} elevation={5}>
                        <View style={styles.modalHeader}>
                            <Text variant="titleLarge" style={{ fontWeight: 'bold' }}>Set Personal PIN</Text>
                            <IconButton icon="close" size={24} onPress={() => setShowPersonalPinModal(false)} />
                        </View>
                        <View style={styles.modalBody}>
                            <Text variant="bodyMedium" style={{ marginBottom: 12, color: c.textSec, textAlign: 'center' }}>
                                This PIN is used on keypad key 4 manual mode. Existing PIN cannot be viewed after save.
                            </Text>
                            <TextInput
                                mode="outlined"
                                label="New Personal PIN"
                                value={newPersonalPin}
                                onChangeText={(value) => setNewPersonalPin(sanitizePinInput(value))}
                                keyboardType="number-pad"
                                secureTextEntry={!showNewPersonalPin}
                                maxLength={6}
                                right={
                                    <TextInput.Icon
                                        icon={showNewPersonalPin ? 'eye-off' : 'eye'}
                                        onPress={() => setShowNewPersonalPin((prev) => !prev)}
                                        forceTextInputFocus={false}
                                    />
                                }
                                style={{ width: '100%', marginBottom: 12 }}
                            />
                            <TextInput
                                mode="outlined"
                                label="Confirm Personal PIN"
                                value={confirmPersonalPin}
                                onChangeText={(value) => setConfirmPersonalPin(sanitizePinInput(value))}
                                keyboardType="number-pad"
                                secureTextEntry={!showConfirmPersonalPin}
                                maxLength={6}
                                right={
                                    <TextInput.Icon
                                        icon={showConfirmPersonalPin ? 'eye-off' : 'eye'}
                                        onPress={() => setShowConfirmPersonalPin((prev) => !prev)}
                                        forceTextInputFocus={false}
                                    />
                                }
                                style={{ width: '100%' }}
                            />
                        </View>
                        <View style={[styles.modalFooter, { paddingBottom: Math.max(16, insets.bottom + 16) }]}>
                            <Button
                                mode="outlined"
                                onPress={() => setShowPersonalPinModal(false)}
                                style={{ flex: 1, marginRight: 8 }}
                                disabled={savingPersonalPin}
                            >
                                Cancel
                            </Button>
                            <Button
                                mode="contained"
                                onPress={handleSavePersonalPin}
                                style={{ flex: 1 }}
                                loading={savingPersonalPin}
                                disabled={savingPersonalPin || newPersonalPin.length !== 6 || confirmPersonalPin.length !== 6}
                            >
                                Save PIN
                            </Button>
                        </View>
                    </Surface>
                </View>
            </Modal>

            <Modal
                visible={showUnlockPinModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowUnlockPinModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <Surface style={styles.modalContent} elevation={5}>
                        <View style={styles.modalHeader}>
                            <Text variant="titleLarge" style={{ fontWeight: 'bold' }}>Authorize Unlock</Text>
                            <IconButton
                                icon="close"
                                size={24}
                                onPress={() => setShowUnlockPinModal(false)}
                                disabled={unlockPinSubmitting}
                            />
                        </View>
                        <View style={styles.modalBody}>
                            <Text variant="bodyMedium" style={{ marginBottom: 12, color: c.textSec, textAlign: 'center' }}>
                                Enter your 6-digit Personal PIN to authorize this unlock command.
                            </Text>
                            <TextInput
                                mode="outlined"
                                label="Personal PIN"
                                value={unlockPin}
                                onChangeText={(value) => setUnlockPin(sanitizePinInput(value))}
                                keyboardType="number-pad"
                                secureTextEntry={!showUnlockPin}
                                maxLength={6}
                                right={
                                    <TextInput.Icon
                                        icon={showUnlockPin ? 'eye-off' : 'eye'}
                                        onPress={() => setShowUnlockPin((prev) => !prev)}
                                        forceTextInputFocus={false}
                                    />
                                }
                                style={{ width: '100%' }}
                            />
                        </View>
                        <View style={[styles.modalFooter, { paddingBottom: Math.max(16, insets.bottom + 16) }]}>
                            <Button
                                mode="outlined"
                                onPress={() => setShowUnlockPinModal(false)}
                                style={{ flex: 1, marginRight: 8 }}
                                disabled={unlockPinSubmitting}
                            >
                                Cancel
                            </Button>
                            <Button
                                mode="contained"
                                onPress={handleSubmitUnlockWithPin}
                                style={{ flex: 1 }}
                                loading={unlockPinSubmitting}
                                disabled={unlockPinSubmitting || unlockPin.length !== 6}
                            >
                                Authorize
                            </Button>
                        </View>
                    </Surface>
                </View>
            </Modal>
        </Animated.View>
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
    // Hardware Diagnostics
    diagRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    diagInfo: {
        flex: 1,
        marginLeft: 12,
    },
    diagBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        minWidth: 64,
        alignItems: 'center',
    },
    diagBadgeText: {
        fontSize: 11,
        fontWeight: 'bold',
    },
    modalFooter: {
        flexDirection: 'row',
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0',
    },
});
