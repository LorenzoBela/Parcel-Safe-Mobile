import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Linking, TouchableOpacity, TextInput as RNTextInput, Animated, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import { PremiumAlert } from '../../services/PremiumAlertService';

const lightC = {
    bg: '#FAFAFA', card: '#FFFFFF', text: '#09090B', textSec: '#71717A', textTer: '#A1A1AA',
    accent: '#09090B', accentText: '#FAFAFA', border: '#E4E4E7', divider: '#F4F4F5',
    search: '#F4F4F5', dangerBg: '#FEF2F2', dangerText: '#DC2626', dangerBorder: '#FECACA'
};
const darkC = {
    bg: '#09090B', card: '#18181B', text: '#FAFAFA', textSec: '#A1A1AA', textTer: '#71717A',
    accent: '#FAFAFA', accentText: '#09090B', border: '#27272A', divider: '#27272A',
    search: '#27272A', dangerBg: '#450A0A', dangerText: '#FCA5A5', dangerBorder: '#7F1D1D'
};

export default function RiderSupportScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const navigation = useNavigation<any>();
    const [message, setMessage] = useState('');
    const [isFocused, setIsFocused] = useState(false);

    // Animations
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(20)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 600,
                useNativeDriver: true,
            }),
            Animated.spring(translateY, {
                toValue: 0,
                tension: 50,
                friction: 7,
                useNativeDriver: true,
            })
        ]).start();
    }, []);

    const handleCallSOS = () => {
        Linking.openURL('tel:911'); // Example emergency
    };

    const handleSubmitTicket = () => {
        if (!message.trim()) {
            PremiumAlert.alert("Empty Message", "Please describe your issue to submit a report.");
            return;
        }
        Keyboard.dismiss();
        PremiumAlert.alert("Report Submitted", "Dispatch has been notified. We will contact you shortly via the app.");
        setMessage('');
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'bottom']}>
            <KeyboardAvoidingView 
                behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
                style={{ flex: 1 }}
            >
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: c.divider }]}>
                    <TouchableOpacity 
                        style={styles.backButton} 
                        onPress={() => navigation.goBack()}
                        hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                    >
                        <MaterialCommunityIcons name="arrow-left" size={24} color={c.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: c.text }]}>SUPPORT</Text>
                    <View style={styles.headerRight} />
                </View>

                <ScrollView 
                    contentContainerStyle={styles.scrollContent} 
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY }] }}>
                        
                        {/* Emergency Section */}
                        <Text style={[styles.sectionTitle, { color: c.textTer }]}>EMERGENCY PROTOCOL</Text>
                        <Animated.View style={[styles.dangerCard, { 
                            backgroundColor: c.dangerBg, 
                            borderColor: c.dangerBorder
                        }]}>
                            <View style={styles.dangerHeader}>
                                <MaterialCommunityIcons name="alert-decagram" size={28} color={c.dangerText} />
                                <Text style={[styles.dangerTitle, { color: c.dangerText }]}>S.O.S DISPATCH</Text>
                            </View>
                            <Text style={[styles.dangerDesc, { color: c.dangerText }]}>
                                For immediate physical threats, accidents, or critical hardware failure in the field.
                            </Text>
                            <TouchableOpacity 
                                style={[styles.dangerButton, { backgroundColor: c.dangerText }]}
                                activeOpacity={0.8}
                                onPress={handleCallSOS}
                            >
                                <MaterialCommunityIcons name="phone" size={20} color={c.bg} />
                                <Text style={[styles.dangerButtonText, { color: c.bg }]}>CONTACT EMERGENCY</Text>
                            </TouchableOpacity>
                        </Animated.View>

                        {/* Submit Ticket */}
                        <Text style={[styles.sectionTitle, { color: c.textTer, marginTop: 32 }]}>INCIDENT REPORT</Text>
                        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
                            <View style={[styles.inputContainer, { borderColor: isFocused ? c.accent : c.border }]}>
                                <RNTextInput
                                    style={[styles.input, { color: c.text }]}
                                    placeholder="Describe the issue (e.g. Box won't open, customer unreachable)..."
                                    placeholderTextColor={c.textTer}
                                    multiline
                                    textAlignVertical="top"
                                    value={message}
                                    onChangeText={setMessage}
                                    onFocus={() => setIsFocused(true)}
                                    onBlur={() => setIsFocused(false)}
                                    selectionColor={c.textTer}
                                />
                            </View>
                            <TouchableOpacity 
                                style={[styles.submitButton, { backgroundColor: message.trim() ? c.accent : c.divider }]}
                                activeOpacity={0.8}
                                onPress={handleSubmitTicket}
                                disabled={!message.trim()}
                            >
                                <Text style={[styles.submitButtonText, { color: message.trim() ? c.accentText : c.textTer }]}>
                                    SUBMIT REPORT
                                </Text>
                                <MaterialCommunityIcons 
                                    name="send" 
                                    size={18} 
                                    color={message.trim() ? c.accentText : c.textTer} 
                                />
                            </TouchableOpacity>
                        </View>

                        {/* Direct Contact */}
                        <Text style={[styles.sectionTitle, { color: c.textTer, marginTop: 32 }]}>DIRECT LINES</Text>
                        <View style={[styles.cardGroup, { backgroundColor: c.card, borderColor: c.border }]}>
                            <TouchableOpacity style={styles.listItem} onPress={() => Linking.openURL('mailto:lorenzo.miguel.bela429@adamson.edu.ph')}>
                                <View style={[styles.listIconWrap, { backgroundColor: c.accent + '0A' }]}>
                                    <MaterialCommunityIcons name="email" size={22} color={c.accent} />
                                </View>
                                <View style={styles.listTextWrap}>
                                    <Text style={[styles.listTitle, { color: c.text }]}>Lorenzo Bela</Text>
                                    <Text style={[styles.listDesc, { color: c.textSec }]} numberOfLines={1} adjustsFontSizeToFit>lorenzo.miguel.bela429@adamson.edu.ph</Text>
                                </View>
                                <MaterialCommunityIcons name="chevron-right" size={20} color={c.textTer} />
                            </TouchableOpacity>
                            <View style={[styles.divider, { backgroundColor: c.divider }]} />
                            <TouchableOpacity style={styles.listItem} onPress={() => Linking.openURL('mailto:kean.louiz.guzon@adamson.edu.ph')}>
                                <View style={[styles.listIconWrap, { backgroundColor: c.accent + '0A' }]}>
                                    <MaterialCommunityIcons name="email" size={22} color={c.accent} />
                                </View>
                                <View style={styles.listTextWrap}>
                                    <Text style={[styles.listTitle, { color: c.text }]}>Kean Guzon</Text>
                                    <Text style={[styles.listDesc, { color: c.textSec }]} numberOfLines={1} adjustsFontSizeToFit>kean.louiz.guzon@adamson.edu.ph</Text>
                                </View>
                                <MaterialCommunityIcons name="chevron-right" size={20} color={c.textTer} />
                            </TouchableOpacity>
                            <View style={[styles.divider, { backgroundColor: c.divider }]} />
                            <TouchableOpacity style={styles.listItem} onPress={() => Linking.openURL('mailto:robert.victor.callorina@adamson.edu.ph')}>
                                <View style={[styles.listIconWrap, { backgroundColor: c.accent + '0A' }]}>
                                    <MaterialCommunityIcons name="email" size={22} color={c.accent} />
                                </View>
                                <View style={styles.listTextWrap}>
                                    <Text style={[styles.listTitle, { color: c.text }]}>Robert Callorina</Text>
                                    <Text style={[styles.listDesc, { color: c.textSec }]} numberOfLines={1} adjustsFontSizeToFit>robert.victor.callorina@adamson.edu.ph</Text>
                                </View>
                                <MaterialCommunityIcons name="chevron-right" size={20} color={c.textTer} />
                            </TouchableOpacity>
                        </View>

                        {/* Quick Troubleshooting */}
                        <Text style={[styles.sectionTitle, { color: c.textTer, marginTop: 32 }]}>TROUBLESHOOTING</Text>
                        <View style={[styles.cardGroup, { backgroundColor: c.card, borderColor: c.border, marginBottom: 40 }]}>
                            <TouchableOpacity 
                                style={styles.listItem} 
                                onPress={() => PremiumAlert.alert("Connectivity", "Ensure Bluetooth is enabled and you are within 2 meters of the ParcelSafe Box.")}
                            >
                                <MaterialCommunityIcons name="bluetooth-connect" size={24} color={c.textSec} style={styles.topicIcon} />
                                <View style={styles.listTextWrap}>
                                    <Text style={[styles.listTitle, { color: c.text }]}>Box Connection Failed</Text>
                                    <Text style={[styles.listDesc, { color: c.textSec }]}>Bluetooth & Proximity checks</Text>
                                </View>
                            </TouchableOpacity>
                            <View style={[styles.divider, { backgroundColor: c.divider }]} />
                            <TouchableOpacity 
                                style={styles.listItem} 
                                onPress={() => PremiumAlert.alert("Earnings", "Payouts are processed every Friday. Discrepancies can be contested via the Earnings tab.")}
                            >
                                <MaterialCommunityIcons name="cash" size={24} color={c.textSec} style={styles.topicIcon} />
                                <View style={styles.listTextWrap}>
                                    <Text style={[styles.listTitle, { color: c.text }]}>Earnings & Payouts</Text>
                                    <Text style={[styles.listDesc, { color: c.textSec }]}>Schedule and disputes</Text>
                                </View>
                            </TouchableOpacity>
                        </View>

                    </Animated.View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: -10,
    },
    headerTitle: {
        fontSize: 14,
        fontFamily: 'JetBrainsMono_700Bold',
        letterSpacing: 2,
    },
    headerRight: {
        width: 40, // To balance the back button
    },
    scrollContent: {
        padding: 24,
    },
    sectionTitle: {
        fontSize: 12,
        fontFamily: 'JetBrainsMono_700Bold',
        letterSpacing: 1.5,
        marginBottom: 12,
        marginLeft: 4,
    },
    dangerCard: {
        borderRadius: 16,
        borderWidth: 1,
        padding: 20,
    },
    dangerHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    dangerTitle: {
        fontSize: 16,
        fontFamily: 'JetBrainsMono_700Bold',
        marginLeft: 10,
        letterSpacing: 0.5,
    },
    dangerDesc: {
        fontSize: 14,
        fontFamily: 'Inter_400Regular',
        lineHeight: 20,
        marginBottom: 20,
        opacity: 0.9,
    },
    dangerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        borderRadius: 12,
    },
    dangerButtonText: {
        fontFamily: 'JetBrainsMono_700Bold',
        fontSize: 13,
        letterSpacing: 1,
        marginLeft: 8,
    },
    card: {
        borderRadius: 16,
        borderWidth: 1,
        padding: 16,
    },
    inputContainer: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 16,
        minHeight: 120,
        marginBottom: 16,
    },
    input: {
        flex: 1,
        fontFamily: 'Inter_400Regular',
        fontSize: 15,
        lineHeight: 22,
    },
    submitButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        borderRadius: 12,
    },
    submitButtonText: {
        fontFamily: 'JetBrainsMono_700Bold',
        fontSize: 13,
        letterSpacing: 1,
        marginRight: 8,
    },
    cardGroup: {
        borderRadius: 16,
        borderWidth: 1,
        overflow: 'hidden',
    },
    listItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    listIconWrap: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    topicIcon: {
        width: 44,
        textAlign: 'center',
        marginRight: 12,
    },
    listTextWrap: {
        flex: 1,
    },
    listTitle: {
        fontSize: 15,
        fontFamily: 'Inter_600SemiBold',
        marginBottom: 2,
    },
    listDesc: {
        fontSize: 13,
        fontFamily: 'Inter_400Regular',
    },
    divider: {
        height: 1,
        marginLeft: 76,
    },
});
