/**
 * Customer Cancellation Confirmation Screen
 * 
 * Shows confirmation after customer successfully cancels their order.
 * Displays refund status and next steps.
 */

import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, Surface, useTheme, Card } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { formatCustomerCancellationReason, CustomerCancellationReason } from '../../services/cancellationService';

interface RouteParams {
    deliveryId: string;
    reason: CustomerCancellationReason;
    reasonDetails?: string;
    refundStatus: 'PENDING' | 'APPROVED';
}

export default function CustomerCancellationConfirmScreen() {
    const theme = useTheme();
    const navigation = useNavigation<any>();
    const route = useRoute();
    const params = route.params as RouteParams || {
        deliveryId: 'DEMO-123',
        reason: CustomerCancellationReason.CHANGED_MIND,
        refundStatus: 'PENDING',
    };

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            contentContainerStyle={styles.content}
        >
            {/* Success Icon */}
            <View style={styles.iconSection}>
                <Surface
                    style={[styles.iconContainer, { backgroundColor: theme.dark ? '#1B5E20' : '#E8F5E9' }]}
                    elevation={0}
                >
                    <MaterialCommunityIcons name="check-circle" size={64} color="#4CAF50" />
                </Surface>
                <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onSurface }]}>
                    Order Cancelled
                </Text>
                <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
                    Your order has been successfully cancelled
                </Text>
            </View>

            {/* Order Details Card */}
            <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="elevated">
                <Card.Content>
                    <View style={styles.detailRow}>
                        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                            Order ID
                        </Text>
                        <Text variant="bodyMedium" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>
                            {params.deliveryId}
                        </Text>
                    </View>
                    <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />
                    <View style={styles.detailRow}>
                        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                            Reason
                        </Text>
                        <Text variant="bodyMedium" style={{ fontWeight: 'bold', color: theme.colors.onSurface }}>
                            {formatCustomerCancellationReason(params.reason)}
                        </Text>
                    </View>
                    {params.reasonDetails && (
                        <>
                            <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />
                            <View style={styles.detailRow}>
                                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                                    Details
                                </Text>
                                <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, flex: 1, textAlign: 'right' }}>
                                    {params.reasonDetails}
                                </Text>
                            </View>
                        </>
                    )}
                </Card.Content>
            </Card>

            {/* Refund Status Card */}
            <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="elevated">
                <Card.Content>
                    <View style={styles.refundHeader}>
                        <MaterialCommunityIcons name="cash-refund" size={24} color={theme.colors.primary} />
                        <Text variant="titleMedium" style={{ marginLeft: 8, fontWeight: 'bold', color: theme.colors.onSurface }}>
                            Refund Status
                        </Text>
                    </View>

                    <Surface
                        style={[
                            styles.refundBadge,
                            { backgroundColor: params.refundStatus === 'APPROVED' ? '#E8F5E9' : '#FFF3E0' }
                        ]}
                        elevation={0}
                    >
                        <MaterialCommunityIcons
                            name={params.refundStatus === 'APPROVED' ? 'check-circle' : 'clock-outline'}
                            size={20}
                            color={params.refundStatus === 'APPROVED' ? '#4CAF50' : '#FF9800'}
                        />
                        <Text
                            variant="labelLarge"
                            style={{
                                marginLeft: 8,
                                color: params.refundStatus === 'APPROVED' ? '#4CAF50' : '#FF9800',
                                fontWeight: 'bold',
                            }}
                        >
                            {params.refundStatus === 'APPROVED' ? 'Refund Approved' : 'Refund Pending'}
                        </Text>
                    </Surface>

                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>
                        {params.refundStatus === 'APPROVED'
                            ? 'Your refund has been approved and will be processed within 24 hours.'
                            : 'Your refund request is being processed. This typically takes 3-5 business days.'}
                    </Text>
                </Card.Content>
            </Card>

            {/* Next Steps Card */}
            <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={{ fontWeight: 'bold', marginBottom: 12, color: theme.colors.onSurface }}>
                        What's Next?
                    </Text>

                    <View style={styles.stepRow}>
                        <View style={[styles.stepNumber, { backgroundColor: theme.colors.primaryContainer }]}>
                            <Text variant="labelSmall" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>1</Text>
                        </View>
                        <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface }}>
                            You'll receive an email confirmation shortly
                        </Text>
                    </View>

                    <View style={styles.stepRow}>
                        <View style={[styles.stepNumber, { backgroundColor: theme.colors.primaryContainer }]}>
                            <Text variant="labelSmall" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>2</Text>
                        </View>
                        <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface }}>
                            Refund will be credited to your original payment method
                        </Text>
                    </View>

                    <View style={styles.stepRow}>
                        <View style={[styles.stepNumber, { backgroundColor: theme.colors.primaryContainer }]}>
                            <Text variant="labelSmall" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>3</Text>
                        </View>
                        <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface }}>
                            If a rider was assigned, they've been notified
                        </Text>
                    </View>
                </Card.Content>
            </Card>

            {/* Actions */}
            <View style={styles.actions}>
                <Button
                    mode="contained"
                    onPress={() => navigation.navigate('CustomerApp')}
                    style={styles.button}
                    icon="home"
                >
                    Back to Home
                </Button>
                <Button
                    mode="outlined"
                    onPress={() => navigation.navigate('BookService')}
                    style={styles.button}
                    icon="package-variant"
                >
                    New Delivery
                </Button>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        padding: 20,
        paddingBottom: 40,
    },
    iconSection: {
        alignItems: 'center',
        marginBottom: 24,
    },
    iconContainer: {
        width: 100,
        height: 100,
        borderRadius: 50,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        fontWeight: 'bold',
        marginBottom: 8,
    },
    card: {
        marginBottom: 16,
        borderRadius: 16,
    },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
    },
    divider: {
        height: 1,
        marginVertical: 4,
    },
    refundHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    refundBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        alignSelf: 'flex-start',
    },
    stepRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    stepNumber: {
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    actions: {
        marginTop: 8,
        gap: 12,
    },
    button: {
        paddingVertical: 4,
    },
});
