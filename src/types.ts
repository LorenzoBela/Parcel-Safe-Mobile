export interface LocationData {
    latitude: number;
    longitude: number;
    timestamp: number;
    server_timestamp?: number;
    speed?: number;
    heading?: number;
    /** Horizontal accuracy in metres (from phone OS location API or derived from box HDOP) */
    accuracy?: number;
    /** Horizontal Dilution of Precision from box hardware GNSS (lower = better, < 2 is excellent) */
    hdop?: number;
    source: 'box' | 'phone';
}

export type LocationsByBoxId = Record<string, LocationData>;

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  CustomerDashboard: undefined;
  RiderDashboard: undefined;
  AssignedDeliveries: undefined;
  BoxControls: { boxId?: string } | undefined;
  PairBox: undefined;
  Arrival: undefined;
  DeliveryCompletion: undefined;
  AdminDashboard: undefined;
  GlobalMap: undefined;
  TamperAlerts: undefined;
  DeliveryRecords: undefined;
  OTP: undefined;
  TrackOrder: undefined;
  DeliveryLog: undefined;
  PhotoAudit: { logId: string } | undefined;
  Profile: undefined;
  Settings: undefined;
  DeliveryDetail: { delivery: any };
  CustomerApp: undefined;
  RiderApp: undefined;
  AdminApp: undefined;
};
