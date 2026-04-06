import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useAppTheme } from '../../context/ThemeContext';

type AdminModuleLayoutProps = {
    title: string;
    subtitle: string;
    bullets?: string[];
};

export default function AdminModuleLayout({ title, subtitle, bullets = [] }: AdminModuleLayoutProps) {
    const { isDarkMode } = useAppTheme();
    const [refreshing, setRefreshing] = React.useState(false);

    const onRefresh = React.useCallback(async () => {
        setRefreshing(true);
        await new Promise((resolve) => setTimeout(resolve, 450));
        setRefreshing(false);
    }, []);

    const colors = isDarkMode
        ? {
            background: '#000000',
            card: '#141414',
            border: '#2C2C2E',
            title: '#FFFFFF',
            subtitle: '#C7C7CC',
            bullet: '#8E8E93',
        }
        : {
            background: '#FFFFFF',
            card: '#F6F6F6',
            border: '#E5E5EA',
            title: '#000000',
            subtitle: '#3A3A3C',
            bullet: '#6B6B6B',
        };

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: colors.background }]}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.title} />}
        >
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.title, { color: colors.title }]}>{title}</Text>
                <Text style={[styles.subtitle, { color: colors.subtitle }]}>{subtitle}</Text>

                {bullets.length > 0 && (
                    <View style={styles.list}>
                        {bullets.map((item) => (
                            <View key={item} style={styles.row}>
                                <Text style={[styles.dot, { color: colors.bullet }]}>{'\u2022'}</Text>
                                <Text style={[styles.item, { color: colors.bullet }]}>{item}</Text>
                            </View>
                        ))}
                    </View>
                )}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        padding: 16,
    },
    card: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
        padding: 16,
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 15,
        lineHeight: 22,
    },
    list: {
        marginTop: 16,
        gap: 10,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    dot: {
        width: 16,
        fontSize: 14,
        lineHeight: 20,
    },
    item: {
        flex: 1,
        fontSize: 14,
        lineHeight: 20,
    },
});
