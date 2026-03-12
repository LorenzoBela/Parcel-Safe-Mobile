import React, { useState, useMemo } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Linking, Platform, Alert, Animated, TextInput, Text, ListRenderItem } from 'react-native';
import { useEntryAnimation, useStaggerAnimation } from '../../hooks/useEntryAnimation';
import { Card, Button, Chip, Surface, IconButton, Badge } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAppTheme } from '../../context/ThemeContext';
import CancellationModal from '../../components/modals/CancellationModal';
import { requestCancellation, CancellationReason } from '../../services/cancellationService';
import useAuthStore from '../../store/authStore';
import { supabase } from '../../services/supabaseClient';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

dayjs.extend(utc);
dayjs.extend(timezone);
const PH_TIMEZONE = 'Asia/Manila';

// Copied from RiderDashboard — fixes double-shifted timestamps from Supabase
const formatTimeWithHeuristic = (timeStr: string) => {
    if (!timeStr || timeStr === '--:--') return '--:--';
    if (timeStr.startsWith('T') && timeStr.includes(':')) {
        const cleanTime = timeStr.substring(1).split('.')[0];
        const dummyDate = dayjs(`2000-01-01T${cleanTime}`);
        if (dummyDate.isValid()) return dummyDate.format('h:mm A');
        return cleanTime;
    }
    const d = dayjs(timeStr);
    if (!d.isValid()) return timeStr;
    let phTime = d.tz(PH_TIMEZONE);
    const now = dayjs().tz(PH_TIMEZONE);
    if (phTime.diff(now, 'hour') > 2) {
        phTime = phTime.subtract(8, 'hour');
    }
    return phTime.format('h:mm A');
};

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PremiumAlert } from '../../services/PremiumAlertService';

const lightC = {
    bg: '#FFFFFF', card: '#FFFFFF', search: '#F2F2F7',
    text: '#000000', textSec: '#6B6B6B', textTer: '#AEAEB2',
    border: '#E5E5EA', accent: '#000000', accentText: '#FFFFFF',
    divider: '#F2F2F7',
    greenBg: '#ECFDF5', greenText: '#059669',
    redBg: '#FEF2F2', redText: '#DC2626',
    orangeBg: '#FFF7ED', orangeText: '#EA580C',
    blueBg: '#EFF6FF', blueText: '#2563EB',
    pillBg: '#F2F2F7'
};

const darkC = {
    bg: '#000000', card: '#1C1C1E', search: '#2C2C2E',
    text: '#FFFFFF', textSec: '#8E8E93', textTer: '#636366',
    border: '#38383A', accent: '#FFFFFF', accentText: '#000000',
    divider: '#2C2C2E',
    greenBg: '#052E16', greenText: '#4ADE80',
    redBg: '#450A0A', redText: '#FCA5A5',
    orangeBg: '#431407', orangeText: '#FDBA74',
    blueBg: '#172554', blueText: '#93C5FD',
    pillBg: '#1C1C1E'
};

export default function AssignedDeliveriesScreen() {
    const { isDarkMode } = useAppTheme();
    const c = isDarkMode ? darkC : lightC;
    const navigation = useNavigation<any>();
    const insets = useSafeAreaInsets();
    const [searchQuery, setSearchQuery] = useState('');

    const [filter, setFilter] = useState('All');
    const [dateFilter, setDateFilter] = useState('All');
    const [showFilters, setShowFilters] = useState(false);

    // Custom Date Range State
    const [customStartDate, setCustomStartDate] = useState<Date>(new Date());
    const [customEndDate, setCustomEndDate] = useState<Date>(new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [datePickerMode, setDatePickerMode] = useState<'start' | 'end'>('start');

    const [refreshing, setRefreshing] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    // Cancellation State
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [selectedDelivery, setSelectedDelivery] = useState<any>(null);
    const [cancelLoading, setCancelLoading] = useState(false);

    // Data State
    const [deliveries, setDeliveries] = useState<any[]>([]);

    // Auth
    const authedUserId = useAuthStore((state: any) => state.user?.userId) as string | undefined;

    const onChangeSearch = query => setSearchQuery(query);

    const fetchDeliveries = async () => {
        if (!authedUserId) return;
        setRefreshing(true);
        try {
            const { data, error } = await supabase
                .from('deliveries')
                .select('*, customer:profiles!deliveries_customer_id_fkey(full_name, phone_number)')
                .eq('rider_id', authedUserId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching deliveries:', error);
                PremiumAlert.alert('Error', 'Failed to fetch deliveries');
            } else {
                const mapped = data.map((d: any) => ({
                    id: d.id,
                    trk: d.tracking_number,
                    status: d.status,
                    customer: d.customer?.full_name || 'Unknown',
                    phone: d.customer?.phone_number || 'N/A',
                    address: d.dropoff_address,
                    pickupAddress: d.pickup_address,
                    lat: d.dropoff_lat,
                    lng: d.dropoff_lng,
                    pickupLat: d.pickup_lat,
                    pickupLng: d.pickup_lng,
                    dropoffLat: d.dropoff_lat,
                    dropoffLng: d.dropoff_lng,
                    snappedPickupLat: d.snapped_pickup_lat,
                    snappedPickupLng: d.snapped_pickup_lng,
                    snappedDropoffLat: d.snapped_dropoff_lat,
                    snappedDropoffLng: d.snapped_dropoff_lng,
                    date: d.created_at,
                    time: d.accepted_at
                        ? formatTimeWithHeuristic(d.accepted_at)
                        : (d.created_at ? formatTimeWithHeuristic(d.created_at) : '--:--'),
                    distance: d.distance ? `${d.distance.toFixed(1)} km` : '--',
                    fare: d.estimated_fare ? `₱${d.estimated_fare}` : '--',
                    earnings: d.estimated_fare ? `₱${d.estimated_fare}` : '--',
                    estimatedTime: (() => {
                        const durationSec: number | null = d.duration
                            ? d.duration
                            : d.distance
                                ? Math.round((d.distance / 30) * 3600)
                                : null;
                        if (!durationSec) return '-- min';
                        const mins = Math.round(durationSec / 60);
                        const display = mins >= 60
                            ? `${Math.floor(mins / 60)}h ${mins % 60}m`
                            : `${mins} min`;
                        const arrival = new Date(Date.now() + durationSec * 1000);
                        const arrivalStr = arrival.toLocaleTimeString('en-US', {
                            timeZone: 'Asia/Manila',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                        });
                        return `${d.duration ? '' : '~'}${display} (Arrives ~${arrivalStr})`;
                    })(),
                    boxId: d.assigned_box_id || d.box_id,
                    pickupTime: d.created_at,
                    dropoffTime: d.accepted_at || d.created_at,
                    acceptedAt: d.accepted_at,
                    deliveredAt: d.delivered_at,
                    pickedUpAt: d.picked_up_at,
                    packageType: 'Standard',
                    weight: 'N/A',
                    priority: 'Standard',
                    specialInstructions: d.package_description || '',
                    senderName: d.sender_name,
                    senderPhone: d.sender_phone,
                    recipientName: d.recipient_name,
                    deliveryNotes: d.delivery_notes,
                }));
                setDeliveries(mapped);
            }
        } catch (err) {
            console.error('Unexpected error fetching deliveries:', err);
        } finally {
            setRefreshing(false);
        }
    };

    React.useEffect(() => {
        fetchDeliveries();
    }, [authedUserId]);

    const onRefresh = () => {
        fetchDeliveries();
    };

    const openGoogleMaps = async (lat, lng, address) => {
        if (!lat || !lng) {
            PremiumAlert.alert('Error', 'Location coordinates missing for this delivery.');
            return;
        }

        const encodedAddress = encodeURIComponent(address || 'Destination');
        const latLng = `${lat},${lng}`;
        const browserUrl = `https://www.google.com/maps/dir/?api=1&destination=${latLng}&travelmode=driving`;

        const primaryUrl = Platform.select({
            ios: `maps:?ll=${latLng}&q=${encodedAddress}`,
            android: `google.navigation:q=${latLng}&mode=d`,
        })!;
        const fallbackUrl = Platform.select({
            ios: `https://maps.apple.com/?ll=${latLng}&q=${encodedAddress}`,
            android: `geo:${latLng}?q=${latLng}(${encodedAddress})`,
        })!;

        try {
            const supported = await Linking.canOpenURL(primaryUrl);
            if (supported) {
                await Linking.openURL(primaryUrl);
            } else {
                await Linking.openURL(fallbackUrl);
            }
        } catch (error) {
            console.error('[AssignedDeliveries] Failed to open maps:', error);
            try {
                await Linking.openURL(browserUrl);
            } catch (browserError) {
                console.error('[AssignedDeliveries] Browser fallback also failed:', browserError);
            }
        }
    };

    const handleCancellationSubmit = async (reason: CancellationReason, details: string) => {
        if (!selectedDelivery) return;

        setCancelLoading(true);
        try {
            const result = await requestCancellation({
                deliveryId: selectedDelivery.id,
                boxId: 'BOX_001',
                reason,
                reasonDetails: details,
                riderId: authedUserId ?? 'RIDER_001',
                riderName: 'Juan Dela Cruz',
                currentStatus: selectedDelivery.status,
            });

            if (result.success) {
                setShowCancelModal(false);
                setSelectedDelivery(null);
                PremiumAlert.alert('Success', 'Delivery cancelled successfully.');
                fetchDeliveries();
            } else {
                PremiumAlert.alert('Error', result.error || 'Cancellation failed');
            }
        } catch (error) {
            PremiumAlert.alert('Error', 'An unexpected error occurred');
        } finally {
            setCancelLoading(false);
        }
    };

    const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
        setShowDatePicker(Platform.OS === 'ios');
        if (selectedDate) {
            if (datePickerMode === 'start') {
                setCustomStartDate(selectedDate);
                if (dayjs(selectedDate).isAfter(dayjs(customEndDate))) {
                    setCustomEndDate(selectedDate);
                }
            } else {
                setCustomEndDate(selectedDate);
                if (dayjs(selectedDate).isBefore(dayjs(customStartDate))) {
                    setCustomStartDate(selectedDate);
                }
            }
        }
    };

    const showDateMode = (mode: 'start' | 'end') => {
        setDatePickerMode(mode);
        setShowDatePicker(true);
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'COMPLETED':
            case 'RETURNED': return c.greenText;
            case 'ASSIGNED':
            case 'IN_TRANSIT': return c.blueText;
            case 'PENDING':
            case 'ARRIVED': return c.orangeText;
            case 'CANCELLED': return c.textSec;
            case 'TAMPERED':
            case 'RETURNING': return c.redText;
            default: return c.textSec;
        }
    };

    const getStatusTheme = (status) => {
        const color = getStatusColor(status);
        let bg = color + '1A';
        if (color === c.greenText) bg = c.greenBg;
        else if (color === c.blueText) bg = c.blueBg;
        else if (color === c.orangeText) bg = c.orangeBg;
        else if (color === c.redText) bg = c.redBg;
        return { bg, text: color };
    };

    const filteredDeliveries = useMemo(() => deliveries.filter(item => {
        const matchesSearch = item.trk.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.customer.toLowerCase().includes(searchQuery.toLowerCase());

        let matchesStatus = true;
        if (filter !== 'All') {
            matchesStatus = item.status === filter;
        }

        let matchesDate = true;
        const itemDate = dayjs(item.date);
        const today = dayjs();

        if (dateFilter === 'Today') {
            matchesDate = itemDate.isSame(today, 'day');
        } else if (dateFilter === 'Tomorrow') {
            matchesDate = itemDate.isSame(today.add(1, 'day'), 'day');
        } else if (dateFilter === 'Week') {
            matchesDate = itemDate.isAfter(today.startOf('week').subtract(1, 'day')) && itemDate.isBefore(today.endOf('week').add(1, 'day'));
        } else if (dateFilter === 'Custom') {
            matchesDate = itemDate.isAfter(dayjs(customStartDate).subtract(1, 'day'), 'day') &&
                itemDate.isBefore(dayjs(customEndDate).add(1, 'day'), 'day');
        }

        return matchesSearch && matchesStatus && matchesDate;
    }), [deliveries, searchQuery, filter, dateFilter, customStartDate, customEndDate]);

    const listAnim = useStaggerAnimation(20, 60, 160);

    const renderItem: ListRenderItem<any> = ({ item, index }) => {
        const isPickup = !['PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'RETURNING', 'RETURNED'].includes(item.status);
        const rowAnim = listAnim[Math.min(index, listAnim.length - 1)];
        const sc = getStatusTheme(item.status);

        return (
            <Animated.View style={rowAnim.style}>
                <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
                    <TouchableOpacity activeOpacity={0.8} onPress={() => navigation.navigate('JobDetail', { job: { ...item, id: item.id } })}>
                        <View style={{ padding: 16 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                                <View style={{ flex: 1, marginRight: 8 }}>
                                    <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{item.customer}</Text>
                                    <Text style={{ fontSize: 12, color: c.textSec, marginTop: 2 }}>{item.trk}</Text>
                                </View>
                                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                                    <View style={[styles.statusPill, { backgroundColor: c.pillBg }]}>
                                        <Text style={{ fontSize: 11, fontWeight: '700', color: c.text }}>{item.distance}</Text>
                                    </View>
                                    <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                                        <Text style={{ fontSize: 11, fontWeight: '700', color: sc.text }}>{item.status.replace(/_/g, ' ')}</Text>
                                    </View>
                                </View>
                            </View>

                            <View style={[styles.divider, { backgroundColor: c.divider }]} />

                            {/* Pickup Section */}
                            <View style={{ marginBottom: 16 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                                    <View style={styles.locationDotContainer}>
                                        <MaterialCommunityIcons name="package-variant" size={14} color={c.textSec} />
                                    </View>
                                    <Text style={{ fontSize: 11, color: c.textSec, fontWeight: '700' }}>PICKUP</Text>
                                </View>
                                <View style={[styles.addressContainer, { backgroundColor: c.search }]}>
                                    <Text style={{ fontSize: 14, color: c.text, flex: 1 }} numberOfLines={1}>
                                        {item.pickupAddress || 'Pickup Address'}
                                    </Text>
                                    <TouchableOpacity
                                        style={[styles.navBtn, { backgroundColor: c.bg }]}
                                        onPress={() => openGoogleMaps(item.pickupLat, item.pickupLng, item.pickupAddress)}
                                    >
                                        <MaterialCommunityIcons name="navigation" size={18} color={c.text} />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {/* Dropoff Section */}
                            <View style={{ marginBottom: 12 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                                    <View style={styles.locationDotContainer}>
                                        <MaterialCommunityIcons name="map-marker" size={14} color={c.redText} />
                                    </View>
                                    <Text style={{ fontSize: 11, color: c.textSec, fontWeight: '700' }}>DROPOFF</Text>
                                </View>
                                <View style={[styles.addressContainer, { backgroundColor: c.search }]}>
                                    <Text style={{ fontSize: 14, color: c.text, flex: 1 }} numberOfLines={1}>
                                        {item.address}
                                    </Text>
                                    <TouchableOpacity
                                        style={[styles.navBtn, { backgroundColor: c.bg }]}
                                        onPress={() => openGoogleMaps(item.dropoffLat, item.dropoffLng, item.address)}
                                    >
                                        <MaterialCommunityIcons name="navigation" size={18} color={c.text} />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <View style={{ flexDirection: 'row', marginTop: 8, gap: 16 }}>
                                {!['CANCELLED', 'COMPLETED'].includes(item.status) && (
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <MaterialCommunityIcons name="clock-outline" size={16} color={c.textSec} />
                                        <Text style={{ marginLeft: 4, color: c.textSec, fontSize: 13, fontWeight: '600' }}>{item.estimatedTime || '-- min'}</Text>
                                    </View>
                                )}
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <MaterialCommunityIcons name="cash" size={16} color={c.textSec} />
                                    <Text style={{ marginLeft: 4, color: c.textSec, fontSize: 13, fontWeight: '600' }}>{item.earnings}</Text>
                                </View>
                            </View>
                        </View>
                    </TouchableOpacity>

                    <View style={[styles.cardActions, { paddingHorizontal: 16, paddingBottom: 16 }]}>
                        {['ASSIGNED', 'PENDING', 'IN_TRANSIT', 'ARRIVED', 'RETURNING', 'TAMPERED'].includes(item.status) && (
                            <TouchableOpacity
                                style={[styles.primaryBtn, { backgroundColor: c.accent, width: '100%', marginBottom: 10 }]}
                                onPress={() => {
                                    navigation.navigate('Arrival', {
                                        deliveryId: item.id,
                                        boxId: item.boxId,
                                        targetLat: isPickup ? (item.snappedPickupLat ?? item.pickupLat) : (item.snappedDropoffLat ?? item.dropoffLat),
                                        targetLng: isPickup ? (item.snappedPickupLng ?? item.pickupLng) : (item.snappedDropoffLng ?? item.dropoffLng),
                                        targetAddress: isPickup ? item.pickupAddress : item.address,
                                        customerPhone: item.phone,
                                        senderName: item.senderName,
                                        senderPhone: item.senderPhone,
                                        recipientName: item.recipientName,
                                        deliveryNotes: item.deliveryNotes,
                                        pickupLat: item.snappedPickupLat ?? item.pickupLat,
                                        pickupLng: item.snappedPickupLng ?? item.pickupLng,
                                        pickupAddress: item.pickupAddress,
                                        dropoffLat: item.snappedDropoffLat ?? item.dropoffLat,
                                        dropoffLng: item.snappedDropoffLng ?? item.dropoffLng,
                                        dropoffAddress: item.address,
                                        riderName: (useAuthStore.getState() as any).user?.fullName || 'Rider'
                                    });
                                }}
                                activeOpacity={0.8}
                            >
                                <MaterialCommunityIcons name="navigation" size={18} color={c.bg} />
                                <Text style={[styles.primaryBtnText, { color: c.bg }]}>
                                    {['IN_TRANSIT', 'ARRIVED', 'RETURNING', 'TAMPERED'].includes(item.status) ? 'Resume Trip' : 'Start Trip'}
                                </Text>
                            </TouchableOpacity>
                        )}

                        <View style={{ flexDirection: 'row', width: '100%', gap: 10 }}>
                            {(item.senderPhone || (item.phone && item.phone !== 'N/A')) && (
                                <TouchableOpacity
                                    style={[styles.secondaryBtn, { borderColor: c.border, flex: 1 }]}
                                    onPress={() => {
                                        const options: any[] = [];
                                        if (item.senderPhone) {
                                            options.push({ text: `Sender${item.senderName ? ` (${item.senderName})` : ''}`, onPress: () => Linking.openURL(`tel:${item.senderPhone}`) });
                                        }
                                        if (item.phone && item.phone !== 'N/A') {
                                            options.push({ text: `Recipient${item.recipientName ? ` (${item.recipientName})` : ''}`, onPress: () => Linking.openURL(`tel:${item.phone}`) });
                                        }
                                        options.push({ text: 'Cancel', style: 'cancel' });
                                        PremiumAlert.alert('Who do you want to call?', undefined, options);
                                    }}
                                >
                                    <MaterialCommunityIcons name="phone" size={16} color={c.text} />
                                    <Text style={[styles.secondaryBtnText, { color: c.text }]}>Call</Text>
                                </TouchableOpacity>
                            )}

                            {['ASSIGNED', 'PENDING', 'IN_TRANSIT'].includes(item.status) && (
                                <TouchableOpacity
                                    style={[styles.secondaryBtn, { backgroundColor: c.redBg, borderColor: 'transparent', flex: 1 }]}
                                    onPress={() => {
                                        setSelectedDelivery(item);
                                        setShowCancelModal(true);
                                    }}
                                >
                                    <MaterialCommunityIcons name="close" size={16} color={c.redText} />
                                    <Text style={[styles.secondaryBtnText, { color: c.redText }]}>Cancel</Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        {(item.status === 'COMPLETED' || item.status === 'CANCELLED') && (
                            <TouchableOpacity
                                style={[styles.secondaryBtn, { borderColor: c.border, width: '100%', marginTop: 10 }]}
                                onPress={() => navigation.navigate('DeliveryDetail', { delivery: item })}
                            >
                                <MaterialCommunityIcons name="history" size={16} color={c.text} />
                                <Text style={[styles.secondaryBtnText, { color: c.text }]}>View History</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </Animated.View>
        );
    };

    const renderGridItem: ListRenderItem<any> = ({ item, index }) => {
        const rowAnim = listAnim[Math.min(index, listAnim.length - 1)];
        const sc = getStatusTheme(item.status);

        return (
            <Animated.View style={rowAnim.style}>
                <TouchableOpacity activeOpacity={0.8} style={[styles.gridCard, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => navigation.navigate('JobDetail', { job: { ...item, id: item.id } })}>
                    <View style={{ padding: 12 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                            <View style={[styles.statusPill, { backgroundColor: sc.bg, alignSelf: 'flex-start' }]}>
                                <Text style={{ fontSize: 10, fontWeight: '700', color: sc.text }}>{item.status.replace(/_/g, ' ')}</Text>
                            </View>
                        </View>

                        <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }} numberOfLines={1}>{item.customer}</Text>
                        <Text style={{ fontSize: 11, color: c.textSec, marginBottom: 8 }} numberOfLines={1}>{item.trk}</Text>

                        <View style={[styles.divider, { backgroundColor: c.divider }]} />

                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                            <MaterialCommunityIcons name="map-marker" size={12} color={c.textSec} />
                            <Text style={{ fontSize: 11, marginLeft: 4, flex: 1, color: c.textSec }} numberOfLines={1}>{item.address}</Text>
                        </View>

                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                            <Text style={{ fontSize: 11, color: c.textSec, fontWeight: '500' }}>
                                {dayjs(item.date).tz(PH_TIMEZONE).format('M/D')} • {item.time}
                            </Text>
                            <Text style={{ fontSize: 11, color: c.textSec, fontWeight: '600' }}>{item.distance}</Text>
                        </View>
                    </View>
                </TouchableOpacity>
            </Animated.View>
        );
    };

    const headerAnim = useEntryAnimation(0);

    return (
        <Animated.View style={[styles.container, { backgroundColor: c.bg }, headerAnim.style]}>
            <View style={[styles.header, { backgroundColor: c.bg, borderBottomColor: c.border, paddingTop: Math.max(insets.top, 20) }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <View>
                        <Text style={{ fontSize: 26, fontWeight: '800', color: c.text }}>Assigned Deliveries</Text>
                        <Text style={{ fontSize: 14, color: c.textSec, marginTop: 4 }}>{dayjs().format('dddd, MMM D')}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', marginRight: 4 }}>
                        <TouchableOpacity style={[styles.iconBtn, { backgroundColor: c.pillBg }]} onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}>
                            <MaterialCommunityIcons name={viewMode === 'list' ? 'view-grid' : 'view-list'} size={24} color={c.text} />
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.iconBtn, { backgroundColor: showFilters ? c.text : c.pillBg, marginLeft: 8 }]} onPress={() => setShowFilters(!showFilters)}>
                            <MaterialCommunityIcons name={showFilters ? 'filter-off' : 'filter'} size={24} color={showFilters ? c.bg : c.text} />
                        </TouchableOpacity>
                    </View>
                </View>

                <View style={[styles.searchContainer, { backgroundColor: c.search }]}>
                    <MaterialCommunityIcons name="magnify" size={20} color={c.textSec} style={{ marginRight: 8 }} />
                    <TextInput
                        placeholder="Search tracking # or customer"
                        placeholderTextColor={c.textTer}
                        onChangeText={onChangeSearch}
                        value={searchQuery}
                        style={{ flex: 1, color: c.text, fontSize: 15, height: 40, padding: 0 }}
                        clearButtonMode="while-editing"
                        returnKeyType="search"
                    />
                    {searchQuery.length > 0 && Platform.OS === 'android' && (
                        <TouchableOpacity onPress={() => onChangeSearch('')}>
                            <MaterialCommunityIcons name="close-circle" size={18} color={c.textTer} />
                        </TouchableOpacity>
                    )}
                </View>

                {/* Collapsible Filters */}
                {showFilters && (
                    <View style={[styles.filterSection, { borderTopColor: c.divider }]}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: c.textSec, marginBottom: 8, marginTop: 4 }}>Status</Text>
                        <View style={styles.filterRow}>
                            {[
                                { key: 'All', label: 'All' },
                                { key: 'ASSIGNED', label: 'Assigned' },
                                { key: 'PENDING', label: 'Pending' },
                                { key: 'IN_TRANSIT', label: 'In Transit' },
                                { key: 'ARRIVED', label: 'Arrived' },
                                { key: 'RETURNING', label: 'Returning' },
                                { key: 'TAMPERED', label: 'Tampered' },
                                { key: 'COMPLETED', label: 'Completed' },
                                { key: 'CANCELLED', label: 'Cancelled' },
                            ].map(({ key, label }) => {
                                const isSelected = filter === key;
                                const stColor = isSelected && key !== 'All' ? getStatusColor(key) : c.text;
                                return (
                                    <TouchableOpacity
                                        key={key}
                                        onPress={() => setFilter(key)}
                                        style={[
                                            styles.plainChip,
                                            { backgroundColor: isSelected ? (key === 'All' ? c.accent : stColor + '1A') : c.pillBg },
                                        ]}
                                    >
                                        <Text style={{ fontSize: 13, fontWeight: '600', color: isSelected ? (key === 'All' ? c.bg : stColor) : c.textSec }}>
                                            {label}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        <View style={{ height: 12 }} />

                        <Text style={{ fontSize: 13, fontWeight: '600', color: c.textSec, marginBottom: 8 }}>Date</Text>
                        <View style={styles.filterRow}>
                            {['All', 'Today', 'Tomorrow', 'Week', 'Custom'].map((dateOpt) => (
                                <TouchableOpacity
                                    key={dateOpt}
                                    onPress={() => setDateFilter(dateOpt)}
                                    style={[
                                        styles.plainChip,
                                        { backgroundColor: dateFilter === dateOpt ? c.accent : c.pillBg },
                                    ]}
                                >
                                    <Text style={{ fontSize: 13, fontWeight: '600', color: dateFilter === dateOpt ? c.bg : c.textSec }}>
                                        {dateOpt}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {/* Custom Date Range Selection */}
                        {dateFilter === 'Custom' && (
                            <View style={[styles.customDateContainer, { backgroundColor: c.search }]}>
                                <TouchableOpacity
                                    style={[styles.dateInput, { borderColor: c.border, backgroundColor: c.bg }]}
                                    onPress={() => showDateMode('start')}
                                >
                                    <Text style={{ fontSize: 11, color: c.textSec, fontWeight: '600' }}>Start Date</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                        <MaterialCommunityIcons name="calendar" size={16} color={c.text} style={{ marginRight: 6 }} />
                                        <Text style={{ fontSize: 14, color: c.text, fontWeight: '500' }}>{dayjs(customStartDate).format('MMM D, YYYY')}</Text>
                                    </View>
                                </TouchableOpacity>

                                <MaterialCommunityIcons name="arrow-right" size={20} color={c.textSec} style={{ marginHorizontal: 8 }} />

                                <TouchableOpacity
                                    style={[styles.dateInput, { borderColor: c.border, backgroundColor: c.bg }]}
                                    onPress={() => showDateMode('end')}
                                >
                                    <Text style={{ fontSize: 11, color: c.textSec, fontWeight: '600' }}>End Date</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                        <MaterialCommunityIcons name="calendar" size={16} color={c.text} style={{ marginRight: 6 }} />
                                        <Text style={{ fontSize: 14, color: c.text, fontWeight: '500' }}>{dayjs(customEndDate).format('MMM D, YYYY')}</Text>
                                    </View>
                                </TouchableOpacity>
                            </View>
                        )}

                        {showDatePicker && (
                            <DateTimePicker
                                testID="dateTimePicker"
                                value={datePickerMode === 'start' ? customStartDate : customEndDate}
                                mode="date"
                                is24Hour={true}
                                display="default"
                                onChange={onDateChange}
                            />
                        )}
                    </View>
                )}
            </View>

            {/* Validated List Content */}
            <FlatList
                key={viewMode}
                data={filteredDeliveries}
                renderItem={(info) => viewMode === 'list' ? renderItem(info) : renderGridItem(info)}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.listContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                numColumns={viewMode === 'list' ? 1 : 2}
                columnWrapperStyle={viewMode === 'grid' ? { justifyContent: 'space-between' } : undefined}
                ListEmptyComponent={
                    <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.border }]}>
                        <MaterialCommunityIcons name="package-variant-closed" size={40} color={c.textTer} />
                        <Text style={{ fontSize: 15, fontWeight: '600', color: c.textSec, marginTop: 10 }}>No deliveries found</Text>
                    </View>
                }
            />

            <CancellationModal
                visible={showCancelModal}
                onDismiss={() => setShowCancelModal(false)}
                onSubmit={handleCancellationSubmit}
                loading={cancelLoading}
            />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        padding: 20, paddingBottom: 16,
        borderBottomWidth: 1, zIndex: 1,
    },
    iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    searchContainer: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingHorizontal: 16, marginTop: 4 },
    filterSection: { marginTop: 16, paddingTop: 10, borderTopWidth: 1 },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    plainChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
    customDateContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 12, padding: 12, borderRadius: 12 },
    dateInput: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 12 },
    listContent: { padding: 16, paddingBottom: 100 },
    card: { borderRadius: 16, borderWidth: 1, marginBottom: 16, overflow: 'hidden' },
    gridCard: { width: '48%', borderRadius: 16, borderWidth: 1, marginBottom: 16, overflow: 'hidden' },
    statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    divider: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
    locationDotContainer: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center' },
    addressContainer: { flexDirection: 'row', alignItems: 'center', padding: 8, paddingLeft: 12, borderRadius: 12 },
    navBtn: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
    cardActions: { gap: 10, paddingTop: 0 },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, gap: 8 },
    primaryBtnText: { fontSize: 15, fontWeight: '700' },
    secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, gap: 6 },
    secondaryBtnText: { fontSize: 13, fontWeight: '600' },
    emptyCard: { alignItems: 'center', padding: 32, borderRadius: 16, borderWidth: 1, marginTop: 40 },
});
