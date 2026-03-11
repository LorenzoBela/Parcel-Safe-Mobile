import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native';
import { Surface, Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import dayjs from 'dayjs';

interface EarningsWidgetProps {
    riderId: string;
    dailyGoal?: number; // Default to 1500 if not provided
}

export default function EarningsWidget({ riderId, dailyGoal: initialDailyGoal = 1500 }: EarningsWidgetProps) {
    const theme = useTheme();
    const [earnings, setEarnings] = useState<number>(0);
    const [completedTrips, setCompletedTrips] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(true);
    const [dailyGoal, setDailyGoal] = useState<number>(initialDailyGoal);
    const [isEditingGoal, setIsEditingGoal] = useState(false);
    const [tempGoalInput, setTempGoalInput] = useState<string>('');

    // Load saved goal on mount
    useEffect(() => {
        const loadGoal = async () => {
            try {
                const savedGoal = await AsyncStorage.getItem(`@daily_goal_${riderId}`);
                if (savedGoal) {
                    setDailyGoal(Number(savedGoal));
                }
            } catch (err) {
                console.error('[EarningsWidget] Failed to load daily goal', err);
            }
        };
        loadGoal();
    }, [riderId]);

    const handleSaveGoal = async () => {
        const newGoal = Number(tempGoalInput.replace(/[^0-9]/g, ''));
        if (newGoal > 0) {
            setDailyGoal(newGoal);
            try {
                await AsyncStorage.setItem(`@daily_goal_${riderId}`, newGoal.toString());
            } catch (err) {
                console.error('[EarningsWidget] Failed to save daily goal', err);
            }
        }
        setIsEditingGoal(false);
    };

    const fetchTodayEarnings = async () => {
        if (!riderId) return;
        setIsLoading(true);
        try {
            // Get start and end of current local day in ISO string format
            const startOfDay = dayjs().startOf('day').toISOString();
            const endOfDay = dayjs().endOf('day').toISOString();

            // Query Supabase for COMPLETED deliveries by this rider today
            // Note: Assuming 'rider_fee' is the column name for the rider's cut.
            // If it's just 'price' or another name, adjust below.
            const { data, error } = await supabase
                .from('deliveries')
                .select('price') // Change 'price' to 'rider_fee' if such column exists instead
                .eq('rider_id', riderId)
                .eq('status', 'COMPLETED')
                .gte('created_at', startOfDay)
                .lte('created_at', endOfDay);

            if (error) throw error;

            if (data) {
                const total = data.reduce((sum, row) => sum + (Number(row.price) || 0), 0);
                setEarnings(total);
                setCompletedTrips(data.length);
            }
        } catch (error) {
            console.error('[EarningsWidget] Error fetching earnings:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchTodayEarnings();

        // Listen for new completed deliveries in real-time to update the widget live!
        const subscription = supabase
            .channel('public:deliveries')
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'deliveries',
                    filter: `rider_id=eq.${riderId}`,
                },
                (payload) => {
                    if (payload.new && payload.new.status === 'COMPLETED') {
                        // Refresh earnings when a delivery completes
                        fetchTodayEarnings();
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(subscription);
        };
    }, [riderId]);

    const progress = Math.min(earnings / dailyGoal, 1);
    const isGoalMet = earnings >= dailyGoal;

    const formatCurrency = (amount: number) => `₱${amount.toFixed(0)}`;

    return (
        <Surface style={styles.container} elevation={1}>
            <View style={styles.header}>
                <View style={styles.headerLeft}>
                    <MaterialCommunityIcons name="wallet-outline" size={20} color={theme.colors.onSurfaceVariant} />
                    <Text variant="labelLarge" style={[styles.title, { color: theme.colors.onSurfaceVariant }]}>
                        Today's Earnings
                    </Text>
                </View>
                {!isLoading && (
                    <Text variant="labelMedium" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
                        {completedTrips} Trips
                    </Text>
                )}
            </View>

            {isLoading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                </View>
            ) : (
                <View style={styles.content}>
                    <View style={styles.earningsWrapper}>
                        <Text variant="headlineMedium" style={[styles.amount, { color: isGoalMet ? '#4CAF50' : theme.colors.onSurface }]}>
                            {formatCurrency(earnings)}
                        </Text>
                        
                        {isEditingGoal ? (
                            <View style={styles.editGoalContainer}>
                                <Text variant="bodySmall" style={styles.goalText}>/ ₱</Text>
                                <TextInput
                                    style={[styles.goalInput, { color: theme.colors.onSurface }]}
                                    value={tempGoalInput}
                                    onChangeText={setTempGoalInput}
                                    keyboardType="numeric"
                                    autoFocus
                                    onSubmitEditing={handleSaveGoal}
                                    onBlur={handleSaveGoal}
                                />
                            </View>
                        ) : (
                            <TouchableOpacity
                                style={styles.editableGoal}
                                onPress={() => {
                                    setTempGoalInput(dailyGoal.toString());
                                    setIsEditingGoal(true);
                                }}
                            >
                                <Text variant="bodySmall" style={styles.goalText}>
                                    / {formatCurrency(dailyGoal)}
                                </Text>
                                <MaterialCommunityIcons name="pencil" size={12} color="#888" style={{ marginLeft: 4 }} />
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Custom Linear Progress Bar to simulate a goal tracker */}
                    <View style={styles.progressTrack}>
                        <View
                            style={[
                                styles.progressFill,
                                {
                                    width: `${progress * 100}%`,
                                    backgroundColor: isGoalMet ? '#4CAF50' : theme.colors.primary,
                                }
                            ]}
                        />
                    </View>
                    <View style={styles.progressFooter}>
                        <Text variant="labelSmall" style={{ color: theme.colors.outline }}>0</Text>
                        {isGoalMet && (
                            <View style={styles.goalMetBadge}>
                                <MaterialCommunityIcons name="check-decagram" size={14} color="#4CAF50" />
                                <Text variant="labelSmall" style={{ color: '#4CAF50', marginLeft: 4, fontWeight: 'bold' }}>Goal Met!</Text>
                            </View>
                        )}
                        <Text variant="labelSmall" style={{ color: theme.colors.outline }}>Daily Goal</Text>
                    </View>
                </View>
            )}
        </Surface>
    );
}

const styles = StyleSheet.create({
    container: {
        marginTop: 16,
        marginBottom: 8,
        padding: 16,
        borderRadius: 16,
        backgroundColor: '#FFFFFF',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        marginLeft: 8,
        fontWeight: 'bold',
    },
    loadingContainer: {
        height: 60,
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {},
    earningsWrapper: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginBottom: 12,
    },
    amount: {
        fontWeight: '900',
    },
    editableGoal: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
        paddingHorizontal: 4,
    },
    editGoalContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#ccc',
        marginLeft: 4,
    },
    goalInput: {
        fontSize: 14,
        fontWeight: 'bold',
        padding: 0,
        margin: 0,
        height: 20,
        minWidth: 40,
    },
    goalText: {
        marginLeft: 4,
        color: '#888',
        fontWeight: 'bold',
    },
    progressTrack: {
        height: 8,
        backgroundColor: '#F0F0F0',
        borderRadius: 4,
        overflow: 'hidden',
        marginBottom: 8,
    },
    progressFill: {
        height: '100%',
        borderRadius: 4,
    },
    progressFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    goalMetBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#E8F5E9',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 12,
    }
});
