import React, { useState, useCallback } from 'react';
import { View, Animated, StyleSheet, ScrollView, StatusBar } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAppTheme } from '../../context/ThemeContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import {
    loadNotificationPreferences,
    updateNotificationPreference,
    NotificationPreferences,
    DEFAULT_NOTIFICATION_PREFS,
} from '../../services/pushNotificationService';

// ─── Colors ─────────────────────────────────────────────────────────────────────
const light = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    accent: '#000000', switchTrack: '#000000',
};
const dark = {
    bg: '#000000', card: '#141414', border: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    accent: '#FFFFFF', switchTrack: '#FFFFFF',
};

// ─── Row ────────────────────────────────────────────────────────────────────────
function PrefRow({ icon, label, subtitle, value, onToggle, disabled, c }: {
    icon: string; label: string; subtitle: string;
    value: boolean; onToggle?: (v: boolean) => void; disabled?: boolean;
    c: typeof light;
}) {
    return (
        <View style={[styles.row, { borderBottomColor: c.border }]}>
            <View style={[styles.rowIcon, { backgroundColor: c.card }]}>
                <MaterialCommunityIcons name={icon as any} size={20} color={c.accent} />
            </View>
            <View style={styles.rowContent}>
                <Text style={[styles.rowLabel, { color: disabled ? c.textTer : c.text }]}>{label}</Text>
                <Text style={[styles.rowSub, { color: c.textSec }]}>{subtitle}</Text>
            </View>
            <Switch
                value={value}
                onValueChange={disabled ? undefined : onToggle}
                disabled={disabled}
                trackColor={{ false: c.border, true: c.switchTrack }}
            />
        </View>
    );
}

// ─── Screen ─────────────────────────────────────────────────────────────────────
export default function NotificationPreferencesScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const insets = useSafeAreaInsets();
    const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFS);
    const screenAnim = useEntryAnimation(0);

    useFocusEffect(useCallback(() => {
        loadNotificationPreferences().then(setPrefs);
    }, []));

    const toggle = async (key: keyof NotificationPreferences, val: boolean) => {
        setPrefs(p => ({ ...p, [key]: val }));
        await updateNotificationPreference(key, val);
    };

    return (
        <Animated.View style={[{ flex: 1, backgroundColor: c.bg }, screenAnim.style]}>
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
            <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 40 }}>
                <Text style={[styles.sectionTitle, { color: c.textSec }]}>
                    Choose which notifications you'd like to receive.
                </Text>

                <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                    <PrefRow
                        icon="truck-delivery-outline"
                        label="Delivery Updates"
                        subtitle="Status changes, arrivals, completions"
                        value={prefs.delivery_updates}
                        onToggle={(v) => toggle('delivery_updates', v)}
                        c={c}
                    />
                    <PrefRow
                        icon="motorbike"
                        label="Rider Alerts"
                        subtitle="New order requests, cancellations"
                        value={prefs.rider_alerts}
                        onToggle={(v) => toggle('rider_alerts', v)}
                        c={c}
                    />
                    <PrefRow
                        icon="shield-lock-outline"
                        label="Security Alerts"
                        subtitle="Always on for your safety"
                        value={true}
                        disabled
                        c={c}
                    />
                    <PrefRow
                        icon="tag-outline"
                        label="Promotions & Offers"
                        subtitle="Deals and scheduled promos"
                        value={prefs.promotions}
                        onToggle={(v) => toggle('promotions', v)}
                        c={c}
                    />
                </View>
            </ScrollView>
        </Animated.View>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    sectionTitle: {
        fontSize: 13, marginHorizontal: 20, marginBottom: 12, lineHeight: 18,
    },
    section: {
        marginHorizontal: 16, borderRadius: 14, borderWidth: 1, overflow: 'hidden',
    },
    row: {
        flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
        paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowIcon: {
        width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    },
    rowContent: { flex: 1, marginLeft: 12 },
    rowLabel: { fontSize: 15, fontFamily: 'Inter_500Medium' },
    rowSub: { fontSize: 12, marginTop: 1 },
});
