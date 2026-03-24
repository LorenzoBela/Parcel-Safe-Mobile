import React from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions } from 'react-native';
import { Modal, Portal, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type StatusBarStyle = 'dark-content' | 'light-content';
type ColorPalette = {
    bg: string; card: string; border: string;
    textPrimary: string; textSecondary: string; textTertiary: string;
    accent: string; red: string; green: string; orange: string;
    pillBg: string; modalBg: string; statusBar: StatusBarStyle;
};

// Fallback colors matching the Uber-style theme
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

interface ExitConfirmationModalProps {
    visible: boolean;
    onDismiss: () => void;
    onConfirm: () => void;
}

export default function ExitConfirmationModal({ visible, onDismiss, onConfirm }: ExitConfirmationModalProps) {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const insets = useSafeAreaInsets();

    return (
        <Portal>
            <Modal
                visible={visible}
                onDismiss={onDismiss}
                contentContainerStyle={[
                    styles.modalContainer,
                    { backgroundColor: c.card, borderColor: c.border, paddingBottom: Math.max(insets.bottom + 20, 20) }
                ]}
                style={styles.modalOverlay}
            >
                <View style={styles.dragIndicator} />

                <View style={styles.content}>
                    <View style={[styles.iconContainer, { backgroundColor: c.red + '15' }]}>
                        <MaterialCommunityIcons name="exit-run" size={32} color={c.red} />
                    </View>

                    <Text style={[styles.title, { color: c.textPrimary }]}>
                        Exit Parcel-Safe?
                    </Text>

                    <Text style={[styles.description, { color: c.textSecondary }]}>
                        Closing the app will <Text style={{ fontFamily: 'Inter_700Bold', color: c.textPrimary }}>completely stop background tracking</Text>. Are you sure you want to end your session?
                    </Text>

                    <View style={styles.buttonContainer}>
                        <TouchableOpacity
                            style={[styles.button, styles.cancelButton, { backgroundColor: c.pillBg, borderColor: c.border }]}
                            onPress={onDismiss}
                            activeOpacity={0.7}
                        >
                            <Text style={[styles.buttonText, { color: c.textPrimary }]}>Stay Online</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.button, styles.confirmButton, { backgroundColor: c.red }]}
                            onPress={onConfirm}
                            activeOpacity={0.7}
                        >
                            <MaterialCommunityIcons name="power" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                            <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>Exit App</Text>
                        </TouchableOpacity>
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
    },
    button: {
        flex: 1,
        height: 56,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'row',
    },
    cancelButton: {
        borderWidth: 1,
    },
    confirmButton: {
        // Red button
    },
    buttonText: {
        fontSize: 16,
        fontFamily: 'Inter_700Bold',
    },
});
