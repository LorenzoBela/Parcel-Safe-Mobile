import { getFirebaseDatabase } from './firebaseClient';
import { ref, onValue, off } from 'firebase/database';

/**
 * Service to handle Package Recall (EC-85)
 * Allows the app to listen for recall commands and switch the UI state.
 */
class RecallService {
    private static instance: RecallService;
    private recallListener: ((isRecalled: boolean, returnOtp: string | null) => void) | null = null;
    private activeRef: any = null;

    private constructor() { }

    public static getInstance(): RecallService {
        if (!RecallService.instance) {
            RecallService.instance = new RecallService();
        }
        return RecallService.instance;
    }

    /**
     * Listen for recall status updates logic
     * @param deliveryId 
     * @param callback 
     */
    public listenForRecall(deliveryId: string, callback: (isRecalled: boolean, returnOtp: string | null) => void) {
        if (!deliveryId) return;

        this.recallListener = callback;
        const db = getFirebaseDatabase();
        const path = `deliveries/${deliveryId}/recall`;
        this.activeRef = ref(db, path);

        onValue(this.activeRef, (snapshot) => {
            const data = snapshot.val();
            if (data && data.is_recalled) {
                // Return OTP might be null if not yet generated, but usually is sent with recall
                callback(true, data.return_otp || null);
            } else {
                callback(false, null);
            }
        });
    }

    /**
     * Stop listening
     * @param deliveryId 
     */
    public stopListening(deliveryId: string) {
        if (!deliveryId || !this.activeRef) return;

        off(this.activeRef);
        this.activeRef = null;
        this.recallListener = null;
    }
}

export default RecallService.getInstance();
