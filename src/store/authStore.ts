import { create } from 'zustand';

const useAuthStore = create((set) => ({
    user: null,
    isAuthenticated: false,
    role: null, // 'customer', 'rider', 'admin'
    login: (userData) => set({ user: userData, isAuthenticated: true, role: userData.role }),
    logout: () => set({ user: null, isAuthenticated: false, role: null }),
    // Merge partial updates into the existing user object (e.g. after saving phone)
    updateUser: (partial) => set((state) => ({
        user: state.user ? { ...state.user, ...partial } : null,
    })),
}));

export default useAuthStore;
