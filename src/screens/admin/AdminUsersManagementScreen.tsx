import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Avatar, Button, IconButton, Menu, Searchbar, SegmentedButtons, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    AdminRole,
    AdminUser,
    deleteAdminUser,
    listAdminUsers,
    updateAdminUser,
} from '../../services/adminApiService';
import { useAppTheme } from '../../context/ThemeContext';

const lightC = {
    bg: '#F3F3F0',
    card: '#FFFFFF',
    border: '#DEDED8',
    text: '#121212',
    textSec: '#64645F',
    muted: '#8A8A84',
    search: '#ECECE8',
    avatar: '#EFEFEA',
};

const darkC = {
    bg: '#090909',
    card: '#121212',
    border: '#2A2A2A',
    text: '#F4F4F4',
    textSec: '#B2B2B2',
    muted: '#7A7A7A',
    search: '#171717',
    avatar: '#1E1E1E',
};

const ROLES: AdminRole[] = ['ADMIN', 'RIDER', 'CUSTOMER'];

function getUserInitial(user: AdminUser): string {
    const seed = user.full_name?.trim() || user.email?.trim() || '?';
    return seed.charAt(0).toUpperCase();
}

function getUserAvatarUrl(user: AdminUser): string | null {
    const value = user.avatar_url?.trim();
    return value ? value : null;
}

export default function AdminUsersManagementScreen() {
    const { isDarkMode } = useAppTheme();
    const insets = useSafeAreaInsets();
    const c = isDarkMode ? darkC : lightC;
    const headerTopPadding = Math.max(insets.top + 8, 18);

    const [users, setUsers] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [avatarErrorIds, setAvatarErrorIds] = useState<Record<string, boolean>>({});

    const [activeRoleMenuUserId, setActiveRoleMenuUserId] = useState<string | null>(null);

    const loadUsers = async () => {
        setError(null);
        try {
            const data = await listAdminUsers();
            setUsers(data || []);
            setAvatarErrorIds({});
        } catch (e: any) {
            setError(e?.message || 'Failed to load users');
        }
    };

    useEffect(() => {
        let mounted = true;
        (async () => {
            setLoading(true);
            await loadUsers();
            if (mounted) setLoading(false);
        })();
        return () => {
            mounted = false;
        };
    }, []);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return users;
        return users.filter((u) => {
            const email = u.email?.toLowerCase() ?? '';
            const name = u.full_name?.toLowerCase() ?? '';
            return email.includes(term) || name.includes(term) || u.role.toLowerCase().includes(term);
        });
    }, [users, search]);

    const onChangeRole = async (user: AdminUser, role: AdminRole) => {
        if (role === user.role) {
            setActiveRoleMenuUserId(null);
            return;
        }

        setBusyId(user.id);
        setError(null);
        try {
            await updateAdminUser({
                id: user.id,
                full_name: user.full_name || null,
                phone_number: user.phone_number || null,
                role,
            });
            setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role } : u)));
        } catch (e: any) {
            setError(e?.message || 'Failed to update role');
        } finally {
            setBusyId(null);
            setActiveRoleMenuUserId(null);
        }
    };

    const onDelete = async (user: AdminUser) => {
        setBusyId(user.id);
        setError(null);
        try {
            await deleteAdminUser(user.id);
            setUsers((prev) => prev.filter((u) => u.id !== user.id));
        } catch (e: any) {
            setError(e?.message || 'Failed to delete user');
        } finally {
            setBusyId(null);
        }
    };

    const onRefresh = async () => {
        setRefreshing(true);
        await loadUsers();
        setRefreshing(false);
    };

    return (
        <View style={[styles.container, { backgroundColor: c.bg }]}> 
            <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.border, paddingTop: headerTopPadding }]}> 
                <Text style={[styles.title, { color: c.text }]}>User Management</Text>
                <Text style={[styles.subtitle, { color: c.textSec }]}>Assign roles and manage access cleanly.</Text>
            </View>

            <Searchbar
                value={search}
                onChangeText={setSearch}
                placeholder="Search by email, name, role"
                style={[styles.search, { backgroundColor: c.search, borderColor: c.border }]}
                inputStyle={[styles.searchInput, { color: c.text }]}
                iconColor={c.textSec}
                placeholderTextColor={c.textSec}
            />

            <View style={styles.listHeaderRow}>
                <Text style={[styles.listHeaderTitle, { color: c.text }]}>Users</Text>
                <Text style={[styles.listHeaderCount, { color: c.textSec }]}>{filtered.length} total</Text>
            </View>

            <View style={styles.viewToggleWrap}>
                <SegmentedButtons
                    value={viewMode}
                    onValueChange={(value) => setViewMode(value as 'list' | 'grid')}
                    style={[styles.viewToggle, { backgroundColor: c.search, borderColor: c.border }]}
                    buttons={[
                        {
                            value: 'list',
                            label: 'List',
                            icon: 'format-list-bulleted',
                        },
                        {
                            value: 'grid',
                            label: 'Grid',
                            icon: 'view-grid-outline',
                        },
                    ]}
                />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator color={c.text} />
                </View>
            ) : (
                <FlatList
                    key={`users-${viewMode}`}
                    data={filtered}
                    keyExtractor={(item) => item.id}
                    numColumns={viewMode === 'grid' ? 2 : 1}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.text} />}
                    columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
                    contentContainerStyle={{ padding: 14, paddingBottom: 28 }}
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={<Text style={[styles.empty, { color: c.textSec }]}>No users found.</Text>}
                    renderItem={({ item }) => {
                        const avatarUrl = avatarErrorIds[item.id] ? null : getUserAvatarUrl(item);

                        return (
                        <View style={[
                            styles.userCard,
                            viewMode === 'grid' ? styles.userCardGrid : null,
                            { backgroundColor: c.card, borderColor: c.border },
                        ]}> 
                            <View style={[styles.userTopRow, viewMode === 'grid' ? styles.userTopRowGrid : null]}>
                                {avatarUrl ? (
                                    <Avatar.Image
                                        size={34}
                                        source={{ uri: avatarUrl }}
                                        style={[styles.avatarPhoto, { backgroundColor: c.avatar, borderColor: c.border }]}
                                        onError={() => {
                                            setAvatarErrorIds((prev) => ({
                                                ...prev,
                                                [item.id]: true,
                                            }));
                                        }}
                                    />
                                ) : (
                                    <View style={[styles.avatar, { backgroundColor: c.avatar, borderColor: c.border }]}>
                                        <Text style={[styles.avatarText, { color: c.text }]}>{getUserInitial(item)}</Text>
                                    </View>
                                )}

                                <View style={styles.userIdentityCol}>
                                    <Text numberOfLines={1} style={[styles.name, { color: c.text }]}>{item.full_name || 'Unnamed user'}</Text>
                                    <Text numberOfLines={1} style={[styles.email, { color: c.textSec }]}>{item.email}</Text>
                                </View>

                                <IconButton
                                    icon="delete-outline"
                                    size={20}
                                    onPress={() => onDelete(item)}
                                    disabled={busyId === item.id}
                                    iconColor={c.muted}
                                    style={[
                                        styles.deleteBtn,
                                        viewMode === 'grid' ? styles.deleteBtnGrid : null,
                                        { borderColor: c.border },
                                    ]}
                                />
                            </View>

                            <View style={[styles.actionsRow, viewMode === 'grid' ? styles.actionsRowGrid : null]}>
                                <Text style={[styles.roleLabel, { color: c.textSec }]}>ACCESS ROLE</Text>
                                <Menu
                                    visible={activeRoleMenuUserId === item.id}
                                    onDismiss={() => setActiveRoleMenuUserId(null)}
                                    anchor={
                                        <Button
                                            mode="outlined"
                                            icon="chevron-down"
                                            onPress={() => setActiveRoleMenuUserId(item.id)}
                                            disabled={busyId === item.id}
                                            labelStyle={styles.roleSelectorLabel}
                                            contentStyle={styles.roleButtonContent}
                                            style={[
                                                styles.roleSelectorBtn,
                                                viewMode === 'grid' ? styles.roleSelectorBtnGrid : null,
                                                { borderColor: c.border },
                                            ]}
                                        >
                                            {item.role}
                                        </Button>
                                    }
                                >
                                    {ROLES.map((role) => (
                                        <Menu.Item
                                            key={`${item.id}-${role}`}
                                            title={role}
                                            leadingIcon={item.role === role ? 'check' : undefined}
                                            titleStyle={styles.menuItemTitle}
                                            onPress={() => onChangeRole(item, role)}
                                        />
                                    ))}
                                </Menu>
                            </View>
                        </View>
                        );
                    }}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        paddingTop: 18,
        paddingHorizontal: 16,
        paddingBottom: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    title: { fontSize: 24, fontFamily: 'Inter_700Bold' },
    subtitle: { marginTop: 4, fontSize: 13, fontFamily: 'Inter_500Medium' },
    roleSelectorBtn: {
        marginBottom: 0,
        borderRadius: 10,
    },
    roleSelectorLabel: {
        fontFamily: 'Inter_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.3,
    },
    roleButtonContent: {
        justifyContent: 'space-between',
        minHeight: 38,
    },
    menuItemTitle: {
        fontFamily: 'Inter_500Medium',
        fontSize: 13,
    },
    search: {
        marginHorizontal: 14,
        marginBottom: 4,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 0,
        borderRadius: 12,
        minHeight: 44,
    },
    searchInput: {
        fontFamily: 'Inter_500Medium',
        fontSize: 14,
    },
    listHeaderRow: {
        marginHorizontal: 14,
        marginTop: 8,
        marginBottom: 6,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    listHeaderTitle: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
    },
    listHeaderCount: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    viewToggleWrap: {
        marginHorizontal: 14,
        marginBottom: 8,
    },
    viewToggle: {
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
    },
    gridRow: {
        justifyContent: 'space-between',
        gap: 10,
    },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    error: {
        color: '#D32F2F',
        marginHorizontal: 16,
        marginTop: 6,
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    empty: {
        textAlign: 'center',
        marginTop: 36,
        fontFamily: 'Inter_500Medium',
        fontSize: 13,
    },
    userCard: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
        paddingVertical: 12,
        paddingHorizontal: 12,
        marginBottom: 10,
    },
    userCardGrid: {
        flex: 1,
        minWidth: 0,
    },
    userTopRow: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        gap: 10,
    },
    userTopRowGrid: {
        alignItems: 'flex-start',
    },
    avatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
    },
    avatarPhoto: {
        borderWidth: StyleSheet.hairlineWidth,
    },
    avatarText: {
        fontFamily: 'Inter_700Bold',
        fontSize: 13,
    },
    userIdentityCol: {
        flex: 1,
        paddingRight: 4,
    },
    name: {
        fontSize: 14,
        fontFamily: 'Inter_700Bold',
        marginBottom: 2,
    },
    email: {
        fontSize: 12,
        fontFamily: 'Inter_500Medium',
    },
    deleteBtn: {
        margin: 0,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
    },
    deleteBtnGrid: {
        marginLeft: 4,
    },
    actionsRow: {
        marginTop: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
    },
    actionsRowGrid: {
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        gap: 6,
    },
    roleLabel: {
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: 0.5,
    },
    roleSelectorBtnGrid: {
        width: '100%',
    },
});
