import React from 'react';
import { Animated, StyleSheet, ScrollView, View, Pressable } from 'react-native';
import { useEntryAnimation } from '../../hooks/useEntryAnimation';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useAppTheme } from '../../context/ThemeContext';
import { SafeAreaView } from 'react-native-safe-area-context';

const light = {
    bg: '#FAFAFA', card: '#FFFFFF', border: '#E4E4E7',
    text: '#09090B', textSec: '#52525B', textTer: '#A1A1AA',
    accent: '#09090B',
};
const dark = {
    bg: '#000000', card: '#09090B', border: '#27272A',
    text: '#FAFAFA', textSec: '#A1A1AA', textTer: '#71717A',
    accent: '#FAFAFA',
};

const Section = ({ index, title, content, c }: { index: string, title: string, content: string, c: typeof light }) => (
    <View style={styles.sectionContainer}>
        <View style={styles.sectionHeader}>
            <Text style={[styles.sectionIndex, { color: c.textTer }]}>{index}</Text>
            <Text style={[styles.sectionTitle, { color: c.text }]}>{title}</Text>
        </View>
        <Text style={[styles.paragraph, { color: c.textSec }]}>{content}</Text>
    </View>
);

export default function PrivacyPolicyScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? dark : light;
    const navigation = useNavigation();
    const screenAnim = useEntryAnimation(0);

    return (
        <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: c.bg }}>
            <Animated.View style={[{ flex: 1 }, screenAnim.style]}>
                <ScrollView 
                    style={styles.container} 
                    contentContainerStyle={styles.content}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.header}>
                        <Text style={[styles.tagline, { color: c.textTer }]}>LEGAL AGREEMENT</Text>
                        <Text style={[styles.title, { color: c.text }]}>Privacy Policy</Text>
                        <View style={[styles.divider, { backgroundColor: c.text }]} />
                        <Text style={[styles.subtitle, { color: c.textSec }]}>Last Updated: January 2026</Text>
                    </View>

                    <Section c={c} index="01" title="Introduction" content="We value your privacy. This policy explains how we collect, use, and protect your personal information in strict compliance with relevant laws, including the Data Privacy Act of 2012 (Republic Act No. 10173)." />
                    <Section c={c} index="02" title="Data Collection" content="We collect personal information such as your name, contact details, and delivery address to facilitate our services. We also collect precise geolocation data during active deliveries and hardware interaction logs (such as IoT lock/unlock events)." />
                    <Section c={c} index="03" title="How We Use Your Data" content="Your data is used strictly for operational purposes: matching riders with deliveries, calculating fees, generating secure OTPs, and verifying drop-offs. Geolocation and timestamp data are utilized to ensure physical security and prevent fraud. We do not sell, rent, or lease your personal data to third parties under any circumstances." />
                    <Section c={c} index="04" title="How We Protect Your Data" content="We implement industry-standard encryption for data both in transit and at rest. Access to personal data is restricted by strict Row-Level Security (RLS) policies within our databases, ensuring only authorized personnel (e.g., the assigned rider) can view delivery specifics. We enforce rigorous data handling protocols and conduct regular security audits." />
                    <Section c={c} index="05" title="Your Rights (DPA of 2012)" content="Under the Data Privacy Act of 2012, you possess the right to be informed, access, object, erasure or blocking, damages, file a complaint, rectify, and data portability. To exercise any of these rights, please contact our designated Data Protection Officer at privacy@parcelsafe.com." />
                    <Section c={c} index="06" title="Data Retention" content="We retain your personal data only for as long as necessary to fulfill the purposes outlined in this policy, or as required by applicable laws. Delivery logs and OTP hashes are archived securely immediately after delivery completion." />

                    <View style={{ height: 100 }} />
                </ScrollView>

                {/* Floating Button */}
                <View style={[styles.floatingFooter, { borderTopColor: c.border, backgroundColor: c.bg }]}>
                    <Pressable 
                        style={({ pressed }) => [
                            styles.actionButton,
                            { 
                                backgroundColor: c.text,
                                opacity: pressed ? 0.8 : 1,
                                transform: [{ scale: pressed ? 0.98 : 1 }]
                            }
                        ]}
                        onPress={() => navigation.goBack()}
                    >
                        <Text style={[styles.actionButtonText, { color: c.bg }]}>Understood & Close</Text>
                    </Pressable>
                </View>
            </Animated.View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 28,
        paddingTop: 64,
        paddingBottom: 40,
    },
    header: {
        marginBottom: 56,
    },
    tagline: {
        fontFamily: 'Inter_600SemiBold',
        fontSize: 12,
        letterSpacing: 2,
        marginBottom: 16,
    },
    title: {
        fontFamily: 'Inter_700Bold',
        fontSize: 40,
        letterSpacing: -1.5,
        lineHeight: 44,
        marginBottom: 24,
    },
    divider: {
        width: 60,
        height: 4,
        marginBottom: 24,
    },
    subtitle: {
        fontFamily: 'Inter_400Regular',
        fontSize: 15,
        letterSpacing: 0.2,
    },
    sectionContainer: {
        marginBottom: 48,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginBottom: 16,
    },
    sectionIndex: {
        fontFamily: 'Inter_700Bold',
        fontSize: 16,
        marginRight: 16,
    },
    sectionTitle: {
        fontFamily: 'Inter_700Bold',
        fontSize: 22,
        letterSpacing: -0.5,
    },
    paragraph: {
        fontFamily: 'Inter_400Regular',
        fontSize: 16,
        lineHeight: 28,
        letterSpacing: 0.2,
    },
    floatingFooter: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderTopWidth: 1,
    },
    actionButton: {
        width: '100%',
        paddingVertical: 18,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 2,
    },
    actionButtonText: {
        fontFamily: 'Inter_600SemiBold',
        fontSize: 16,
        letterSpacing: 0,
    }
});
