import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Switch, Text, TextInput } from 'react-native-paper';
import { useAppTheme } from '../../context/ThemeContext';
import { AdminSettings, getAdminSettings, saveAdminSettings } from '../../services/adminApiService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const lightC = {
    bg: '#F3F3F0',
    card: '#FFFFFF',
    surfaceSoft: '#F8F8F5',
    border: '#DEDED8',
    text: '#121212',
    textSec: '#64645F',
    accent: '#121212',
    accentText: '#FFFFFF',
    inputBg: '#FBFBF9',
    inputBorder: '#D7D7D1',
    inputActive: '#121212',
    inputMuted: '#8A8A84',
    shadow: '#000000',
    chipBg: '#ECECE8',
    success: '#2E7D32',
    danger: '#D32F2F',
};

const darkC = {
    bg: '#090909',
    card: '#121212',
    surfaceSoft: '#171717',
    border: '#2A2A2A',
    text: '#F4F4F4',
    textSec: '#B2B2B2',
    accent: '#FFFFFF',
    accentText: '#000000',
    inputBg: '#151515',
    inputBorder: '#2C2C2C',
    inputActive: '#F4F4F4',
    inputMuted: '#878787',
    shadow: '#000000',
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
    const [activeInput, setActiveInput] = useState<NumericSettingKey | null>(null);
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

    const renderNumericField = (
        key: NumericSettingKey,
        label: string,
        hint: string,
        unit?: string,
    ) => {
        const isFocused = activeInput === key;

        return (
            <View
                style={[
                    styles.inputShell,
                    {
                        backgroundColor: c.inputBg,
                        borderColor: isFocused ? c.inputActive : c.inputBorder,
                        shadowColor: c.shadow,
                    },
                ]}
            >
                <View style={styles.inputTopRow}>
                    <Text style={[styles.inputMeta, { color: c.textSec }]}>{label}</Text>
                </View>

                <TextInput
                    mode="outlined"
                    dense
                    keyboardType="numeric"
                    value={numericDraft[key]}
                    onFocus={() => setActiveInput(key)}
                    onBlur={() => setActiveInput((prev) => (prev === key ? null : prev))}
                    onChangeText={(v) => updateNumber(key, v)}
                    placeholder="Type a number"
                    placeholderTextColor={c.inputMuted}
                    style={[styles.premiumInput, { backgroundColor: c.inputBg }]}
                    contentStyle={styles.premiumInputContent}
                    outlineColor="transparent"
                    activeOutlineColor="transparent"
                    textColor={c.text}
                    selectionColor={c.accent}
                    theme={{
                        roundness: 14,
                        colors: {
                            background: c.inputBg,
                            onSurfaceVariant: c.inputMuted,
                            primary: c.inputActive,
                        },
                    }}
                    right={
                        unit ? <TextInput.Affix text={unit} textStyle={styles.inputAffix} /> : undefined
                    }
                />

                <Text style={[styles.inputHint, { color: c.textSec }]}>{hint}</Text>
            </View>
        );
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
                            <Text numberOfLines={1} style={[styles.summaryLabel, { color: c.textSec }]}>MAINT.</Text>
                            <Text style={[styles.summaryValue, { color: c.text }]}>{summary.maintenance}</Text>
                        </View>

                        <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
                            <Text numberOfLines={1} style={[styles.summaryLabel, { color: c.textSec }]}>MAX OTP</Text>
                            <Text style={[styles.summaryValue, { color: c.text }]}>{summary.otp}</Text>
                        </View>

                        <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
                            <Text numberOfLines={1} style={[styles.summaryLabel, { color: c.textSec }]}>GEOFENCE</Text>
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

                        {renderNumericField(
                            'max_otp_attempts',
                            'Max OTP Attempts',
                            'Maximum retries before lockout is enforced.',
                            'tries',
                        )}
                        {renderNumericField(
                            'otp_validity_minutes',
                            'OTP Validity',
                            'How long each OTP remains valid.',
                            'min',
                        )}
                    </View>

                    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
                        <Text style={[styles.sectionTitle, { color: c.text }]}>Geo & Battery</Text>

                        {renderNumericField(
                            'geofence_radius',
                            'Geofence Radius',
                            'Distance from the box before out-of-zone events trigger.',
                            'm',
                        )}
                        {renderNumericField(
                            'battery_warning_threshold',
                            'Battery Warning Threshold',
                            'Warning signal threshold for operators and users.',
                            '%',
                        )}
                        {renderNumericField(
                            'battery_critical_threshold',
                            'Battery Critical Threshold',
                            'Critical signal threshold for urgent handling.',
                            '%',
                        )}

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
        fontSize: 15,
        fontFamily: 'Inter_700Bold',
        marginBottom: 10,
        letterSpacing: 0.2,
    },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    fieldLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
    help: { fontSize: 12, marginTop: 2 },
    inputShell: {
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 10,
        paddingTop: 10,
        paddingBottom: 10,
        marginBottom: 10,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.08,
        shadowRadius: 10,
        elevation: 1,
    },
    inputTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    inputMeta: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: 0.7,
        textTransform: 'uppercase',
    },
    premiumInput: {
        height: 46,
        marginBottom: 5,
    },
    premiumInputContent: {
        fontSize: 16,
        fontFamily: 'Inter_600SemiBold',
        paddingHorizontal: 4,
    },
    inputAffix: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
        opacity: 0.8,
    },
    inputHint: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
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
