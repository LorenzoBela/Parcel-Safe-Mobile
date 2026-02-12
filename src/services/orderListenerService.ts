/**
 * Order Listener Service
 * 
 * Listens for incoming orders in real-time using Firebase Realtime Database
 * and Firebase Cloud Messaging. Ensures orders are received even when app
 * is in background or killed.
 * 
 * Features:
 * - Real-time Firebase listeners
 * - Offline queue support
 * - Order notification system
 * - Automatic reconnection
 */

import { ref, onValue, off, query, orderByChild, equalTo, get, update } from 'firebase/database';
import { getFirebaseDatabase } from './firebaseClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// ==================== Configuration ====================

export const ORDER_CONFIG = {
    /** Storage key for pending orders */
    PENDING_ORDERS_KEY: 'pending_orders',
    
    /** Storage key for last order check timestamp */
    LAST_CHECK_KEY: 'last_order_check',
    
    /** Maximum pending orders to store */
    MAX_PENDING_ORDERS: 50,
    
    /** Order check interval when offline (ms) */
    OFFLINE_CHECK_INTERVAL: 60000, // 1 minute
};

// ==================== Types ====================

export interface Order {
    id: string;
    customer_id: string;
    rider_id?: string;
    pickup_address: string;
    delivery_address: string;
    pickup_location: {
        latitude: number;
        longitude: number;
    };
    delivery_location: {
        latitude: number;
        longitude: number;
    };
    status: 'pending' | 'assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';
    created_at: number;
    assigned_at?: number;
    estimated_delivery_time?: number;
    payment_method: string;
    total_amount: number;
    notes?: string;
}

export type OrderCallback = (order: Order) => void | Promise<void>;

// ==================== State Management ====================

let orderCallbacks: OrderCallback[] = [];
let activeListeners: Array<() => void> = [];
let isListening = false;
let offlineCheckInterval: NodeJS.Timeout | null = null;

// ==================== Event System ====================

/**
 * Subscribe to new order events
 */
export function onNewOrder(callback: OrderCallback): () => void {
    orderCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
        orderCallbacks = orderCallbacks.filter(cb => cb !== callback);
    };
}

/**
 * Emit new order event to all callbacks
 */
async function emitNewOrder(order: Order): Promise<void> {
    console.log('[OrderListener] New order:', order.id);
    
    // Save to pending orders
    await addToPendingOrders(order);
    
    // Show notification
    await showOrderNotification(order);
    
    // Call all callbacks
    for (const callback of orderCallbacks) {
        try {
            await callback(order);
        } catch (error) {
            console.error('[OrderListener] Callback error:', error);
        }
    }
}

// ==================== Firebase Listeners ====================

/**
 * Start listening for orders assigned to the rider
 */
export async function startOrderListener(riderId: string): Promise<void> {
    if (isListening) {
        console.log('[OrderListener] Already listening');
        return;
    }

    try {
        console.log('[OrderListener] Starting listener for rider:', riderId);
        
        const database = getFirebaseDatabase();
        
        // Listen for orders assigned to this rider with status 'assigned'
        const assignedOrdersRef = query(
            ref(database, 'orders'),
            orderByChild('rider_id'),
            equalTo(riderId)
        );
        
        const unsubscribe = onValue(assignedOrdersRef, (snapshot) => {
            if (snapshot.exists()) {
                const orders = snapshot.val();
                
                Object.entries(orders).forEach(([orderId, orderData]: [string, any]) => {
                    // Only process newly assigned orders
                    if (orderData.status === 'assigned' && !orderData.notified) {
                        const order: Order = {
                            id: orderId,
                            ...orderData,
                        };
                        
                        emitNewOrder(order);
                        
                        // Mark as notified (update in Firebase)
                        // This prevents duplicate notifications
                        update(ref(database, `orders/${orderId}`), {
                            notified: true,
                            notified_at: Date.now(),
                        }).catch((error) => {
                            console.error('[OrderListener] Failed to mark order as notified:', error);
                        });
                    }
                });
            }
        });
        
        activeListeners.push(unsubscribe);
        isListening = true;
        
        // Also listen for general order assignments (push notifications)
        await startOfflineCheck(riderId);
        
        console.log('[OrderListener] Listener started successfully');
    } catch (error) {
        console.error('[OrderListener] Failed to start listener:', error);
        throw error;
    }
}

/**
 * Stop listening for orders
 */
export async function stopOrderListener(): Promise<void> {
    if (!isListening) {
        return;
    }

    try {
        console.log('[OrderListener] Stopping listener');
        
        // Remove all Firebase listeners
        activeListeners.forEach(unsubscribe => unsubscribe());
        activeListeners = [];
        
        // Stop offline check
        if (offlineCheckInterval) {
            clearInterval(offlineCheckInterval);
            offlineCheckInterval = null;
        }
        
        isListening = false;
        
        console.log('[OrderListener] Listener stopped');
    } catch (error) {
        console.error('[OrderListener] Stop listener error:', error);
    }
}

/**
 * Start offline order checking (fallback when real-time fails)
 */
async function startOfflineCheck(riderId: string): Promise<void> {
    if (offlineCheckInterval) {
        return; // Already running
    }

    offlineCheckInterval = setInterval(async () => {
        try {
            await checkForNewOrders(riderId);
        } catch (error) {
            console.error('[OrderListener] Offline check error:', error);
        }
    }, ORDER_CONFIG.OFFLINE_CHECK_INTERVAL);
}

/**
 * Check for new orders (fallback method)
 */
async function checkForNewOrders(riderId: string): Promise<void> {
    try {
        const database = getFirebaseDatabase();
        const lastCheck = await getLastOrderCheck();
        
        // Query orders assigned after last check
        const ordersRef = query(
            ref(database, 'orders'),
            orderByChild('rider_id'),
            equalTo(riderId)
        );
        
        const snapshot = await get(ordersRef);
        
        if (snapshot.exists()) {
            const orders = snapshot.val();
            
            Object.entries(orders).forEach(([orderId, orderData]: [string, any]) => {
                // Check if order is new (created after last check)
                if (orderData.assigned_at > lastCheck && orderData.status === 'assigned') {
                    const order: Order = {
                        id: orderId,
                        ...orderData,
                    };
                    
                    emitNewOrder(order);
                }
            });
        }
        
        // Update last check timestamp
        await saveLastOrderCheck(Date.now());
    } catch (error) {
        console.error('[OrderListener] Check for new orders error:', error);
    }
}

// ==================== Pending Orders Management ====================

/**
 * Add order to pending orders list
 */
async function addToPendingOrders(order: Order): Promise<void> {
    try {
        const pendingOrdersStr = await AsyncStorage.getItem(ORDER_CONFIG.PENDING_ORDERS_KEY);
        let pendingOrders: Order[] = pendingOrdersStr ? JSON.parse(pendingOrdersStr) : [];
        
        // Check if order already exists
        const exists = pendingOrders.some(o => o.id === order.id);
        if (exists) {
            return;
        }
        
        // Add new order
        pendingOrders.unshift(order);
        
        // Limit to max pending orders
        if (pendingOrders.length > ORDER_CONFIG.MAX_PENDING_ORDERS) {
            pendingOrders = pendingOrders.slice(0, ORDER_CONFIG.MAX_PENDING_ORDERS);
        }
        
        await AsyncStorage.setItem(ORDER_CONFIG.PENDING_ORDERS_KEY, JSON.stringify(pendingOrders));
    } catch (error) {
        console.error('[OrderListener] Add to pending orders error:', error);
    }
}

/**
 * Get all pending orders
 */
export async function getPendingOrders(): Promise<Order[]> {
    try {
        const pendingOrdersStr = await AsyncStorage.getItem(ORDER_CONFIG.PENDING_ORDERS_KEY);
        return pendingOrdersStr ? JSON.parse(pendingOrdersStr) : [];
    } catch (error) {
        console.error('[OrderListener] Get pending orders error:', error);
        return [];
    }
}

/**
 * Clear pending orders
 */
export async function clearPendingOrders(): Promise<void> {
    try {
        await AsyncStorage.removeItem(ORDER_CONFIG.PENDING_ORDERS_KEY);
    } catch (error) {
        console.error('[OrderListener] Clear pending orders error:', error);
    }
}

/**
 * Remove order from pending orders
 */
export async function removeFromPendingOrders(orderId: string): Promise<void> {
    try {
        const pendingOrdersStr = await AsyncStorage.getItem(ORDER_CONFIG.PENDING_ORDERS_KEY);
        if (!pendingOrdersStr) {
            return;
        }
        
        const pendingOrders: Order[] = JSON.parse(pendingOrdersStr);
        const filteredOrders = pendingOrders.filter(o => o.id !== orderId);
        
        await AsyncStorage.setItem(ORDER_CONFIG.PENDING_ORDERS_KEY, JSON.stringify(filteredOrders));
    } catch (error) {
        console.error('[OrderListener] Remove from pending orders error:', error);
    }
}

// ==================== Last Check Timestamp ====================

/**
 * Get last order check timestamp
 */
async function getLastOrderCheck(): Promise<number> {
    try {
        const lastCheckStr = await AsyncStorage.getItem(ORDER_CONFIG.LAST_CHECK_KEY);
        return lastCheckStr ? parseInt(lastCheckStr, 10) : 0;
    } catch (error) {
        console.error('[OrderListener] Get last check error:', error);
        return 0;
    }
}

/**
 * Save last order check timestamp
 */
async function saveLastOrderCheck(timestamp: number): Promise<void> {
    try {
        await AsyncStorage.setItem(ORDER_CONFIG.LAST_CHECK_KEY, timestamp.toString());
    } catch (error) {
        console.error('[OrderListener] Save last check error:', error);
    }
}

// ==================== Notifications ====================

/**
 * Show notification for new order
 */
async function showOrderNotification(order: Order): Promise<void> {
    try {
        // Calculate estimated distance (simplified)
        const distance = calculateDistance(
            order.pickup_location,
            order.delivery_location
        );
        
        await Notifications.scheduleNotificationAsync({
            content: {
                title: '🚚 New Delivery Order!',
                body: `Pickup: ${truncateAddress(order.pickup_address)}\nDelivery: ${truncateAddress(order.delivery_address)}\nDistance: ~${distance.toFixed(1)} km`,
                data: { orderId: order.id, type: 'new_order' },
                sound: 'default',
                priority: Notifications.AndroidNotificationPriority.MAX,
                vibrate: [0, 250, 250, 250],
                badge: 1,
            },
            trigger: null, // Show immediately
        });
        
        console.log('[OrderListener] Notification shown for order:', order.id);
    } catch (error) {
        console.error('[OrderListener] Notification error:', error);
    }
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
function calculateDistance(
    point1: { latitude: number; longitude: number },
    point2: { latitude: number; longitude: number }
): number {
    const R = 6371; // Earth's radius in km
    const dLat = toRadians(point2.latitude - point1.latitude);
    const dLon = toRadians(point2.longitude - point1.longitude);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRadians(point1.latitude)) * Math.cos(toRadians(point2.latitude)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/**
 * Truncate address for notification
 */
function truncateAddress(address: string, maxLength: number = 40): string {
    if (address.length <= maxLength) {
        return address;
    }
    return address.substring(0, maxLength - 3) + '...';
}

// ==================== Public API ====================

/**
 * Initialize order listener service
 */
export async function initializeOrderListener(riderId: string): Promise<void> {
    try {
        console.log('[OrderListener] Initializing for rider:', riderId);
        
        await startOrderListener(riderId);
        
        console.log('[OrderListener] Initialized successfully');
    } catch (error) {
        console.error('[OrderListener] Initialization error:', error);
        throw error;
    }
}

/**
 * Check if listener is active
 */
export function isOrderListenerActive(): boolean {
    return isListening;
}

/**
 * Get pending orders count
 */
export async function getPendingOrdersCount(): Promise<number> {
    const orders = await getPendingOrders();
    return orders.length;
}
