import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, StatusBar } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import { PRICING, RateInfo, fetchRates } from '../../services/pricingService';

const API_BASE_URL =
    process.env.EXPO_PUBLIC_TRACKING_WEB_BASE_URL
    || process.env.EXPO_PUBLIC_API_URL
    || 'https://parcel-safe.vercel.app';

// ─── Colors ─────────────────────────────────────────────────────────────────────
const light = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    accent: '#000000', green: '#34C759', greenBg: '#F0FDF4', greenBorder: '#BBF7D0',
};
const dark = {
    bg: '#000000', card: '#141414', border: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    accent: '#FFFFFF', green: '#30D158', greenBg: '#0A1F0A', greenBorder: '#1A3A1A',
};

// ─── Data rows ──────────────────────────────────────────────────────────────────
function RateRow({ label, value, c }: { label: string; value: string; c: typeof light }) {
    return (
        <View style={[styles.rateRow, { borderBottomColor: c.border }]}>
            <Text style={[styles.rateLabel, { color: c.textSec }]}>{label}</Text>
            <Text style={[styles.rateValue, { color: c.text }]}>{value}</Text>
        </View>
    );
}

function BulletRow({ text, c }: { text: string; c: typeof light }) {
    return (
        <View style={styles.bulletRow}>
            <MaterialCommunityIcons name="check-circle" size={16} color={c.green} />
            <Text style={[styles.bulletText, { color: c.text }]}>{text}</Text>
        </View>
    );
}

// ─── Screen ─────────────────────────────────────────────────────────────────────
export default function RatesScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();

    // Pull canonical rates from /api/pricing/rates at mount. The local
    // constants are used as an offline fallback so the screen never shows
    // blank placeholders. The previous hard-coded ₱49/₱10 copy was WRONG —
    // the real formula is base ₱50 + ₱15/km + ₱2/min.
    const [rates, setRates] = useState<RateInfo>({
        baseFare: PRICING.BASE_FARE,
        perKm: PRICING.PER_KM,
        perMin: PRICING.PER_MIN,
        currency: PRICING.CURRENCY,
        formula: 'round(base + km * perKm + min * perMin)',
    });

    useEffect(() => {
        const controller = new AbortController();
        fetchRates(API_BASE_URL, controller.signal).then(setRates).catch(() => { });
        return () => controller.abort();
    }, []);

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: c.bg }]}
            contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }}
        >
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

            {/* Header */}
            <View style={styles.header}>
                <MaterialCommunityIcons name="tag-multiple" size={36} color={c.accent} />
                <Text style={[styles.headerTitle, { color: c.text }]}>System Rates</Text>
                <Text style={[styles.headerSub, { color: c.textSec }]}>Transparent pricing for secure deliveries</Text>
            </View>

            {/* Standard Delivery */}
            <Text style={[styles.sectionLabel, { color: c.textSec }]}>STANDARD DELIVERY</Text>
            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                <View style={styles.sectionHeaderRow}>
                    <MaterialCommunityIcons name="moped" size={22} color={c.accent} />
                    <Text style={[styles.sectionTitle, { color: c.text }]}>Parcel Delivery</Text>
                </View>
                <Text style={[styles.sectionDesc, { color: c.textSec }]}>
                    Ideal for documents, small parcels, and food items. Includes Smart Top Box security.
                </Text>
                <View style={[styles.priceCard, { backgroundColor: c.bg, borderColor: c.border }]}>
                    <View style={styles.priceMainRow}>
                        <Text style={[styles.priceMain, { color: c.text }]}>₱{rates.baseFare.toFixed(2)}</Text>
                        <Text style={[styles.priceUnit, { color: c.textTer }]}>base fare</Text>
                    </View>
                    <View style={styles.priceMainRow}>
                        <Text style={[styles.priceAdd, { color: c.text }]}>+ ₱{rates.perKm.toFixed(2)}</Text>
                        <Text style={[styles.priceUnit, { color: c.textTer }]}>per km</Text>
                    </View>
                    <View style={styles.priceMainRow}>
                        <Text style={[styles.priceAdd, { color: c.text }]}>+ ₱{rates.perMin.toFixed(2)}</Text>
                        <Text style={[styles.priceUnit, { color: c.textTer }]}>per minute</Text>
                    </View>
                </View>
            </View>

            {/* Surcharges */}
            <Text style={[styles.sectionLabel, { color: c.textSec }]}>ADD-ONS & SURCHARGES</Text>
            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
                <RateRow label="High Value (Insured)" value="+ ₱50.00" c={c} />
                <RateRow label="Wait Time (per 5 min)" value="+ ₱15.00" c={c} />
                <RateRow label="Night Service (10PM–6AM)" value="+ 20%" c={c} />
                <RateRow label="Holiday Surcharge" value="+ 15%" c={c} />
            </View>

            {/* Security included */}
            <Text style={[styles.sectionLabel, { color: c.textSec }]}>INCLUDED SECURITY</Text>
            <View style={[styles.section, { backgroundColor: c.greenBg, borderColor: c.greenBorder }]}>
                <View style={styles.sectionHeaderRow}>
                    <MaterialCommunityIcons name="shield-check" size={22} color={c.green} />
                    <Text style={[styles.sectionTitle, { color: c.green }]}>Every delivery includes</Text>
                </View>
                <BulletRow text="GPS Real-time Tracking" c={c} />
                <BulletRow text="Photographic Proof of Delivery" c={c} />
                <BulletRow text="Smart Lock Tamper Alerts" c={c} />
            </View>

            {/* Close */}
            <TouchableOpacity
                style={[styles.closeBtn, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => navigation.goBack()}
                activeOpacity={0.7}
            >
                <Text style={[styles.closeBtnText, { color: c.textSec }]}>Close</Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { alignItems: 'center', paddingHorizontal: 20, marginBottom: 24, marginTop: 8 },
    headerTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', marginTop: 8 },
    headerSub: { fontSize: 14, textAlign: 'center', marginTop: 3 },
    sectionLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8, marginHorizontal: 20, marginBottom: 6, marginTop: 4 },
    section: { marginHorizontal: 16, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 20 },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
    sectionDesc: { fontSize: 13, marginBottom: 12, lineHeight: 19 },
    priceCard: { borderRadius: 10, borderWidth: 1, padding: 12, gap: 4 },
    priceMainRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    priceMain: { fontSize: 22, fontFamily: 'Inter_700Bold' },
    priceAdd: { fontSize: 16, fontFamily: 'Inter_700Bold' },
    priceUnit: { fontSize: 13 },
    rateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
    rateLabel: { fontSize: 14, flex: 1 },
    rateValue: { fontSize: 14, fontFamily: 'Inter_700Bold' },
    bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
    bulletText: { fontSize: 14 },
    closeBtn: { marginHorizontal: 16, paddingVertical: 14, borderRadius: 14, borderWidth: 1, alignItems: 'center', marginTop: 4 },
    closeBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
