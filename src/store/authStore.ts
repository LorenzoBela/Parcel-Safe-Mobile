/**
 * Auth Store — Zustand + MMKV Persistence
 *
 * Persists auth state (user, role, isAuthenticated) to disk via MMKV.
 * On app resume or cold start, the store is hydrated synchronously (0ms)
 * from memory-mapped files — no network calls needed before showing UI.
 *
 * The store API (login, logout, updateUser) is unchanged — all 20+ consumer
 * screens continue to work without any modifications.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkvStorage';

const useAuthStore = create(
    persist(
        (set) => ({
            user: null,
            isAuthenticated: false,
            role: null, // 'customer', 'rider', 'admin'

            login: (userData) =>
                set({ user: userData, isAuthenticated: true, role: userData.role }),

            logout: () =>
                set({ user: null, isAuthenticated: false, role: null }),

            // Merge partial updates into the existing user object (e.g. after saving phone)
            updateUser: (partial) =>
                set((state) => ({
                    user: state.user ? { ...state.user, ...partial } : null,
                })),
        }),
        {
            name: 'auth-store', // MMKV key
            storage: createJSONStorage(() => mmkvStorage),

            // Only persist data fields, not action functions
            partialize: (state: any) => ({
                user: state.user,
                isAuthenticated: state.isAuthenticated,
                role: state.role,
            }),
        }
    )
);

export default useAuthStore;
