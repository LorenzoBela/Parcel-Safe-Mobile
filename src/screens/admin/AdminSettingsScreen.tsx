import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Switch, Text, TextInput } from 'react-native-paper';
import { useAppTheme } from '../../context/ThemeContext';
import { AdminSettings, getAdminSettings, saveAdminSettings } from '../../services/adminApiService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const lightC = {
    bg: '#F3F3F0',
    card: '#FFFFFF',
    border: '#DEDED8',
    text: '#121212',
    textSec: '#64645F',
    accent: '#121212',
    accentText: '#FFFFFF',
    chipBg: '#ECECE8',
    success: '#2E7D32',
    danger: '#D32F2F',
};

const darkC = {
    bg: '#090909',
    card: '#121212',
    border: '#2A2A2A',
    text: '#F4F4F4',
    textSec: '#B2B2B2',
    accent: '#FFFFFF',
    accentText: '#000000',
    chipBg: '#171717',
    success: '#8DD5A0',
    danger: '#FF7C7C',
};

const DEFAULT_SETTINGS: Required<AdminSettings> = {
    maintenance_mode: false,
    max_otp_attempts: 5,
    otp_validity_minutes: 10,
    geofence_radius: 100,
    battery_warning_threshold: 20,
    battery_critical_threshold: 10,
};

function mergeWithDefaults(settings: AdminSettings | null | undefined): Required<AdminSettings> {
    return {
        ...DEFAULT_SETTINGS,
        ...(settings || {}),
    };
}

type NumericSettingKey =
    | 'max_otp_attempts'
    | 'otp_validity_minutes'
    | 'geofence_radius'
    | 'battery_warning_threshold'
    | 'battery_critical_threshold';

function buildNumericDraft(settings: Required<AdminSettings>): Record<NumericSettingKey, string> {
    return {
        max_otp_attempts: String(settings.max_otp_attempts),
        otp_validity_minutes: String(settings.otp_validity_minutes),
        geofence_radius: String(settings.geofence_radius),
        battery_warning_threshold: String(settings.battery_warning_threshold),
        battery_critical_threshold: String(settings.battery_critical_threshold),
    };
}

export default function AdminSettingsScreen() {
    const { isDarkMode } = useAppTheme();
    const insets = useSafeAreaInsets();
    const c = isDarkMode ? darkC : lightC;
    const headerTopPadding = Math.max(insets.top + 8, 18);

    const [settings, setSettings] = useState<Required<AdminSettings>>(DEFAULT_SETTINGS);
    const [numericDraft, setNumericDraft] = useState<Record<NumericSettingKey, string>>(
        buildNumericDraft(DEFAULT_SETTINGS),
    );
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const loadSettings = useCallback(async () => {
        setError(null);
        const data = await getAdminSettings();
        const merged = mergeWithDefaults(data);
        setSettings(merged);
        setNumericDraft(buildNumericDraft(merged));
    }, []);

    useEffect(() => {
        let mounted = true;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await getAdminSettings();
                if (mounted) {
                    const merged = mergeWithDefaults(data);
                    setSettings(merged);
                    setNumericDraft(buildNumericDraft(merged));
                }
            } catch (e: any) {
                if (mounted) setError(e?.message || 'Failed to load settings');
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, [loadSettings]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await loadSettings();
        } catch (e: any) {
            setError(e?.message || 'Failed to load settings');
        } finally {
            setRefreshing(false);
        }
    }, [loadSettings]);

    const updateNumber = (key: NumericSettingKey, value: string) => {
        setError(null);
        setNotice(null);
        setNumericDraft((prev) => ({
            ...prev,
            [key]: value,
        }));
    };

    const summary = useMemo(() => {
        const otpValue = numericDraft.max_otp_attempts.trim();
        const radiusValue = numericDraft.geofence_radius.trim();

        return {
            maintenance: settings.maintenance_mode ? 'ON' : 'OFF',
            otp: otpValue === '' ? '--' : otpValue,
            radius: radiusValue === '' ? '--' : `${radiusValue} m`,
        };
    }, [numericDraft, settings.maintenance_mode]);

    const onSave = async () => {
        const parseRequiredNumber = (rawValue: string, label: string, min: number, max?: number) => {
            const value = rawValue.trim();
            if (value === '') {
                setError(`${label} is required.`);
                return null;
            }

            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < min || (typeof max === 'number' && parsed > max)) {
                if (typeof max === 'number') {
                    setError(`${label} must be between ${min} and ${max}.`);
                } else {
                    setError(`${label} must be ${min} or higher.`);
                }
                return null;
            }

            return Math.round(parsed);
        };

        const maxOtpAttempts = parseRequiredNumber(numericDraft.max_otp_attempts, 'Max OTP Attempts', 1);
        if (maxOtpAttempts === null) return;

        const otpValidityMinutes = parseRequiredNumber(numericDraft.otp_validity_minutes, 'OTP Validity', 1);
        if (otpValidityMinutes === null) return;

        const geofenceRadius = parseRequiredNumber(numericDraft.geofence_radius, 'Geofence Radius', 1);
        if (geofenceRadius === null) return;

        const batteryWarning = parseRequiredNumber(
            numericDraft.battery_warning_threshold,
            'Battery Warning Threshold',
            0,
            100,
        );
        if (batteryWarning === null) return;

        const batteryCritical = parseRequiredNumber(
            numericDraft.battery_critical_threshold,
            'Battery Critical Threshold',
            0,
            100,
        );
        if (batteryCritical === null) return;

        if (batteryCritical >= batteryWarning) {
            setError('Battery Critical Threshold should stay lower than Battery Warning Threshold.');
            return;
        }

        const payload: AdminSettings = {
            maintenance_mode: settings.maintenance_mode,
            max_otp_attempts: maxOtpAttempts,
            otp_validity_minutes: otpValidityMinutes,
            geofence_radius: geofenceRadius,
            battery_warning_threshold: batteryWarning,
            battery_critical_threshold: batteryCritical,
        };

        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            await saveAdminSettings(payload);
            const merged = mergeWithDefaults(payload);
            setSettings(merged);
            setNumericDraft(buildNumericDraft(merged));
            setNotice('Settings updated successfully.');
        } catch (e: any) {
            setError(e?.message || 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}> 
            <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.border, paddingTop: headerTopPadding }]}> 
                <Text style={[styles.title, { color: c.text }]}>Admin Settings</Text>
                <Text style={[styles.subtitle, { color: c.textSec }]}>System controls and thresholds.</Text>
            </View>

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator color={c.accent} />
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={styles.content}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
                >
                    <View style={styles.summaryRow}>
                        <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
                            <Text style={[styles.summaryLabel, { color: c.textSec }]}>MAINTENANCE</Text>
                            <Text style={[styles.summaryValue, { color: c.text }]}>{summary.maintenance}</Text>
                        </View>

                        <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
                            <Text style={[styles.summaryLabel, { color: c.textSec }]}>MAX OTP</Text>
                            <Text style={[styles.summaryValue, { color: c.text }]}>{summary.otp}</Text>
                        </View>

                        <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
                            <Text style={[styles.summaryLabel, { color: c.textSec }]}>GEOFENCE</Text>
                            <Text style={[styles.summaryValue, { color: c.text }]}>{summary.radius}</Text>
                        </View>
                    </View>

                    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                        <Text style={[styles.sectionTitle, { color: c.text }]}>Operations</Text>
                        <View style={styles.switchRow}>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.fieldLabel, { color: c.text }]}>Maintenance Mode</Text>
                                <Text style={[styles.help, { color: c.textSec }]}>Temporarily disables operational workflows.</Text>
                            </View>
                            <Switch
                                value={Boolean(settings.maintenance_mode)}
                                onValueChange={(v) => {
                                    setError(null);
                                    setNotice(null);
                                    setSettings((prev) => ({ ...prev, maintenance_mode: v }));
                                }}
                                color={c.accent}
                            />
                        </View>
                    </View>

                    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                        <Text style={[styles.sectionTitle, { color: c.text }]}>OTP Security</Text>

                        <TextInput
                            mode="outlined"
                            label="Max OTP Attempts"
                            keyboardType="numeric"
                            value={numericDraft.max_otp_attempts}
                            onChangeText={(v) => updateNumber('max_otp_attempts', v)}
                            style={styles.input}
                        />
                        <TextInput
                            mode="outlined"
                            label="OTP Validity (minutes)"
                            keyboardType="numeric"
                            value={numericDraft.otp_validity_minutes}
                            onChangeText={(v) => updateNumber('otp_validity_minutes', v)}
                            style={styles.input}
                        />
                    </View>

                    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                        <Text style={[styles.sectionTitle, { color: c.text }]}>Geo & Battery</Text>

                        <TextInput
                            mode="outlined"
                            label="Geofence Radius (meters)"
                            keyboardType="numeric"
                            value={numericDraft.geofence_radius}
                            onChangeText={(v) => updateNumber('geofence_radius', v)}
                            style={styles.input}
                        />
                        <TextInput
                            mode="outlined"
                            label="Battery Warning Threshold (%)"
                            keyboardType="numeric"
                            value={numericDraft.battery_warning_threshold}
                            onChangeText={(v) => updateNumber('battery_warning_threshold', v)}
                            style={styles.input}
                        />
                        <TextInput
                            mode="outlined"
                            label="Battery Critical Threshold (%)"
                            keyboardType="numeric"
                            value={numericDraft.battery_critical_threshold}
                            onChangeText={(v) => updateNumber('battery_critical_threshold', v)}
                            style={styles.input}
                        />

                        <View style={[styles.infoStrip, { backgroundColor: c.chipBg, borderColor: c.border }]}> 
                            <Text style={[styles.infoStripText, { color: c.textSec }]}>Critical threshold should stay lower than warning threshold.</Text>
                        </View>

                        {error ? <Text style={styles.error}>{error}</Text> : null}
                        {notice ? <Text style={[styles.notice, { color: c.success }]}>{notice}</Text> : null}

                        <Button
                            mode="contained"
                            onPress={onSave}
                            loading={saving}
                            disabled={saving}
                            buttonColor={c.accent}
                            textColor={c.accentText}
                        >
                            Save Settings
                        </Button>
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        paddingTop: 18,
        paddingHorizontal: 16,
        paddingBottom: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    title: { fontSize: 24, fontFamily: 'Inter_700Bold' },
    subtitle: { marginTop: 4, fontSize: 13, fontFamily: 'Inter_500Medium' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { padding: 14, paddingBottom: 30 },
    summaryRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 8,
    },
    summaryCard: {
        flex: 1,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 10,
    },
    summaryLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: 0.4,
    },
    summaryValue: {
        marginTop: 4,
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    card: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        padding: 12,
        marginBottom: 10,
    },
    sectionTitle: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
        marginBottom: 8,
    },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    fieldLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
    help: { fontSize: 12, marginTop: 2 },
    input: { marginBottom: 8 },
    infoStrip: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 9,
        marginTop: 2,
        marginBottom: 10,
    },
    infoStripText: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    error: {
        color: '#D32F2F',
        marginBottom: 10,
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    notice: {
        marginBottom: 10,
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
});
