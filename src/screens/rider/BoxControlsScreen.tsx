import React, { useState, useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, ScrollView, Alert, TouchableOpacity, Modal } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text, Card, Button, Surface, useTheme, IconButton, Divider, Portal, ActivityIndicator, TextInput } from 'react-native-paper';
import * as Progress from 'react-native-progress';
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
import * as ImagePicker from 'expo-image-picker';
import {
    fetchRiderPersonalPinStatus,
    setRiderPersonalPin,
    resetRiderPersonalPin,
    RiderPersonalPinStatus,
    verifyRiderBiometricForUnlock,
    verifyRiderPersonalPinForUnlock,
    sendRiderUnlockCommand,
} from '../../services/personalPinService';
import { authenticateBiometricForSensitiveAction, authenticateBiometricForUnlock } from '../../services/biometricAuthService';
import { uploadTamperEvidencePhoto } from '../../services/proofPhotoService';
import {
    fetchActiveTamperIncident,
    submitRiderTamperEvidence,
    RiderTamperIncident,
} from '../../services/tamperIncidentService';
import { showSecurityNotification } from '../../services/pushNotificationService';
import { getActionCriticality, shouldUseOptimisticUi } from '../../services/actionCriticality';

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
    const [locationAddress, setLocationAddress] = useState<string>('');

    // Fetch address when location changes
    useEffect(() => {
        if (!locationData?.latitude || !locationData?.longitude) return;
        
        let isMounted = true;
        const fetchAddress = async () => {
            try {
                // EC-06: Reverse Geocoding using Mapbox
                const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_DOWNLOAD_TOKEN || process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
                if (!MAPBOX_TOKEN) return;
                
                const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${locationData.longitude},${locationData.latitude}.json?access_token=${MAPBOX_TOKEN}&types=address,poi,neighborhood`;
                const response = await fetch(url);
                const data = await response.json();
                
                if (isMounted && data.features && data.features.length > 0) {
                    setLocationAddress(data.features[0].place_name.split(',')[0]); 
                }
            } catch (err) {
                // Ignore silent network errors
            }
        };
        fetchAddress();
        return () => { isMounted = false; };
    }, [locationData?.latitude, locationData?.longitude]);


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
    const [unlockProgress, setUnlockProgress] = useState(0);
    const [unlockProgressLabel, setUnlockProgressLabel] = useState('');
    const [showUnlockProgress, setShowUnlockProgress] = useState(false);
    const lastCommandAckKeyRef = useRef('');
    const [activeTamperIncident, setActiveTamperIncident] = useState<RiderTamperIncident | null>(null);
    const [incidentLoading, setIncidentLoading] = useState(false);
    const [tamperDisposition, setTamperDisposition] = useState<'HARDWARE_DAMAGED' | 'ACCIDENTAL_TRIGGER' | null>(null);
    const [tamperNote, setTamperNote] = useState('');
    const [tamperPhotoUri, setTamperPhotoUri] = useState<string | null>(null);
    const [tamperPhotoUrl, setTamperPhotoUrl] = useState<string | null>(null);
    const [tamperSubmitting, setTamperSubmitting] = useState(false);

    const sanitizePinInput = (value: string) => value.replace(/\D/g, '').slice(0, 6);

    // Extended hardware diagnostics — fields written by GPS_LTE_Firebase_Test firmware
    const [hwDiag, setHwDiag] = useState<{
        gps_fix?: boolean;
        op?: string;
        csq?: number;
        uptime_ms?: number;
        connection?: string;
        data_bytes?: number;
        time_synced?: boolean;
        last_updated_str?: string;
        geo_state?: string;
        geo_dist_m?: number;
        theft_state?: string;
        batt_pct?: number;
        batt_v?: number;
        temp?: number;
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
            ? dayjs(firmwareTimestamp).format('ddd, MMM D • h:mm A')
            : hwDiag?.last_updated_str
                ? dayjs(hwDiag.last_updated_str).format('ddd, MMM D • h:mm A')
                : '--',
        address: locationAddress || '--'
    };

    const isPaired = isPairingActive(pairingState);
    const pairedBoxId = pairingState?.box_id;
    // Pairing state is authoritative. Route params can be stale after reassignment/re-pair.
    const boxId = pairedBoxId ?? route?.params?.boxId ?? cachedBoxId ?? DEMO_BOX_ID;
    const routeDeliveryId = route?.params?.deliveryId as string | undefined;

    // Last-resort fallback for dev screens when box has no active delivery.
    const activeDeliveryId = routeDeliveryId || boxState?.delivery_id || 'DEL_001';
    const activeOtpCode = boxState?.otp_code || '';
    const incidentPhaseLabel =
        activeTamperIncident?.status === 'PENDING_REVIEW'
            ? 'Step 2 of 3: Admin review in progress'
            : activeTamperIncident?.status === 'CLOSED'
                ? 'Step 3 of 3: Incident resolved'
                : tamperState?.detected
                    ? 'Step 1 of 3: Rider evidence required'
                    : null;

    // Derive lock state from real data
    const isLocked = boxState?.status === 'LOCKED';
    const commandAckCommand = rawBoxState?.command_ack_command as string | undefined;
    const commandAckStatus = rawBoxState?.command_ack_status as string | undefined;
    const commandAckDetails = rawBoxState?.command_ack_details as string | undefined;
    const lockAwaitingClose = commandAckCommand === 'LOCKED' && commandAckStatus === 'waiting_close';
    const lockAwaitingCloseNeedsAssist = lockAwaitingClose && commandAckDetails === 'reed_open';
    const lockCloseConfirmed = commandAckCommand === 'LOCKED' && commandAckStatus === 'executed' && commandAckDetails === 'reed_closed_confirmed';
    const requiresPinOnlyUnlock = Boolean(adminOverrideState?.active || tamperState?.detected);

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
                    ...(raw.gps_fix !== undefined && { gps_fix: raw.gps_fix }),
                    ...(raw.op !== undefined && { op: raw.op }),
                    ...(raw.csq !== undefined && { csq: raw.csq }),
                    ...(raw.uptime_ms !== undefined && { uptime_ms: raw.uptime_ms }),
                    ...(raw.connection !== undefined && { connection: raw.connection }),
                    ...(raw.data_bytes !== undefined && { data_bytes: raw.data_bytes }),
                    ...(raw.time_synced !== undefined && { time_synced: raw.time_synced }),
                    ...(raw.last_updated_str !== undefined && { last_updated_str: raw.last_updated_str }),
                    // Extended hardware fields
                    ...(raw.geo_state !== undefined && { geo_state: raw.geo_state }),
                    ...(raw.geo_dist_m !== undefined && { geo_dist_m: raw.geo_dist_m }),
                    ...(raw.theft_state !== undefined && { theft_state: raw.theft_state }),
                    ...(raw.batt_v !== undefined && { batt_v: raw.batt_v }),
                    ...(raw.temp !== undefined && { temp: raw.temp }),
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

    const resetUnlockProgress = () => {
        setUnlockProgress(0);
        setUnlockProgressLabel('');
        setShowUnlockProgress(false);
    };

    const loadActiveTamperIncident = async () => {
        if (!tamperState?.detected || !isPaired) {
            setActiveTamperIncident(null);
            return;
        }

        try {
            setIncidentLoading(true);
            const incident = await fetchActiveTamperIncident({
                boxId,
                deliveryId: activeDeliveryId && activeDeliveryId !== 'DEL_001' ? activeDeliveryId : undefined,
            });
            setActiveTamperIncident(incident);
            if (incident?.status !== 'OPEN') {
                setTamperDisposition(null);
                setTamperNote('');
                setTamperPhotoUri(null);
                setTamperPhotoUrl(null);
            }
        } catch (error: any) {
            console.warn('[TamperIncident] Failed to load active incident:', error?.message || error);
        } finally {
            setIncidentLoading(false);
        }
    };

    useEffect(() => {
        loadActiveTamperIncident();
    }, [tamperState?.detected, isPaired, boxId, activeDeliveryId]);

    const incidentResponseRequired = Boolean(
        isPaired
        && tamperState?.detected
        && (incidentLoading || !activeTamperIncident || activeTamperIncident.status === 'OPEN')
    );

    const handleCaptureTamperPhoto = async () => {
        if (!activeTamperIncident?.id) return;

        try {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (permission.status !== 'granted') {
                PremiumAlert.alert('Camera Permission Required', 'Please enable camera permission to submit hardware damage evidence.');
                return;
            }

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.7,
                allowsEditing: false,
            });

            if (result.canceled || !result.assets?.[0]?.uri) return;
            const localUri = result.assets[0].uri;
            setTamperPhotoUri(localUri);

            const upload = await uploadTamperEvidencePhoto({
                incidentId: activeTamperIncident.id,
                boxId: boxId || activeTamperIncident.box_id || 'UNKNOWN_BOX',
                localUri,
            });

            if (!upload.success || !upload.url) {
                PremiumAlert.alert('Upload Failed', upload.error || 'Could not upload tamper evidence photo. Please retry.');
                return;
            }

            setTamperPhotoUrl(upload.url);
            addLog('Tamper evidence photo uploaded', 'info');
        } catch (error: any) {
            PremiumAlert.alert('Capture Failed', error?.message || 'Could not capture tamper evidence photo.');
        }
    };

    const handleSubmitTamperEvidence = async () => {
        if (!activeTamperIncident?.id || !tamperDisposition) {
            PremiumAlert.alert('Required', 'Select a security assessment before submitting.');
            return;
        }

        if (tamperDisposition === 'HARDWARE_DAMAGED' && !tamperPhotoUrl) {
            PremiumAlert.alert('Photo Required', 'Capture and upload a damage photo before continuing.');
            return;
        }

        if (tamperDisposition === 'ACCIDENTAL_TRIGGER' && !tamperNote.trim()) {
            PremiumAlert.alert('Explanation Required', 'Enter a short explanation for accidental trigger.');
            return;
        }

        try {
            setTamperSubmitting(true);
            await submitRiderTamperEvidence(activeTamperIncident.id, {
                riderDisposition: tamperDisposition,
                riderNote: tamperDisposition === 'ACCIDENTAL_TRIGGER' ? tamperNote.trim() : undefined,
                riderPhotoUrl: tamperDisposition === 'HARDWARE_DAMAGED' ? tamperPhotoUrl || undefined : undefined,
            });

            addLog('Tamper incident evidence submitted to admin review', 'success');
            PremiumAlert.alert('Submitted', 'Your security evidence was sent. Await admin review.');

            // Local on-device notification so rider gets immediate confirmation
            // even without depending on remote FCM fanout timing.
            showSecurityNotification(
                'Evidence Submitted',
                'Your incident report was received and is pending admin review.',
                {
                    incidentId: activeTamperIncident.id,
                    boxId,
                    deliveryId: activeDeliveryId,
                    status: 'PENDING_REVIEW',
                    type: 'RIDER_EVIDENCE_SUBMITTED',
                }
            ).catch(() => {});

            setActiveTamperIncident((prev) => prev ? { ...prev, status: 'PENDING_REVIEW' } : prev);
            setTamperDisposition(null);
            setTamperNote('');
            setTamperPhotoUri(null);
            setTamperPhotoUrl(null);
        } catch (error: any) {
            PremiumAlert.alert('Submission Failed', error?.message || 'Could not submit tamper evidence.');
        } finally {
            setTamperSubmitting(false);
        }
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

        const openUnlockPinModal = () => {
            setUnlockPin('');
            setShowUnlockPin(false);
            setShowUnlockPinModal(true);
            resetUnlockProgress();
        };

        if (isLocked) {
            if (requiresPinOnlyUnlock) {
                addLog('High-risk state active. Personal PIN required for unlock.', 'warning');
                openUnlockPinModal();
                return;
            }

            try {
                const actionType = 'UNLOCK_COMMAND';
                if (!shouldUseOptimisticUi(actionType)) {
                    addLog(`Critical action (${getActionCriticality(actionType)}): waiting for command acknowledgment.`, 'info');
                }
                setManualOverrideSending(true);
                setShowUnlockProgress(true);
                setUnlockProgress(0.2);
                setUnlockProgressLabel('Verifying biometric...');
                const biometricResult = await authenticateBiometricForUnlock();

                if (!biometricResult.success) {
                    addLog(`Biometric unavailable/failed: ${biometricResult.reason}`, 'warning');
                    openUnlockPinModal();
                    return;
                }

                setUnlockProgress(0.55);
                setUnlockProgressLabel('Authorizing unlock...');
                const { unlockToken } = await verifyRiderBiometricForUnlock(boxId, biometricResult.method);

                setUnlockProgress(0.85);
                setUnlockProgressLabel('Sending command to box...');
                await sendRiderUnlockCommand(boxId, unlockToken);

                setUnlockProgress(1);
                setUnlockProgressLabel('Command sent. Waiting for box acknowledgment...');

                addLog(`Manual override queued (biometric): UNLOCKING -> ${boxId}`, 'success');
                PremiumAlert.alert(
                    'Unlock Command Queued',
                    `Unlock command queued for ${boxId}. Waiting for hardware acknowledgment.`
                );
                setTimeout(() => {
                    resetUnlockProgress();
                }, 1200);
                return;
            } catch (error: any) {
                console.error('[toggleLock] Biometric unlock failed:', error);
                addLog('Biometric unlock failed. Falling back to Personal PIN.', 'warning');
                if (error?.message) {
                    PremiumAlert.alert('Biometric Unlock Unavailable', `${error.message}\n\nUse your Personal PIN to continue.`);
                }
                openUnlockPinModal();
                return;
            } finally {
                setManualOverrideSending(false);
            }

            return;
        }

        const action = "LOCKED";
        const requestId = `manual_${Date.now()}`;

        // EC-FIX: Send command to Firebase instead of local toggle
        try {
            const actionType = 'LOCK_COMMAND';
            if (!shouldUseOptimisticUi(actionType)) {
                addLog(`Critical action (${getActionCriticality(actionType)}): lock command requires explicit confirmation.`, 'info');
            }
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
                `Lock command queued for ${boxId}. If the lid remains open, lock confirmation will wait until reed-close is detected.`
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
            const actionType = 'UNLOCK_COMMAND';
            if (!shouldUseOptimisticUi(actionType)) {
                addLog(`Critical action (${getActionCriticality(actionType)}): waiting for command acknowledgment.`, 'info');
            }
            setUnlockPinSubmitting(true);
            setManualOverrideSending(true);
            setShowUnlockProgress(true);
            setUnlockProgress(0.55);
            setUnlockProgressLabel('Authorizing Personal PIN...');

            const { unlockToken } = await verifyRiderPersonalPinForUnlock(boxId, sanitizedPin);

            setUnlockProgress(0.85);
            setUnlockProgressLabel('Sending command to box...');
            await sendRiderUnlockCommand(boxId, unlockToken);

            setUnlockProgress(1);
            setUnlockProgressLabel('Command sent. Waiting for box acknowledgment...');

            addLog(`Manual override queued: UNLOCKING -> ${boxId}`, 'info');
            setShowUnlockPinModal(false);
            setUnlockPin('');

            PremiumAlert.alert(
                'Unlock Command Queued',
                `Unlock command queued for ${boxId}. Waiting for hardware acknowledgment.`
            );
            setTimeout(() => {
                resetUnlockProgress();
            }, 1200);
        } catch (error: any) {
            console.error('[handleSubmitUnlockWithPin] Unlock failed:', error);
            addLog('Manual unlock failed: PIN verification or authorization error', 'error');
            PremiumAlert.alert('Unlock Failed', error?.message || 'Could not authorize unlock.');
            resetUnlockProgress();
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
                    text: "Force Open",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            const actionType = 'EMERGENCY_UNLOCK_COMMAND';
                            if (!shouldUseOptimisticUi(actionType)) {
                                addLog(`Critical action (${getActionCriticality(actionType)}): emergency command uses explicit pending state.`, 'warning');
                            }
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
                    text: "Report Stolen",
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

    const TelemetryItem = ({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) => (
        <View style={styles.telemetryRow}>
            <View style={[styles.telemetryIconPill, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                <MaterialCommunityIcons name={icon as any} size={18} color={color} />
            </View>
            <Text style={[styles.telemetryLabel, { color: c.textSec }]}>{label}</Text>
            <Text style={[styles.telemetryValue, { color: c.text }]}>{value}</Text>
        </View>
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

        const authResult = await authenticateBiometricForSensitiveAction('Authorize Personal PIN change');
        if (!authResult.success) {
            PremiumAlert.alert('Authorization Required', `${authResult.message} PIN change was canceled.`);
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
                            const authResult = await authenticateBiometricForSensitiveAction('Authorize Personal PIN reset');
                            if (!authResult.success) {
                                PremiumAlert.alert('Authorization Required', `${authResult.message} PIN reset was canceled.`);
                                return;
                            }

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
                            <Text style={[styles.alertText, { color: c.textSec }]}>
                                {activeTamperIncident?.status === 'PENDING_REVIEW'
                                    ? 'Evidence submitted. Awaiting admin review.'
                                    : 'Box in Security Hold. Submit required rider evidence.'}
                            </Text>
                            {incidentPhaseLabel && (
                                <Text style={[styles.alertText, { color: c.textSec, marginTop: 4 }]}>{incidentPhaseLabel}</Text>
                            )}
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

                {/* ── Status Hero ── */}
                <View style={[styles.heroSection, { backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]}>
                    <View style={[styles.heroIconRing, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
                        <MaterialCommunityIcons
                            name={!isPaired ? "link-variant-off" : (isLocked ? "shield-check" : "shield-alert")}
                            size={28}
                            color={!isPaired ? c.textTer : (isLocked ? c.greenText : c.redText)}
                        />
                    </View>
                    <View style={{ marginLeft: 16, flex: 1 }}>
                        <Text style={[styles.heroTitle, { color: c.text }]}>
                            {!isPaired ? "No Box Connected" : (isLocked ? "System Secure" : "System Unlocked")}
                        </Text>
                        <Text style={[styles.heroSubtitle, { color: !isPaired ? c.textTer : (isLocked ? c.greenText : c.redText) }]}>
                            {!isPaired ? "Pair to view status" : (isLocked ? "Lock Engaged" : "Lock Disengaged")}
                        </Text>
                    </View>
                    <View style={[styles.heroBadge, { backgroundColor: !isPaired ? c.search : (isLocked ? c.greenBg : c.redBg) }]}>
                        <View style={[styles.heroDot, { backgroundColor: !isPaired ? c.textTer : (isLocked ? c.greenText : c.redText) }]} />
                    </View>
                </View>

                {/* ── Live Telemetry ── */}
                <Text style={[styles.sectionTitle, { color: c.text }]}>Live Telemetry</Text>
                <View style={[styles.telemetryCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]}>
                    <TelemetryItem
                        icon={isPaired ? getBatteryIcon() : "battery-unknown"}
                        label="Battery"
                        value={isPaired ? (batteryState ? `${batteryState.percentage}%` : '--') : '--%'}
                        color={isPaired ? getBatteryColor() : c.textTer}
                    />
                    <TelemetryItem
                        icon={isPaired ? (hwDiag?.gps_fix ? 'satellite-variant' : 'crosshairs-question') : 'crosshairs-gps'}
                        label="GPS"
                        value={isPaired ? telemetry.gps : '--'}
                        color={isPaired ? (hwDiag?.gps_fix ? c.greenText : c.redText) : c.textTer}
                    />
                    <TelemetryItem
                        icon={isPaired ? (hasValidRssi(boxState?.rssi) && boxState!.rssi! >= -85 ? 'signal-4g' : 'signal') : 'signal-off'}
                        label="LTE"
                        value={isPaired ? telemetry.signal : '-- dBm'}
                        color={isPaired ? (hasValidRssi(boxState?.rssi) && boxState!.rssi! >= -85 ? c.greenText : c.orangeText) : c.textTer}
                    />
                    <TelemetryItem
                        icon="sync"
                        label="Sync"
                        value={isPaired ? telemetry.sync : '--'}
                        color={isPaired ? c.purpleText : c.textTer}
                    />
                    {isPaired && telemetry.address !== '--' && (
                        <>
                            <View style={[styles.thinDivider, { backgroundColor: c.divider }]} />
                            <View style={styles.telemetryRow}>
                                <View style={[styles.telemetryIconPill, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                                    <MaterialCommunityIcons name="map-marker-outline" size={18} color={c.textSec} />
                                </View>
                                <Text style={[styles.telemetryLabel, { color: c.textSec }]}>Location</Text>
                                <Text style={[styles.telemetryValue, { color: c.text, flex: 1, textAlign: 'right' }]} numberOfLines={1}>{telemetry.address}</Text>
                            </View>
                        </>
                    )}
                </View>

                {/* ── Controls ── */}
                <Text style={[styles.sectionTitle, { color: c.text }]}>Controls</Text>

                {/* Lock Override */}
                <View style={[styles.minCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]}>
                    <Text style={[styles.minCardLabel, { color: c.textTer }]}>Manual Override</Text>
                    <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={toggleLock}
                        disabled={!isPaired || manualOverrideSending || boxState?.status === 'UNLOCKING'}
                        style={[styles.lockButton, {
                            backgroundColor: !isPaired ? c.search : (isLocked ? c.accent : c.redText),
                            opacity: (!isPaired || manualOverrideSending || boxState?.status === 'UNLOCKING') ? 0.5 : 1,
                        }]}
                    >
                        {(manualOverrideSending || boxState?.status === 'UNLOCKING') ? (
                            <ActivityIndicator size={18} color={c.accentText} />
                        ) : (
                            <MaterialCommunityIcons name={isLocked ? "lock" : "lock-open"} size={18} color={!isPaired ? c.textTer : c.accentText} />
                        )}
                        <Text style={[styles.lockButtonText, { color: !isPaired ? c.textTer : c.accentText }]}>
                            {isPaired ? (boxState?.status === 'UNLOCKING' ? "Actuating…" : (isLocked ? "Unlock Box" : "Lock Box")) : "Pair Required"}
                        </Text>
                    </TouchableOpacity>

                    {showUnlockProgress && isLocked && (
                        <View style={{ marginTop: 10 }}>
                            <Text style={{ fontSize: 12, color: c.textSec, marginBottom: 6 }}>
                                {unlockProgressLabel || 'Processing unlock...'}
                            </Text>
                            <Progress.Bar
                                progress={unlockProgress}
                                color={c.accent}
                                unfilledColor={c.search}
                                borderWidth={0}
                                borderRadius={6}
                                height={8}
                                width={null}
                            />
                        </View>
                    )}

                    {lockAwaitingClose && (
                        <View style={[styles.inlineNotice, { backgroundColor: c.orangeBg, borderColor: c.orangeText }]}>
                            <Text style={{ color: c.orangeText, fontFamily: 'Inter_700Bold', fontSize: 13 }}>
                                Lock pending physical close
                            </Text>
                            <Text style={{ marginTop: 2, color: c.orangeText, fontSize: 11 }}>
                                {lockAwaitingCloseNeedsAssist
                                    ? 'Close the lid fully. Press # on keypad for retract assist.'
                                    : 'Close the lid so the reed switch can confirm.'}
                            </Text>
                        </View>
                    )}

                    {lockCloseConfirmed && (
                        <View style={[styles.inlineNotice, { backgroundColor: c.greenBg, borderColor: c.greenText }]}>
                            <Text style={{ color: c.greenText, fontFamily: 'Inter_700Bold', fontSize: 13 }}>Lock confirmed</Text>
                            <Text style={{ marginTop: 2, color: c.greenText, fontSize: 11 }}>Reed close confirmed. Physically secured.</Text>
                        </View>
                    )}
                </View>

                {/* Personal PIN */}
                <View style={[styles.minCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]}>
                    <Text style={[styles.minCardLabel, { color: c.textTer }]}>Personal PIN</Text>
                    <View style={styles.diagRow}>
                        <View style={[styles.iconContainer, {
                            backgroundColor: c.search,
                            opacity: !isPaired ? 0.5 : 1
                        }]}>
                            <MaterialCommunityIcons
                                name="form-textbox-password"
                                size={18}
                                color={c.textSec}
                            />
                        </View>
                        <View style={styles.diagInfo}>
                            <Text style={[styles.diagTitle, { color: !isPaired ? c.textTer : c.text }]}>
                                {personalPinStatus?.enabled ? 'PIN Active' : 'No PIN Set'}
                            </Text>
                            <Text style={{ fontSize: 12, color: c.textSec }}>
                                {personalPinLoading ? 'Loading…' : 'Never shown after saving'}
                            </Text>
                        </View>
                        <View style={[styles.diagBadge, { backgroundColor: c.search }]}>
                            <Text style={[styles.diagBadgeText, { color: c.text }]}>
                                {personalPinStatus?.enabled ? 'SET' : 'OFF'}
                            </Text>
                        </View>
                    </View>
                    <View style={[styles.row, { gap: 8 }]}>
                        <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={handleOpenPersonalPinModal}
                            disabled={!isPaired || personalPinLoading}
                            style={[styles.pillBtn, { backgroundColor: c.accent, flex: 1, opacity: (!isPaired || personalPinLoading) ? 0.3 : 1 }]}
                        >
                            <MaterialCommunityIcons name="shield-edit" size={15} color={c.accentText} />
                            <Text style={[styles.pillBtnText, { color: c.accentText }]}>{personalPinStatus?.enabled ? 'Change' : 'Set PIN'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={handleForgotPersonalPin}
                            disabled={!isPaired || personalPinLoading}
                            style={[styles.pillBtn, { backgroundColor: c.search, flex: 1, opacity: (!isPaired || personalPinLoading) ? 0.3 : 1 }]}
                        >
                            <MaterialCommunityIcons name="help-circle-outline" size={15} color={c.textSec} />
                            <Text style={[styles.pillBtnText, { color: c.textSec }]}>Forgot</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* System Actions */}
                <View style={[styles.minCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]}>
                    <Text style={[styles.minCardLabel, { color: c.textTer }]}>System</Text>

                    {/* Reboot & Emergency row */}
                    <View style={[styles.row, { gap: 8 }]}>
                        <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={handleReboot}
                            disabled={!isPaired || rebooting}
                            style={[styles.pillBtn, { flex: 1, backgroundColor: c.search, opacity: (!isPaired || rebooting) ? 0.3 : 1 }]}
                        >
                            {rebooting ? <ActivityIndicator size={14} color={c.text} /> : <MaterialCommunityIcons name="restart" size={15} color={c.text} />}
                            <Text style={[styles.pillBtnText, { color: c.text }]}>Reboot</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            activeOpacity={0.7}
                            onLongPress={handleEmergencyOpen}
                            delayLongPress={1000}
                            disabled={!isPaired}
                            onPress={() => PremiumAlert.alert('Long Press Required', 'Hold for 1s to force open.')}
                            style={[styles.pillBtn, { flex: 1, backgroundColor: c.search, opacity: !isPaired ? 0.3 : 1 }]}
                        >
                            <MaterialCommunityIcons name="alert-outline" size={15} color={c.text} />
                            <Text style={[styles.pillBtnText, { color: c.text }]}>Emergency</Text>
                        </TouchableOpacity>
                    </View>
                    <Text style={[styles.hintText, { color: c.textTer }]}>Hold "Emergency" 1s to force open</Text>

                    {/* Report Stolen — separated with divider for gravity */}
                    <View style={{ height: 1, backgroundColor: c.divider, marginTop: 14, marginBottom: 12 }} />
                    <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={handleReportStolen}
                        disabled={!isPaired}
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            paddingVertical: 12,
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: !isPaired ? c.border : c.redText,
                            gap: 6,
                            opacity: !isPaired ? 0.3 : 1,
                        }}
                    >
                        <MaterialCommunityIcons name="shield-alert-outline" size={15} color={!isPaired ? c.textTer : c.redText} />
                        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: !isPaired ? c.textTer : c.redText }}>Report Stolen</Text>
                    </TouchableOpacity>
                </View>

                {/* ── Diagnostics ── */}
                <Text style={[styles.sectionTitle, { color: c.text }]}>Diagnostics</Text>

                {/* Network & Location */}
                <View style={[styles.minCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]}>
                    <Text style={[styles.minCardLabel, { color: c.textTer }]}>Network & Location</Text>
                        
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, { backgroundColor: c.search }]}>
                                <MaterialCommunityIcons name="antenna" size={20} color={c.textSec} />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text style={[styles.diagTitle, { color: c.text }]}>Connectivity</Text>
                                <Text style={{ fontSize: 12, color: c.textSec }}>
                                    {isPaired
                                        ? `${hwDiag?.connection || 'LTE'} • ${hwDiag?.op || 'Unknown'} (CSQ: ${hwDiag?.csq ?? '--'}/31)`
                                        : 'Requires pairing'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, { backgroundColor: c.search }]}>
                                <Text style={[styles.diagBadgeText, { color: c.text }]}>
                                    {isPaired ? getRssiQuality(boxState?.rssi) : '--'}
                                </Text>
                            </View>
                        </View>
                        
                        <Divider style={[styles.divider, { backgroundColor: c.divider }]} />
                        
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, { backgroundColor: c.search }]}>
                                <MaterialCommunityIcons name="satellite-uplink" size={20} color={c.textSec} />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text style={[styles.diagTitle, { color: c.text }]}>GNSS</Text>
                                <Text style={{ fontSize: 12, color: c.textSec }}>
                                    {isPaired
                                        ? (locationData ? `${locationData.latitude?.toFixed(5)}, ${locationData.longitude?.toFixed(5)}` : (hwDiag?.gps_fix ? 'Fix acquired, fetching' : 'Searching for satellites'))
                                        : 'Requires pairing'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, { backgroundColor: c.search }]}>
                                <Text style={[styles.diagBadgeText, { color: c.text }]}>
                                    {isPaired ? (hwDiag?.gps_fix ? 'FIXED' : 'SEARCH') : '--'}
                                </Text>
                            </View>
                        </View>
                        
                        <Divider style={[styles.divider, { backgroundColor: c.divider }]} />

                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, { backgroundColor: c.search }]}>
                                <MaterialCommunityIcons name="map-marker-radius" size={20} color={c.textSec} />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text style={[styles.diagTitle, { color: c.text }]}>Geofence</Text>
                                <Text style={{ fontSize: 12, color: c.textSec }}>
                                    {isPaired 
                                        ? (hwDiag?.geo_dist_m != null ? `${hwDiag.geo_dist_m.toFixed(1)}m from dropoff` : 'Distance to target unknown')
                                        : 'Requires pairing'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, { backgroundColor: c.search }]}>
                                <Text style={[styles.diagBadgeText, { color: c.text }]}>
                                    {isPaired ? (hwDiag?.geo_state || 'OUTSIDE') : '--'}
                                </Text>
                            </View>
                        </View>
                </View>

                {/* Security & Access */}
                <View style={[styles.minCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]}>
                    <Text style={[styles.minCardLabel, { color: c.textTer }]}>Security & Access</Text>
                        
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, { backgroundColor: c.search }]}>
                                <MaterialCommunityIcons name="shield-lock-outline" size={20} color={hwDiag?.theft_state !== 'NORMAL' && hwDiag?.theft_state != null ? c.redText : c.textSec} />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text style={[styles.diagTitle, { color: c.text }]}>Theft Guard</Text>
                                <Text style={{ fontSize: 12, color: c.textSec }}>
                                    {isPaired 
                                        ? (hwDiag?.theft_state === 'NORMAL' || hwDiag?.theft_state == null ? 'Motion sensors idle' : 'Unusual motion detected')
                                        : 'Requires pairing'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, { backgroundColor: hwDiag?.theft_state !== 'NORMAL' && hwDiag?.theft_state != null ? c.redBg : c.search }]}>
                                <Text style={[styles.diagBadgeText, { color: hwDiag?.theft_state !== 'NORMAL' && hwDiag?.theft_state != null ? c.redText : c.text }]}>
                                    {isPaired ? (hwDiag?.theft_state || 'NORMAL') : '--'}
                                </Text>
                            </View>
                        </View>

                        <Divider style={[styles.divider, { backgroundColor: c.divider }]} />
                        
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, { backgroundColor: c.search }]}>
                                <MaterialCommunityIcons name="camera-iris" size={20} color={c.textSec} />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text style={[styles.diagTitle, { color: c.text }]}>Biometric</Text>
                                <Text style={{ fontSize: 12, color: c.textSec }}>
                                    {faceAuthStatus === 'SEARCHING' ? 'Scan running…' 
                                        : faceAuthStatus === 'AUTHENTICATED' ? 'Person verified'
                                        : faceAuthStatus === 'TIMEOUT_REMOVE_HELMET' ? 'Blocked — helmet'
                                        : faceAuthStatus === 'FAILED_USE_OTP' ? 'Fallback to OTP'
                                        : 'Ready'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, { backgroundColor: c.search }]}>
                                <Text style={[styles.diagBadgeText, { color: c.text }]}>
                                    {faceAuthStatus === 'IDLE' ? 'READY' : faceAuthStatus}
                                </Text>
                            </View>
                        </View>

                        <Divider style={[styles.divider, { backgroundColor: c.divider }]} />
                        
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, { backgroundColor: c.search }]}>
                                <MaterialCommunityIcons name="dialpad" size={20} color={lockoutState?.active ? c.redText : c.textSec} />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text style={[styles.diagTitle, { color: c.text }]}>Keypad</Text>
                                <Text style={{ fontSize: 12, color: c.textSec }}>
                                    {lockoutState?.active 
                                        ? `LOCKOUT: ${lockoutState.attempt_count} failed (${lockoutCountdown} left)`
                                        : otpStatus?.otp_expired 
                                            ? 'OTP expired — new code required'
                                            : activeOtpCode 
                                                ? `OTP active (${activeOtpCode.length} digits)`
                                                : 'Awaiting OTP'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, { backgroundColor: lockoutState?.active ? c.redBg : c.search }]}>
                                <Text style={[styles.diagBadgeText, { color: lockoutState?.active ? c.redText : c.text }]}>
                                    {lockoutState?.active ? 'LOCKOUT' : otpStatus?.otp_expired ? 'EXPIRED' : 'READY'}
                                </Text>
                            </View>
                        </View>
                </View>

                {/* Power & Hardware */}
                <View style={[styles.minCard, { backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]}>
                    <Text style={[styles.minCardLabel, { color: c.textTer }]}>Power & Hardware</Text>
                        
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, { backgroundColor: c.search }]}>
                                <MaterialCommunityIcons name="battery-charging-medium" size={20} color={c.textSec} />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text style={[styles.diagTitle, { color: c.text }]}>Battery</Text>
                                <Text style={{ fontSize: 12, color: c.textSec }}>
                                    {isPaired 
                                        ? `${batteryState?.percentage ?? hwDiag?.batt_pct ?? '--'}% remaining`
                                        : 'Requires pairing'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, { backgroundColor: c.search }]}>
                                <Text style={[styles.diagBadgeText, { color: c.text }]}>
                                    {isPaired ? `${(hwDiag?.batt_v ?? batteryState?.voltage ?? 0).toFixed(1)} V` : '--'}
                                </Text>
                            </View>
                        </View>

                        <Divider style={[styles.divider, { backgroundColor: c.divider }]} />
                        
                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, { backgroundColor: c.search }]}>
                                <MaterialCommunityIcons name="lock-smart" size={20} color={lockHealth?.overheated ? c.redText : c.textSec} />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text style={[styles.diagTitle, { color: c.text }]}>Solenoid</Text>
                                <Text style={{ fontSize: 12, color: c.textSec }}>
                                    {lockHealth?.overheated ? 'Thermal cutoff active' : 'Operating normally'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, { backgroundColor: lockHealth?.overheated ? c.redBg : c.search }]}>
                                <Text style={[styles.diagBadgeText, { color: lockHealth?.overheated ? c.redText : c.text }]}>
                                    {lockHealth?.overheated ? 'HOT' : (hwDiag?.temp ? `${hwDiag.temp}°C` : 'OK')}
                                </Text>
                            </View>
                        </View>

                        <Divider style={[styles.divider, { backgroundColor: c.divider }]} />

                        <View style={styles.diagRow}>
                            <View style={[styles.iconContainer, { backgroundColor: c.search }]}>
                                <MaterialCommunityIcons name="cpu-64-bit" size={20} color={c.textSec} />
                            </View>
                            <View style={styles.diagInfo}>
                                <Text style={[styles.diagTitle, { color: c.text }]}>Controller</Text>
                                <Text style={{ fontSize: 12, color: c.textSec }}>
                                    {hwDiag?.uptime_ms 
                                        ? `Up ${Math.floor(hwDiag.uptime_ms / 3600000)}h ${Math.floor((hwDiag.uptime_ms % 3600000) / 60000)}m • NTP ${hwDiag.time_synced ? '✓' : '×'}`
                                        : isPaired ? 'Uptime pending…' : 'Requires pairing'}
                                </Text>
                            </View>
                            <View style={[styles.diagBadge, { backgroundColor: c.search }]}>
                                <Text style={[styles.diagBadgeText, { color: c.text }]}>
                                    {hwDiag?.data_bytes ? `${(hwDiag.data_bytes / 1024).toFixed(1)} KB` : '--'}
                                </Text>
                            </View>
                        </View>
                </View>

                {/* ── Event Log ── */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 8 }}>
                    <Text style={[styles.sectionTitle, { color: c.text, marginTop: 0, marginBottom: 0 }]}>Event Log</Text>
                    {logs.length > 0 && (
                        <View style={{ backgroundColor: c.search, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                            <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: c.textSec }}>{logs.length}</Text>
                        </View>
                    )}
                </View>
                <View style={[styles.logContainer, { backgroundColor: c.card, borderColor: c.border, borderWidth: isDarkMode ? 1 : 0 }]}>
                    {isPaired && logs.length > 0 ? (
                        logs.slice(0, 25).map((log, index) => (
                            <View key={index} style={{
                                flexDirection: 'row',
                                alignItems: 'flex-start',
                                paddingVertical: 7,
                                borderBottomWidth: index < Math.min(logs.length, 25) - 1 ? 1 : 0,
                                borderBottomColor: c.divider,
                            }}>
                                {/* Type dot */}
                                <View style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: 3.5,
                                    marginTop: 4,
                                    marginRight: 8,
                                    backgroundColor: log.type === 'error' ? c.redText
                                        : log.type === 'warning' ? c.textTer
                                        : log.type === 'success' ? c.text
                                        : c.textTer,
                                    opacity: log.type === 'error' ? 1 : 0.5,
                                }} />
                                {/* Content */}
                                <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: c.text, lineHeight: 16 }} numberOfLines={2}>
                                        {log.message}
                                    </Text>
                                </View>
                                {/* Timestamp */}
                                <Text style={{ fontSize: 10, fontFamily: 'monospace', color: c.textTer, marginLeft: 8, marginTop: 1 }}>
                                    {log.time}
                                </Text>
                            </View>
                        ))
                    ) : (
                        <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 32 }}>
                            <MaterialCommunityIcons name="console" size={28} color={c.textTer} style={{ marginBottom: 8, opacity: 0.5 }} />
                            <Text style={{ fontSize: 12, color: c.textTer }}>{isPaired ? 'No events yet' : 'Pair a box to see logs'}</Text>
                        </View>
                    )}
                </View>

            </ScrollView>

            {/* EC-02: BLE Transfer Modal */}
            <Modal
                visible={showBleModal}
                transparent
                animationType="slide"
                onRequestClose={closeBleModal}
            >
                <View style={styles.modalOverlay}>
                    <Surface style={[styles.modalContent, { backgroundColor: c.card }]} elevation={5}>
                        <View style={styles.modalHeader}>
                            <Text variant="titleLarge" style={{ fontFamily: 'Inter_700Bold', color: c.text }}>BLE OTP Transfer</Text>
                            <IconButton
                                icon="close"
                                size={24}
                                iconColor={c.textSec}
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
                visible={incidentResponseRequired}
                transparent
                animationType="fade"
                onRequestClose={() => { }}
            >
                <View style={styles.modalOverlay}>
                    <Surface style={[styles.modalContent, { width: '92%', maxWidth: 520, backgroundColor: c.card }]} elevation={5}>
                        <View style={styles.modalHeader}>
                            <Text variant="titleLarge" style={{ fontFamily: 'Inter_700Bold', color: c.text }}>Security Hold Response Required</Text>
                        </View>
                        <View style={styles.modalBody}>
                            {!activeTamperIncident?.id && (
                                <View style={{ marginBottom: 12, padding: 10, borderRadius: 8, backgroundColor: c.orangeBg }}>
                                    <Text variant="bodySmall" style={{ color: c.orangeText }}>
                                        {incidentLoading
                                            ? 'Syncing incident record... Controls remain blocked for safety.'
                                            : 'Incident record not yet available. Retry sync to continue.'}
                                    </Text>
                                </View>
                            )}

                            <Text variant="bodyMedium" style={{ color: c.textSec, marginBottom: 12 }}>
                                This box is locked due to tamper detection. You must submit evidence before normal controls are restored.
                            </Text>

                            <View style={{ gap: 10, marginBottom: 14 }}>
                                <Button
                                    mode={tamperDisposition === 'HARDWARE_DAMAGED' ? 'contained' : 'outlined'}
                                    onPress={() => setTamperDisposition('HARDWARE_DAMAGED')}
                                >
                                    Hardware Damaged
                                </Button>
                                <Button
                                    mode={tamperDisposition === 'ACCIDENTAL_TRIGGER' ? 'contained' : 'outlined'}
                                    onPress={() => setTamperDisposition('ACCIDENTAL_TRIGGER')}
                                >
                                    Accidental Trigger
                                </Button>
                            </View>

                            {tamperDisposition === 'HARDWARE_DAMAGED' && (
                                <View style={{ gap: 8, marginBottom: 14 }}>
                                    <Button
                                        mode="contained-tonal"
                                        icon="camera"
                                        onPress={handleCaptureTamperPhoto}
                                        disabled={tamperSubmitting || !activeTamperIncident?.id}
                                    >
                                        {tamperPhotoUri ? 'Retake Damage Photo' : 'Capture Damage Photo'}
                                    </Button>
                                    <Text style={{ color: c.textSec, fontSize: 12 }}>
                                        {tamperPhotoUrl ? 'Photo uploaded and ready for submission.' : 'A photo is required for this disposition.'}
                                    </Text>
                                </View>
                            )}

                            {tamperDisposition === 'ACCIDENTAL_TRIGGER' && (
                                <TextInput
                                    mode="outlined"
                                    label="Explanation"
                                    value={tamperNote}
                                    onChangeText={setTamperNote}
                                    multiline
                                    numberOfLines={4}
                                    style={{ marginBottom: 14 }}
                                />
                            )}

                            <Button
                                mode="contained"
                                onPress={handleSubmitTamperEvidence}
                                loading={tamperSubmitting || incidentLoading}
                                disabled={tamperSubmitting || incidentLoading || !activeTamperIncident?.id}
                            >
                                Submit Security Evidence
                            </Button>
                            <Button
                                mode="text"
                                onPress={loadActiveTamperIncident}
                                disabled={tamperSubmitting || incidentLoading}
                            >
                                Refresh Incident Status
                            </Button>
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
                    <View style={[styles.modalContent, { backgroundColor: c.card }]}>
                        {/* Header */}
                        <View style={[styles.modalHeader, { borderBottomColor: c.divider }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                <View style={[styles.iconContainer, { backgroundColor: c.search }]}>
                                    <MaterialCommunityIcons name="shield-key" size={18} color={c.textSec} />
                                </View>
                                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 16, color: c.text }}>Set Personal PIN</Text>
                            </View>
                            <TouchableOpacity onPress={() => setShowPersonalPinModal(false)} hitSlop={12}>
                                <MaterialCommunityIcons name="close" size={22} color={c.textTer} />
                            </TouchableOpacity>
                        </View>

                        {/* Body */}
                        <View style={{ padding: 20 }}>
                            <Text style={{ fontSize: 13, color: c.textSec, marginBottom: 16, lineHeight: 18 }}>
                                This PIN is used on keypad key 4 manual mode. It cannot be viewed after saving.
                            </Text>
                            <TextInput
                                mode="outlined"
                                label="New PIN"
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
                                label="Confirm PIN"
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

                        {/* Footer */}
                        <View style={[styles.modalFooter, { borderTopColor: c.divider, paddingBottom: Math.max(16, insets.bottom + 16), gap: 8 }]}>
                            <TouchableOpacity
                                activeOpacity={0.7}
                                onPress={() => setShowPersonalPinModal(false)}
                                disabled={savingPersonalPin}
                                style={[styles.pillBtn, { flex: 1, backgroundColor: c.search, opacity: savingPersonalPin ? 0.4 : 1 }]}
                            >
                                <Text style={[styles.pillBtnText, { color: c.text }]}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                activeOpacity={0.7}
                                onPress={handleSavePersonalPin}
                                disabled={savingPersonalPin || newPersonalPin.length !== 6 || confirmPersonalPin.length !== 6}
                                style={[styles.pillBtn, { flex: 1, backgroundColor: c.accent, opacity: (savingPersonalPin || newPersonalPin.length !== 6 || confirmPersonalPin.length !== 6) ? 0.3 : 1 }]}
                            >
                                {savingPersonalPin && <ActivityIndicator size={14} color={c.accentText} />}
                                <Text style={[styles.pillBtnText, { color: c.accentText }]}>Save PIN</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            <Modal
                visible={showUnlockPinModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowUnlockPinModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: c.card }]}>
                        {/* Header */}
                        <View style={[styles.modalHeader, { borderBottomColor: c.divider }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                <View style={[styles.iconContainer, { backgroundColor: c.search }]}>
                                    <MaterialCommunityIcons name="lock-open-outline" size={18} color={c.textSec} />
                                </View>
                                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 16, color: c.text }}>Authorize Unlock</Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => setShowUnlockPinModal(false)}
                                disabled={unlockPinSubmitting}
                                hitSlop={12}
                            >
                                <MaterialCommunityIcons name="close" size={22} color={c.textTer} />
                            </TouchableOpacity>
                        </View>

                        {/* Body */}
                        <View style={{ padding: 20 }}>
                            <Text style={{ fontSize: 13, color: c.textSec, marginBottom: 16, lineHeight: 18 }}>
                                Enter your 6-digit Personal PIN to authorize this unlock.
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

                        {/* Footer */}
                        <View style={[styles.modalFooter, { borderTopColor: c.divider, paddingBottom: Math.max(16, insets.bottom + 16), gap: 8 }]}>
                            <TouchableOpacity
                                activeOpacity={0.7}
                                onPress={() => setShowUnlockPinModal(false)}
                                disabled={unlockPinSubmitting}
                                style={[styles.pillBtn, { flex: 1, backgroundColor: c.search, opacity: unlockPinSubmitting ? 0.4 : 1 }]}
                            >
                                <Text style={[styles.pillBtnText, { color: c.text }]}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                activeOpacity={0.7}
                                onPress={handleSubmitUnlockWithPin}
                                disabled={unlockPinSubmitting || unlockPin.length !== 6}
                                style={[styles.pillBtn, { flex: 1, backgroundColor: c.accent, opacity: (unlockPinSubmitting || unlockPin.length !== 6) ? 0.3 : 1 }]}
                            >
                                {unlockPinSubmitting && <ActivityIndicator size={14} color={c.accentText} />}
                                <Text style={[styles.pillBtnText, { color: c.accentText }]}>Authorize</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
    },

    // ── Hero ──
    heroSection: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 14,
        marginBottom: 8,
    },
    heroIconRing: {
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
    },
    heroTitle: {
        fontFamily: 'Inter_700Bold',
        fontSize: 17,
    },
    heroSubtitle: {
        fontSize: 13,
        marginTop: 2,
    },
    heroBadge: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    heroDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },

    // ── Section Title ──
    sectionTitle: {
        fontFamily: 'Inter_700Bold',
        fontSize: 14,
        marginTop: 20,
        marginBottom: 8,
        marginLeft: 2,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.8,
    },

    // ── Telemetry ──
    telemetryCard: {
        borderRadius: 14,
        padding: 12,
        marginBottom: 4,
    },
    telemetryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 4,
    },
    telemetryIconPill: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    telemetryLabel: {
        fontSize: 13,
        marginLeft: 10,
        fontFamily: 'Inter_400Regular',
    },
    telemetryValue: {
        fontSize: 13,
        fontFamily: 'Inter_700Bold',
        marginLeft: 'auto',
    },
    thinDivider: {
        height: 1,
        marginVertical: 4,
        marginHorizontal: 4,
        opacity: 0.5,
    },

    // ── Min Card (Controls / Diagnostics) ──
    minCard: {
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
    },
    minCardLabel: {
        fontFamily: 'Inter_700Bold',
        fontSize: 11,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.6,
        marginBottom: 10,
    },

    // ── Lock Button ──
    lockButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        borderRadius: 12,
        gap: 8,
    },
    lockButtonText: {
        fontFamily: 'Inter_700Bold',
        fontSize: 14,
    },

    // ── Pill Buttons ──
    pillBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        borderRadius: 10,
        gap: 6,
    },
    pillBtnText: {
        fontFamily: 'Inter_600SemiBold',
        fontSize: 13,
    },

    // ── Inline Notice ──
    inlineNotice: {
        marginTop: 10,
        padding: 10,
        borderRadius: 10,
        borderWidth: 1,
    },

    // ── Controls ──
    iconContainer: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
    },
    row: {
        flexDirection: 'row',
        marginTop: 8,
    },
    hintText: {
        fontSize: 10,
        textAlign: 'center',
        marginTop: 6,
    },
    divider: {
        marginVertical: 12,
    },
    button: {
        borderRadius: 10,
    },

    // ── Diagnostics ──
    diagRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
    },
    diagInfo: {
        flex: 1,
        marginLeft: 10,
    },
    diagTitle: {
        fontFamily: 'Inter_700Bold',
        fontSize: 14,
    },
    diagBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        minWidth: 56,
        alignItems: 'center',
    },
    diagBadgeText: {
        fontSize: 10,
        fontFamily: 'Inter_700Bold',
    },

    // ── Event Log ──
    logContainer: {
        borderRadius: 14,
        padding: 14,
        minHeight: 160,
        marginBottom: 16,
    },
    logRow: {
        flexDirection: 'row',
        marginBottom: 4,
        borderBottomWidth: 1,
        paddingBottom: 4,
    },
    logTime: {
        fontFamily: 'monospace',
        fontSize: 10,
        width: 55,
    },
    logMessage: {
        flex: 1,
        fontFamily: 'monospace',
        fontSize: 10,
    },

    // ── Alert Banners ──
    alertBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 14,
        borderRadius: 12,
        marginBottom: 10,
    },
    pairingBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 14,
        borderRadius: 12,
        marginBottom: 10,
    },
    alertTitle: {
        fontFamily: 'Inter_700Bold',
        fontSize: 13,
    },
    alertText: {
        fontSize: 12,
        marginTop: 2,
    },
    warningBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 14,
        borderRadius: 12,
        marginBottom: 10,
    },
    criticalBanner: {},
    warningTitle: {
        fontFamily: 'Inter_700Bold',
        fontSize: 13,
    },
    warningText: {
        fontSize: 12,
    },

    // ── Lockout / Expiry ──
    lockoutCard: {
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        borderLeftWidth: 4,
    },
    lockoutHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    lockoutTitle: {
        fontFamily: 'Inter_700Bold',
        fontSize: 13,
    },
    lockoutText: {
        fontSize: 12,
    },
    resetButton: {
        marginTop: 10,
    },
    expiryCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 14,
        borderRadius: 12,
        marginBottom: 10,
        borderLeftWidth: 4,
    },
    expiryTitle: {
        fontFamily: 'Inter_700Bold',
        fontSize: 13,
    },
    expiryText: {
        fontSize: 12,
    },

    // ── BLE ──
    bleCard: {
        borderRadius: 14,
        marginBottom: 16,
    },
    bleInfo: {
        flexDirection: 'row',
        alignItems: 'center',
    },

    // ── Modals ──
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContent: {
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
        borderBottomColor: 'rgba(150,150,150,0.2)',
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
        fontFamily: 'Inter_700Bold',
        marginBottom: 8,
    },
    bleMessage: {
        textAlign: 'center',
    },
    deviceList: {
        marginTop: 16,
        width: '100%',
    },
    deviceItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
    },
    modalFooter: {
        flexDirection: 'row',
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: 'rgba(150,150,150,0.2)',
    },
});
