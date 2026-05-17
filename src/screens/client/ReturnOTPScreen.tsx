import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface, IconButton, Button, useTheme } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReturnOtpDisplay from '../../components/ReturnOtpDisplay';

interface ReturnOtpRouteParams {
    returnOtp?: string;
    returnOtpIssuedAt?: number;
    deliveryId?: string;
}

export default function ReturnOTPScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const theme = useTheme();
    const insets = useSafeAreaInsets();

    const params = (route.params || {}) as ReturnOtpRouteParams;
    const hasOtp = typeof params.returnOtp === 'string' && params.returnOtp.length > 0;

    const issuedText = useMemo(() => {
        if (typeof params.returnOtpIssuedAt !== 'number' || !Number.isFinite(params.returnOtpIssuedAt)) {
            return null;
        }
        const date = new Date(params.returnOtpIssuedAt);
        if (Number.isNaN(date.getTime())) return null;
        return date.toLocaleString('en-US', {
            timeZone: 'Asia/Manila',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        });
    }, [params.returnOtpIssuedAt]);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
            <View style={styles.header}>
                <IconButton icon="arrow-left" size={24} onPress={() => navigation.goBack()} />
                <Text variant="titleMedium" style={{ fontFamily: 'Inter_700Bold', color: theme.colors.onSurface }}>
                    Return OTP
                </Text>
                <View style={{ width: 40 }} />
            </View>

            <Surface style={[styles.infoCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
                <View style={styles.infoHeader}>
                    <MaterialCommunityIcons name="shield-key-outline" size={22} color={theme.colors.primary} />
                    <Text style={{ marginLeft: 8, fontFamily: 'Inter_700Bold', color: theme.colors.onSurface }}>
                        Return Authorization
                    </Text>
                </View>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>
                    Use this code on the smart box when the rider reaches the pickup location.
                </Text>
                {issuedText && (
                    <Text style={{ marginTop: 8, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
                        Issued: {issuedText}
                    </Text>
                )}
            </Surface>

            {hasOtp ? (
                <ReturnOtpDisplay otp={params.returnOtp as string} issuedAt={params.returnOtpIssuedAt} />
            ) : (
                <Surface style={[styles.emptyState, { backgroundColor: theme.colors.surface }]} elevation={1}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={24} color={theme.colors.error} />
                    <Text style={{ marginTop: 8, color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
                        Return OTP is not available yet.
                    </Text>
                    <Button
                        mode="contained"
                        style={{ marginTop: 12 }}
                        onPress={() => navigation.goBack()}
                    >
                        Go Back
                    </Button>
                </Surface>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: 20,
        paddingBottom: 24,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 12,
        paddingBottom: 8,
    },
    infoCard: {
        padding: 16,
        borderRadius: 16,
        marginBottom: 16,
    },
    infoHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    emptyState: {
        padding: 20,
        borderRadius: 16,
        alignItems: 'center',
    },
});
