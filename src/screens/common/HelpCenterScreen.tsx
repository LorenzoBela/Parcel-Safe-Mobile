import React, { useState } from 'react';
import { Animated, StyleSheet, ScrollView, View, TouchableOpacity, LayoutAnimation, Platform, UIManager, Linking } from 'react-native';
import { useEntryAnimation, useStaggerAnimation } from '../../hooks/useEntryAnimation';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Colors ─────────────────────────────────────────────────────────────────────
const light = {
    bg: '#FAFAFA', card: '#FFFFFF', border: '#E4E4E7',
    text: '#09090B', textSec: '#52525B', textTer: '#A1A1AA',
    accent: '#09090B', error: '#FF3B30',
};
const dark = {
    bg: '#000000', card: '#09090B', border: '#27272A',
    text: '#FFFFFF', textSec: '#A1A1AA', textTer: '#52525B',
    accent: '#FFFFFF', error: '#FF453A',
};

// ─── Content ────────────────────────────────────────────────────────────────────
const FAQS = [
    {
        category: 'Getting Started',
        items: [
            { q: "How do I pair my Smart Top Box?", a: "Turn on your ESP32-powered Smart Top Box. The LED should blink blue indicating it's in pairing mode. Connect via the app's 'Add Device' screen." },
            { q: "What does the blinking red LED mean?", a: "A fast blinking red LED indicates a network error or connection failure. Please check your WiFi settings and ensure the box has an active internet connection." },
        ]
    },
    {
        category: 'Delivery & OTP',
        items: [
            { q: "How is the box unlocked?", a: "When the rider arrives at the destination, a 6-digit OTP is generated. The rider inputs this via the keypad to unlock the solenoid." },
            { q: "The OTP isn't working?", a: "Ensure the box has an internet connection to sync the latest OTP hash. If the issue persists, the owner can issue a remote override unlock via the dashboard." },
            { q: "Why is a photo taken when unlocking?", a: "For security. The box captures a photo immediately upon successful OTP entry before the lock disengages to prevent fraud." },
        ]
    },
    {
        category: 'Privacy & Security',
        items: [
            { q: "Is my location data safe?", a: "Yes. GPS data is only recorded during active transit and is governed by strict Row Level Security (RLS) policies in our database. It is not shared with third parties." },
            { q: "Who can access my delivery history?", a: "Only your authenticated account and our system administrators can access your history. All data is encrypted at rest." }
        ]
    }
];

// ─── Components ─────────────────────────────────────────────────────────────────
function FAQItem({ q, a, c }: { q: string, a: string, c: typeof light }) {
    const [expanded, setExpanded] = useState(false);

    const toggle = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded(!expanded);
    };

    return (
        <TouchableOpacity activeOpacity={0.7} onPress={toggle} style={[styles.faqItem, { borderColor: c.border, backgroundColor: c.card }]}>
            <View style={styles.faqHeader}>
                <Text style={[styles.faqQ, { color: c.text }]}>{q}</Text>
                <MaterialCommunityIcons name={expanded ? "chevron-up" : "chevron-down"} size={20} color={c.textTer} />
            </View>
            {expanded && (
                <Text style={[styles.faqA, { color: c.textSec }]}>{a}</Text>
            )}
        </TouchableOpacity>
    );
}

// ─── Screen ─────────────────────────────────────────────────────────────────────
export default function HelpCenterScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const screenAnim = useEntryAnimation(0);
    const staggerAnims = useStaggerAnimation(FAQS.length + 2, 50, 100);

    return (
        <Animated.View style={[{ flex: 1, backgroundColor: c.bg }, screenAnim.style]}>
            <ScrollView
                style={[styles.container, { backgroundColor: c.bg }]}
                contentContainerStyle={{
                    paddingBottom: insets.bottom + 120, // space for sticky footer
                    paddingTop: insets.top + 20,
                    paddingHorizontal: 20,
                }}
                showsVerticalScrollIndicator={false}
            >
                {/* Header */}
                <Animated.View style={[styles.header, staggerAnims[0].style]}>
                    <View style={[styles.iconBox, { backgroundColor: c.accent + '0A', borderColor: c.border }]}>
                        <MaterialCommunityIcons name="lifebuoy" size={32} color={c.accent} />
                    </View>
                    <Text style={[styles.title, { color: c.text }]}>Help & Support</Text>
                    <Text style={[styles.subtitle, { color: c.textSec }]}>
                        Everything you need to know about your Smart Top Box hardware and delivery tracking.
                    </Text>
                </Animated.View>

                {/* FAQs */}
                {FAQS.map((section, idx) => (
                    <Animated.View key={idx} style={staggerAnims[idx + 1].style}>
                        <Text style={[styles.sectionTitle, { color: c.textTer }]}>{section.category}</Text>
                        <View style={styles.faqList}>
                            {section.items.map((item, itemIdx) => (
                                <FAQItem key={itemIdx} q={item.q} a={item.a} c={c} />
                            ))}
                        </View>
                    </Animated.View>
                ))}

                {/* Contact */}
                <Animated.View style={staggerAnims[FAQS.length + 1].style}>
                    <Text style={[styles.sectionTitle, { color: c.textTer, marginTop: 12 }]}>CONTACT US</Text>
                    <View style={styles.contactGrid}>
                        <TouchableOpacity 
                            style={[styles.contactCard, { backgroundColor: c.card, borderColor: c.border }]} 
                            activeOpacity={0.7}
                            onPress={() => Linking.openURL('mailto:lorenzo.miguel.bela429@adamson.edu.ph')}
                        >
                            <View style={[styles.contactIconWrap, { backgroundColor: c.accent + '0A' }]}>
                                <MaterialCommunityIcons name="email" size={24} color={c.accent} />
                            </View>
                            <View style={styles.contactTextWrap}>
                                <Text style={[styles.contactTitle, { color: c.text }]}>Lorenzo Bela</Text>
                                <Text style={[styles.contactDesc, { color: c.textSec }]} numberOfLines={1} adjustsFontSizeToFit>lorenzo.miguel.bela429@adamson.edu.ph</Text>
                            </View>
                            <MaterialCommunityIcons name="chevron-right" size={20} color={c.textTer} />
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[styles.contactCard, { backgroundColor: c.card, borderColor: c.border }]} 
                            activeOpacity={0.7}
                            onPress={() => Linking.openURL('mailto:kean.louiz.guzon@adamson.edu.ph')}
                        >
                            <View style={[styles.contactIconWrap, { backgroundColor: c.accent + '0A' }]}>
                                <MaterialCommunityIcons name="email" size={24} color={c.accent} />
                            </View>
                            <View style={styles.contactTextWrap}>
                                <Text style={[styles.contactTitle, { color: c.text }]}>Kean Guzon</Text>
                                <Text style={[styles.contactDesc, { color: c.textSec }]} numberOfLines={1} adjustsFontSizeToFit>kean.louiz.guzon@adamson.edu.ph</Text>
                            </View>
                            <MaterialCommunityIcons name="chevron-right" size={20} color={c.textTer} />
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[styles.contactCard, { backgroundColor: c.card, borderColor: c.border }]} 
                            activeOpacity={0.7}
                            onPress={() => Linking.openURL('mailto:robert.victor.callorina@adamson.edu.ph')}
                        >
                            <View style={[styles.contactIconWrap, { backgroundColor: c.accent + '0A' }]}>
                                <MaterialCommunityIcons name="email" size={24} color={c.accent} />
                            </View>
                            <View style={styles.contactTextWrap}>
                                <Text style={[styles.contactTitle, { color: c.text }]}>Robert Callorina</Text>
                                <Text style={[styles.contactDesc, { color: c.textSec }]} numberOfLines={1} adjustsFontSizeToFit>robert.victor.callorina@adamson.edu.ph</Text>
                            </View>
                            <MaterialCommunityIcons name="chevron-right" size={20} color={c.textTer} />
                        </TouchableOpacity>
                    </View>
                </Animated.View>

            </ScrollView>

            {/* Sticky Back Footer */}
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20), backgroundColor: c.bg, borderTopColor: c.border }]}>
                <TouchableOpacity
                    style={[styles.backBtn, { backgroundColor: c.accent }]}
                    activeOpacity={0.8}
                    onPress={() => navigation.goBack()}
                >
                    <Text style={[styles.backBtnText, { color: c.bg }]}>Return</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        marginBottom: 40,
        alignItems: 'flex-start',
    },
    iconBox: {
        width: 64,
        height: 64,
        borderRadius: 20,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
    },
    title: {
        fontSize: 32,
        fontFamily: 'Inter_700Bold',
        letterSpacing: -1,
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 15,
        fontFamily: 'Inter_400Regular',
        lineHeight: 22,
    },
    sectionTitle: {
        fontSize: 12,
        fontFamily: 'JetBrainsMono_700Bold',
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginBottom: 16,
    },
    faqList: {
        marginBottom: 32,
        gap: 12,
    },
    faqItem: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.03,
        shadowRadius: 8,
        elevation: 2,
    },
    faqHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    faqQ: {
        flex: 1,
        fontSize: 15,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: -0.2,
        marginRight: 16,
    },
    faqA: {
        marginTop: 12,
        fontSize: 14,
        fontFamily: 'Inter_400Regular',
        lineHeight: 22,
    },
    contactGrid: {
        flexDirection: 'column',
        gap: 12,
    },
    contactCard: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.03,
        shadowRadius: 8,
        elevation: 2,
    },
    contactIconWrap: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    contactTextWrap: {
        flex: 1,
    },
    contactTitle: {
        fontSize: 16,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: -0.2,
        marginBottom: 2,
    },
    contactDesc: {
        fontSize: 14,
        fontFamily: 'Inter_400Regular',
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        width: '100%',
        paddingHorizontal: 20,
        paddingTop: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    backBtn: {
        height: 56,
        borderRadius: 100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backBtnText: {
        fontSize: 16,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: -0.3,
    },
});
