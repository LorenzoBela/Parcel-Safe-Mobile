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

export default function TermsOfServiceScreen() {
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
                        <Text style={[styles.title, { color: c.text }]}>Terms of Service</Text>
                        <View style={[styles.divider, { backgroundColor: c.text }]} />
                        <Text style={[styles.subtitle, { color: c.textSec }]}>Last Updated: January 2026</Text>
                    </View>

                    <Section c={c} index="01" title="Introduction" content="Welcome to Parcel Safe. These Terms of Service govern your access to and use of our mobile application and IoT-enabled top box services. By accessing our platform, you agree to be bound by these Terms." />
                    <Section c={c} index="02" title="Service Description" content="Parcel Safe provides a secure delivery platform utilizing proprietary IoT-enabled top boxes. We act as a technology intermediary, providing software and hardware solutions to ensure verifiable, secure parcel handling between riders and customers." />
                    <Section c={c} index="03" title="User Responsibilities" content="You agree to provide accurate location and contact information. You are strictly responsible for maintaining the confidentiality of your account credentials and OTP codes. Sharing OTP codes remotely or via unsecured channels voids our security guarantees." />
                    <Section c={c} index="04" title="IoT Hardware Security" content="Our physical top boxes are designed strictly for security and operational integrity. Tampering with the hardware, attempting unauthorized entry, or interfering with the onboard camera and telemetry systems is strictly prohibited and may result in immediate suspension of service and legal action." />
                    <Section c={c} index="05" title="Liability & Warranties" content="We are not liable for delays caused by external factors such as traffic, weather, or force majeure events. While we provide advanced security measures, our liability for damaged or lost items is limited strictly to the declared value of the shipment at the time of booking, subject to investigation." />
                    <Section c={c} index="06" title="Dispute Resolution" content="Any disputes arising out of or relating to these Terms shall first be resolved amicably through our support channels. If unresolved, disputes will be subject to the exclusive jurisdiction of the competent courts, in accordance with applicable local laws." />

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
                        <Text style={[styles.actionButtonText, { color: c.bg }]}>I Accept & Continue</Text>
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
