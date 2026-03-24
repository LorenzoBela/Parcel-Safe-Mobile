import React, { useEffect, useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions, DeviceEventEmitter } from 'react-native';
import { Modal, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import { PremiumAlertOptions, PremiumAlert } from '../../services/PremiumAlertService';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type StatusBarStyle = 'dark-content' | 'light-content';
type ColorPalette = {
    bg: string; card: string; border: string;
    textPrimary: string; textSecondary: string; textTertiary: string;
    accent: string; red: string; green: string; orange: string;
    pillBg: string; modalBg: string; statusBar: StatusBarStyle;
};

const lightC: ColorPalette = {
    bg: '#FFFFFF', card: '#F6F6F6', border: '#E5E5EA',
    textPrimary: '#000000', textSecondary: '#6B6B6B', textTertiary: '#AEAEB2',
    accent: '#000000', red: '#E11900', green: '#34C759', orange: '#FF9500',
    pillBg: '#F2F2F7', modalBg: 'rgba(0,0,0,0.4)', statusBar: 'dark-content',
};

const darkC: ColorPalette = {
    bg: '#000000', card: '#141414', border: '#2C2C2E',
    textPrimary: '#FFFFFF', textSecondary: '#8E8E93', textTertiary: '#636366',
    accent: '#FFFFFF', red: '#FF453A', green: '#30D158', orange: '#FFB340',
    pillBg: '#1C1C1E', modalBg: 'rgba(0,0,0,0.7)', statusBar: 'light-content',
};

export default function GlobalPremiumAlert() {
    const [visible, setVisible] = useState(false);
    const [alertConfig, setAlertConfig] = useState<PremiumAlertOptions | null>(null);

    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const insets = useSafeAreaInsets();

    useEffect(() => {
        const subscription = DeviceEventEmitter.addListener(PremiumAlert.SHOW_EVENT, (config: PremiumAlertOptions) => {
            setAlertConfig(config);
            setVisible(true);
        });

        return () => subscription.remove();
    }, []);

    const handleDismiss = () => {
        if (!alertConfig?.options?.cancelable && alertConfig?.buttons?.length) {
            // If not cancelable and has buttons, don't allow backdrop dismiss
            return;
        }

        const onDismissCallback = alertConfig?.options?.onDismiss;
        if (onDismissCallback) {
            onDismissCallback();
        }

        setVisible(false);
    };

    const handleButtonPress = (onPress?: () => void) => {
        setVisible(false);
        if (onPress) {
            // Small delay to let modal close animation start before executing callback
            setTimeout(onPress, 50);
        }
    };

    if (!alertConfig) return null;

    // Fallback OK button if none provided
    const buttons = alertConfig.buttons && alertConfig.buttons.length > 0
        ? alertConfig.buttons
        : [{ text: 'OK', onPress: () => { } }];

    const isDestructive = (style?: 'default' | 'cancel' | 'destructive') => style === 'destructive';
    const isCancel = (style?: 'default' | 'cancel' | 'destructive') => style === 'cancel';

    return (
        <Portal>
            <Modal
                visible={visible}
                onDismiss={handleDismiss}
                dismissable={alertConfig.options?.cancelable !== false}
                contentContainerStyle={[
                    styles.modalContainer,
                    { backgroundColor: c.card, borderColor: c.border, paddingBottom: Math.max(insets.bottom + 20, 20) }
                ]}
                style={styles.modalOverlay}
            >
                <View style={styles.dragIndicator} />

                <View style={styles.content}>
                    {alertConfig.icon && (
                        <View style={[styles.iconContainer, { backgroundColor: (alertConfig.iconColor || c.accent) + '15' }]}>
                            <MaterialCommunityIcons name={alertConfig.icon as any} size={32} color={alertConfig.iconColor || c.accent} />
                        </View>
                    )}
                    <Text style={[styles.title, { color: c.textPrimary }]}>
                        {alertConfig.title}
                    </Text>

                    {alertConfig.message && (
                        <Text style={[styles.description, { color: c.textSecondary }]}>
                            {alertConfig.message}
                        </Text>
                    )}

                    <View style={styles.buttonContainer}>
                        {buttons.map((btn, index) => {
                            const isDanger = isDestructive(btn.style);
                            const isSecondary = isCancel(btn.style) || (!isDanger && index < buttons.length - 1);

                            // Determine button styling based on type
                            let bgColor = c.accent; // Primary action
                            let textColor = isDarkMode ? '#000000' : '#FFFFFF';

                            if (isDanger) {
                                bgColor = c.red;
                                textColor = '#FFFFFF';
                            } else if (isSecondary) {
                                bgColor = c.pillBg;
                                textColor = c.textPrimary;
                            }

                            return (
                                <TouchableOpacity
                                    key={`btn-${index}`}
                                    style={[
                                        styles.button,
                                        { backgroundColor: bgColor },
                                        isSecondary && { borderWidth: 1, borderColor: c.border }
                                    ]}
                                    onPress={() => handleButtonPress(btn.onPress)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[
                                        styles.buttonText,
                                        { color: textColor }
                                    ]}>
                                        {btn.text}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>
            </Modal>
        </Portal>
    );
}

const styles = StyleSheet.create({
    modalOverlay: {
        justifyContent: 'flex-end',
        margin: 0,
    },
    modalContainer: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderWidth: 1,
        borderBottomWidth: 0,
        marginHorizontal: 0,
    },
    dragIndicator: {
        width: 40,
        height: 5,
        backgroundColor: '#D1D1D6',
        borderRadius: 3,
        alignSelf: 'center',
        marginTop: 12,
        marginBottom: 8,
    },
    content: {
        paddingHorizontal: 24,
        paddingTop: 12,
        alignItems: 'center',
    },
    iconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    title: {
        fontSize: 22,
        fontFamily: 'Inter_700Bold',
        marginBottom: 12,
        textAlign: 'center',
        letterSpacing: -0.5,
    },
    description: {
        fontSize: 15,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 32,
        paddingHorizontal: 10,
    },
    buttonContainer: {
        flexDirection: 'row',
        width: '100%',
        gap: 12,
        flexWrap: 'wrap',
    },
    button: {
        flex: 1,
        minWidth: '45%',
        height: 56,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    buttonText: {
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
    },
});
