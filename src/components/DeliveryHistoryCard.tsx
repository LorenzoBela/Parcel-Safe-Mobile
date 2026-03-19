import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DeliveryHistoryItem, DeliveryViewMode } from '../types/deliveryHistory';
import { getDeliveryStatusColor } from '../utils/deliveryHistory';

type CardColors = {
    card: string;
    text: string;
    textSec: string;
    accent: string;
    border: string;
    divider: string;
};

type Props = {
    item: DeliveryHistoryItem;
    viewMode: DeliveryViewMode;
    colors: CardColors;
    showRider?: boolean;
    onPress: () => void;
};

export default function DeliveryHistoryCard({
    item,
    viewMode,
    colors,
    showRider = false,
    onPress,
}: Props) {
    const statusColor = getDeliveryStatusColor(item.status);

    if (viewMode === 'grid') {
        return (
            <TouchableOpacity
                activeOpacity={0.7}
                onPress={onPress}
                style={[styles.gridCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
                <View style={{ padding: 12 }}>
                    <Text variant="labelLarge" style={{ fontWeight: 'bold', fontSize: 12, color: colors.text }} numberOfLines={1}>
                        {item.shortTrk}
                    </Text>
                    <Text variant="bodySmall" style={{ color: colors.textSec, fontSize: 10, marginBottom: 8 }}>
                        {item.date}
                    </Text>

                    <Text variant="titleMedium" style={{ fontWeight: 'bold', color: colors.accent, marginBottom: 4 }}>
                        {item.earnings}
                    </Text>

                    <View style={[styles.divider, { backgroundColor: colors.divider }]} />

                    <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text, fontWeight: 'bold' }}>
                        {item.customerName}
                    </Text>
                    {showRider ? (
                        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textSec, marginTop: 2 }}>
                            Rider: {item.riderName}
                        </Text>
                    ) : null}

                    <View style={{ marginTop: 8 }}>
                        <View style={{ backgroundColor: `${statusColor}20`, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, alignSelf: 'flex-start' }}>
                            <Text style={{ color: statusColor, fontWeight: 'bold', fontSize: 9 }}>
                                {item.status}
                            </Text>
                        </View>
                    </View>
                </View>
            </TouchableOpacity>
        );
    }

    return (
        <TouchableOpacity
            activeOpacity={0.7}
            onPress={onPress}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
            <View style={styles.cardHeader}>
                <View style={{ flex: 1, marginRight: 8 }}>
                    <Text variant="titleMedium" style={{ fontWeight: 'bold', color: colors.text }} numberOfLines={1}>
                        {item.shortTrk}
                    </Text>
                    <Text variant="bodySmall" style={{ color: colors.textSec }}>
                        {item.date} • {item.time}
                    </Text>
                </View>
                <View style={{ alignItems: 'flex-end', minWidth: 80 }}>
                    <Text variant="titleMedium" style={{ fontWeight: 'bold', color: colors.accent }}>
                        {item.earnings}
                    </Text>
                    <View style={{ backgroundColor: `${statusColor}20`, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 2 }}>
                        <Text style={{ color: statusColor, fontWeight: 'bold', fontSize: 10 }}>
                            {item.status}
                        </Text>
                    </View>
                </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.divider }]} />

            <View style={styles.row}>
                <View style={styles.iconBox}>
                    <MaterialCommunityIcons name="account" size={16} color={colors.textSec} />
                </View>
                <Text variant="bodyMedium" style={[styles.rowText, { color: colors.text, fontWeight: '600' }]}>
                    {item.customerName}
                </Text>
            </View>

            {showRider ? (
                <View style={styles.row}>
                    <View style={styles.iconBox}>
                        <MaterialCommunityIcons name="motorbike" size={16} color={colors.textSec} />
                    </View>
                    <Text variant="bodySmall" numberOfLines={1} style={[styles.rowText, { color: colors.textSec }]}> 
                        Rider: {item.riderName}
                    </Text>
                </View>
            ) : null}

            <View style={[styles.row, { alignItems: 'flex-start' }]}>
                <View style={[styles.iconBox, { marginTop: 2 }]}>
                    <MaterialCommunityIcons name="map-marker-up" size={16} color="#4CAF50" />
                </View>
                <Text variant="bodySmall" numberOfLines={2} style={[styles.rowText, { color: colors.text }]}> 
                    {item.pickup}
                </Text>
            </View>

            <View style={[styles.row, { alignItems: 'flex-start' }]}>
                <View style={[styles.iconBox, { marginTop: 2 }]}>
                    <MaterialCommunityIcons name="map-marker-down" size={16} color="#F44336" />
                </View>
                <Text variant="bodySmall" numberOfLines={2} style={[styles.rowText, { color: colors.text }]}> 
                    {item.dropoff}
                </Text>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        marginBottom: 12,
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
    },
    gridCard: {
        marginBottom: 12,
        borderRadius: 12,
        width: '48%',
        borderWidth: 1,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    divider: {
        height: 1,
        marginBottom: 12,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    iconBox: {
        width: 24,
        alignItems: 'center',
        marginRight: 8,
    },
    rowText: {
        flex: 1,
    },
});
