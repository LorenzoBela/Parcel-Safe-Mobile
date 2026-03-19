export type DeliveryViewMode = 'list' | 'grid';

export interface DeliveryHistoryItem {
    id: string;
    trk: string;
    shortTrk: string;
    status: string;
    rawStatus: string;
    rawDate: string | null;
    date: string;
    time: string;
    customer: string;
    customerName: string;
    riderName: string;
    earnings: string;
    pickup: string;
    dropoff: string;
    pickupAddress: string;
    dropoffAddress: string;
    pickup_lat: number | null;
    pickup_lng: number | null;
    dropoff_lat: number | null;
    dropoff_lng: number | null;
    image: string | null;
    pickupImage: string | null;
    distance: string;
}
