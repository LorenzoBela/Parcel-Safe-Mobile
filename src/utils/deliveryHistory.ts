import { parseUTCString } from './date';
import { DeliveryHistoryItem } from '../types/deliveryHistory';

export const mapDeliveryStatus = (raw: string): string => {
    switch (raw) {
        case 'COMPLETED':
            return 'Delivered';
        case 'IN_TRANSIT':
        case 'ASSIGNED':
        case 'ARRIVED':
            return 'In Transit';
        case 'PENDING':
            return 'Pending';
        case 'TAMPERED':
            return 'Tampered';
        case 'CANCELLED':
            return 'Cancelled';
        case 'RETURNING':
            return 'Returning';
        case 'RETURNED':
            return 'Returned';
        default:
            return raw;
    }
};

export const getDeliveryStatusColor = (status: string): string => {
    switch (status) {
        case 'Delivered':
            return '#4CAF50';
        case 'In Transit':
            return '#2196F3';
        case 'Pending':
            return '#FF9800';
        case 'Cancelled':
            return '#F44336';
        case 'Tampered':
            return '#D32F2F';
        case 'Returning':
            return '#FF9800';
        case 'Returned':
            return '#9E9E9E';
        default:
            return '#757575';
    }
};

export function normalizeDeliveryHistoryRow(row: any): DeliveryHistoryItem {
    const rawTrk = row.tracking_number || row.id;
    const shortTrk = rawTrk.length > 20 ? `...${rawTrk.slice(-12)}` : rawTrk;
    const timestampToUse = row.delivered_at || row.updated_at || row.created_at || null;
    const dateObj = timestampToUse ? parseUTCString(timestampToUse) : null;

    return {
        id: row.id,
        trk: rawTrk,
        shortTrk,
        status: mapDeliveryStatus(row.status),
        rawStatus: row.status,
        rawDate: timestampToUse,
        date: dateObj
            ? dateObj.toLocaleDateString('en-US', {
                timeZone: 'Asia/Manila',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
            })
            : 'N/A',
        time: dateObj
            ? dateObj.toLocaleTimeString('en-US', {
                timeZone: 'Asia/Manila',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            })
            : '',
        customer: row.profiles?.full_name || 'Unknown Customer',
        customerName: row.profiles?.full_name || 'Unknown Customer',
        riderName: row.rider_profile?.full_name || row.rider_name || row.rider_id || 'Unknown Rider',
        earnings: row.estimated_fare != null ? `₱${Number(row.estimated_fare).toFixed(2)}` : '—',
        pickup: row.pickup_address || 'N/A',
        dropoff: row.dropoff_address || 'N/A',
        pickupAddress: row.pickup_address || 'N/A',
        dropoffAddress: row.dropoff_address || 'N/A',
        pickup_lat: row.pickup_lat ?? null,
        pickup_lng: row.pickup_lng ?? null,
        dropoff_lat: row.dropoff_lat ?? null,
        dropoff_lng: row.dropoff_lng ?? null,
        image: row.proof_of_delivery_url || row.image_url || null,
        pickupImage: row.pickup_photo_url || null,
        distance: row.distance_text || (row.distance ? `${row.distance.toFixed(1)} km` : 'N/A'),
    };
}
