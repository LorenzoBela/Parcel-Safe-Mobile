import { getFirebaseDatabase } from './firebaseClient';
import { onValue, off, ref, set, serverTimestamp } from 'firebase/database';

export type PairingMode = 'ONE_TIME' | 'SESSION';
export type PairingStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface BoxPairingState {
    box_id: string;
    rider_id: string;
    mode: PairingMode;
    status: PairingStatus;
    pair_token?: string;
    paired_at?: number;
    expires_at?: number;
    max_uses?: number;
    uses?: number;
    last_updated?: number;
}

export interface PairingQrPayload {
    boxId: string;
    token?: string;
    mode?: PairingMode;
    sessionHours?: number;
}

const DEFAULT_SESSION_HOURS = 24;

export function parsePairingQr(payload: string): PairingQrPayload | null {
    if (!payload || typeof payload !== 'string') {
        return null;
    }

    // JSON payload
    if (payload.trim().startsWith('{')) {
        try {
            const data = JSON.parse(payload);
            if (data?.boxId || data?.box_id) {
                return {
                    boxId: data.boxId ?? data.box_id,
                    token: data.token ?? data.pairToken,
                    mode: data.mode,
                    sessionHours: data.sessionHours,
                };
            }
        } catch {
            // Fall through to URL parsing
        }
    }

    // URL payload: parcelsafe://pair?boxId=BOX_001&token=abc&mode=SESSION&sessionHours=24
    try {
        const url = new URL(payload);
        const boxId = url.searchParams.get('boxId') || url.searchParams.get('box_id');
        if (boxId) {
            const mode = url.searchParams.get('mode') as PairingMode | null;
            const sessionHours = url.searchParams.get('sessionHours');
            return {
                boxId,
                token: url.searchParams.get('token') ?? undefined,
                mode: mode ?? undefined,
                sessionHours: sessionHours ? Number(sessionHours) : undefined,
            };
        }
    } catch {
        // Not a URL
    }

    // Fallback: plain box ID
    if (payload.trim().length > 0) {
        return { boxId: payload.trim() };
    }

    return null;
}

export function subscribeToRiderPairing(
    riderId: string,
    callback: (state: BoxPairingState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const pairingRef = ref(db, `riders/${riderId}/pairing`);

    const unsubscribe = onValue(pairingRef, (snapshot) => {
        const data = snapshot.val();
        callback((data as BoxPairingState) || null);
    });

    return () => off(pairingRef);
}

export function subscribeToBoxPairing(
    boxId: string,
    callback: (state: BoxPairingState | null) => void
): () => void {
    const db = getFirebaseDatabase();
    const pairingRef = ref(db, `pairings/${boxId}`);

    const unsubscribe = onValue(pairingRef, (snapshot) => {
        const data = snapshot.val();
        callback((data as BoxPairingState) || null);
    });

    return () => off(pairingRef);
}

export async function pairBoxWithRider(params: {
    boxId: string;
    riderId: string;
    mode: PairingMode;
    pairToken?: string;
    sessionHours?: number;
}): Promise<void> {
    const { boxId, riderId, mode, pairToken, sessionHours } = params;
    const db = getFirebaseDatabase();
    const now = Date.now();
    const expiresAt = mode === 'SESSION'
        ? now + (sessionHours ?? DEFAULT_SESSION_HOURS) * 60 * 60 * 1000
        : undefined;

    const pairingState: BoxPairingState = {
        box_id: boxId,
        rider_id: riderId,
        mode,
        status: 'ACTIVE',
        pair_token: pairToken,
        paired_at: now,
        expires_at: expiresAt,
        max_uses: mode === 'ONE_TIME' ? 1 : undefined,
        uses: 0,
        last_updated: now,
    };

    await set(ref(db, `pairings/${boxId}`), {
        ...pairingState,
        last_updated: serverTimestamp(),
    });

    await set(ref(db, `riders/${riderId}/pairing`), {
        ...pairingState,
        last_updated: serverTimestamp(),
    });
}

export async function revokePairing(boxId: string, riderId: string): Promise<void> {
    const db = getFirebaseDatabase();
    const now = Date.now();

    const revokedState: Partial<BoxPairingState> = {
        status: 'REVOKED',
        last_updated: now,
    };

    await set(ref(db, `pairings/${boxId}`), {
        ...revokedState,
        last_updated: serverTimestamp(),
    });

    await set(ref(db, `riders/${riderId}/pairing`), {
        ...revokedState,
        last_updated: serverTimestamp(),
    });
}

export function isPairingActive(state: BoxPairingState | null): boolean {
    if (!state || state.status !== 'ACTIVE') {
        return false;
    }

    if (state.expires_at && state.expires_at <= Date.now()) {
        return false;
    }

    return true;
}
