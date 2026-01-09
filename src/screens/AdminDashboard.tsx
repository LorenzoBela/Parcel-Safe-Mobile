import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Text, Card, Avatar, Button, Surface, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';

export default function AdminDashboard() {
    const navigation = useNavigation<any>();
    const [currentTime, setCurrentTime] = useState(dayjs());

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(dayjs());
        }, 60000);
        return () => clearInterval(timer);
    }, []);

    // Mock data
    const weather = { temp: '28°C', condition: 'Cloudy', icon: 'weather-cloudy' };
    const stats = [
        { label: 'Total Deliveries', value: '150', icon: 'truck-check', color: '#4CAF50' },
        { label: 'Tamper Events', value: '3', icon: 'alert-circle', color: '#F44336' },
        { label: 'Active Riders', value: '12', icon: 'motorbike', color: '#2196F3' },
        { label: 'Open Cases', value: '2', icon: 'folder-open', color: '#FF9800' },
    ];

    const recentAlerts = [
        { id: 1, box: 'BOX-001', time: '10:30 AM', type: 'Tamper Detected', location: 'Manila' },
        { id: 2, box: 'BOX-005', time: '11:15 AM', type: 'Unauthorized Unlock', location: 'Quezon City' },
    ];

    const StatCard = ({ label, value, icon, color }) => (
        <Surface style={styles.statCard} elevation={2}>
            <View style={[styles.statIcon, { backgroundColor: color + '20' }]}>
                <MaterialCommunityIcons name={icon} size={24} color={color} />
            </View>
            <Text variant="headlineSmall" style={{ fontWeight: 'bold', marginTop: 8 }}>{value}</Text>
            <Text variant="bodySmall" style={{ color: '#666' }}>{label}</Text>
        </Surface>
    );

    return (
        <View style={styles.container}>
            {/* Attractive Header */}
            <View style={styles.headerBackground}>
                <View style={styles.headerContent}>
                    <View>
                        <Text style={styles.dateText}>{currentTime.format('dddd, MMMM D')}</Text>
                        <Text style={styles.timeText}>{currentTime.format('h:mm A')}</Text>
                    </View>
                    <View style={styles.weatherContainer}>
                        <MaterialCommunityIcons name={weather.icon as any} size={30} color="white" />
                        <Text style={styles.weatherText}>{weather.temp}</Text>
                        <Text style={styles.weatherCondition}>{weather.condition}</Text>
                    </View>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>

                <View style={styles.header}>
                    <Text variant="headlineMedium" style={styles.headerTitle}>Admin Overview</Text>
                    <IconButton icon="refresh" size={24} onPress={() => console.log('Refresh')} />
                </View>

                {/* Stats Grid */}
                <View style={styles.statsGrid}>
                    {stats.map((stat, index) => (
                        <StatCard key={index} {...stat} />
                    ))}
                </View>

                {/* Quick Links */}
                <Text variant="titleMedium" style={styles.sectionTitle}>System Management</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickLinksScroll}>
                    <Button
                        mode="contained"
                        icon="map"
                        style={[styles.quickLinkBtn, { backgroundColor: '#3F51B5' }]}
                        onPress={() => navigation.navigate('GlobalMap')}
                    >
                        Live Map
                    </Button>
                    <Button
                        mode="contained"
                        icon="alert"
                        style={[styles.quickLinkBtn, { backgroundColor: '#F44336' }]}
                        onPress={() => navigation.navigate('TamperAlerts')}
                    >
                        Alerts
                    </Button>
                    <Button
                        mode="contained"
                        icon="file-document"
                        style={[styles.quickLinkBtn, { backgroundColor: '#607D8B' }]}
                        onPress={() => navigation.navigate('DeliveryRecords')}
                    >
                        Records
                    </Button>
                </ScrollView>

                {/* Recent Alerts List */}
                <View style={styles.alertsHeader}>
                    <Text variant="titleMedium" style={styles.sectionTitle}>Recent Alerts</Text>
                    <Button mode="text" compact onPress={() => navigation.navigate('TamperAlerts')}>View All</Button>
                </View>

                {recentAlerts.map((alert) => (
                    <Surface key={alert.id} style={styles.alertItem} elevation={1}>
                        <View style={styles.alertLeft}>
                            <MaterialCommunityIcons name="alert" size={24} color="#F44336" style={styles.alertIcon} />
                            <View>
                                <Text variant="titleSmall" style={{ color: '#D32F2F' }}>{alert.type}</Text>
                                <Text variant="bodySmall">{alert.box} • {alert.location}</Text>
                            </View>
                        </View>
                        <Text variant="bodySmall" style={{ color: '#999' }}>{alert.time}</Text>
                    </Surface>
                ))}

            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    headerBackground: {
        backgroundColor: '#F44336',
        paddingTop: 50,
        paddingBottom: 20,
        paddingHorizontal: 20,
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 20,
        elevation: 4,
    },
    headerContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    dateText: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 14,
        fontWeight: 'bold',
    },
    timeText: {
        color: 'white',
        fontSize: 32,
        fontWeight: 'bold',
    },
    weatherContainer: {
        alignItems: 'center',
    },
    weatherText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    weatherCondition: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 12,
    },
    scrollContent: {
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        marginTop: 10,
    },
    headerTitle: {
        fontWeight: 'bold',
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    statCard: {
        width: '48%',
        padding: 16,
        backgroundColor: 'white',
        borderRadius: 16,
        marginBottom: 16,
    },
    statIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sectionTitle: {
        fontWeight: 'bold',
        marginBottom: 12,
    },
    quickLinksScroll: {
        marginBottom: 24,
    },
    quickLinkBtn: {
        marginRight: 12,
        borderRadius: 20,
    },
    alertsHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    alertItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        backgroundColor: 'white',
        borderRadius: 12,
        marginBottom: 10,
        borderLeftWidth: 4,
        borderLeftColor: '#F44336',
    },
    alertLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    alertIcon: {
        marginRight: 12,
    },
});
