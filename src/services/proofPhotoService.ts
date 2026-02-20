import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getFirebaseDatabase } from './firebaseClient';
import { ref as dbRef, update } from 'firebase/database';
import { compressImage } from './photoCompressionService';
import { supabase } from './supabaseClient';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const PROOF_PHOTOS_BUCKET = 'proof-photos';

let storageClient: SupabaseClient | null = null;

function getStorageClient(): SupabaseClient {
    if (storageClient) {
        return storageClient;
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
    }

    // IMPORTANT: This client must NOT use the axios-based JSON-forcing fetch from supabaseClient.ts,
    // otherwise binary uploads to Storage will break.
    storageClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            storage: AsyncStorage,
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
        },
    });

    return storageClient;
}

/**
 * Helper to ensure storage client has the latest session from the main auth client
 */
async function syncStorageSession() {
    try {
        const client = getStorageClient();
        const mainSession = await supabase?.auth.getSession();

        if (mainSession?.data.session) {
            await client.auth.setSession(mainSession.data.session);
        }
    } catch (e) {
        console.warn('[ProofPhoto] Failed to sync session:', e);
    }
}

/**
 * Helper to convert Base64 string to Uint8Array manually
 * (Avoids dependency on atob or Buffer which might be missing in RN)
 */
function base64ToUint8Array(base64: string): Uint8Array {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i;
    }

    let bufferLength = base64.length * 0.75;
    if (base64[base64.length - 1] === '=') {
        bufferLength--;
        if (base64[base64.length - 2] === '=') {
            bufferLength--;
        }
    }

    const arraybuffer = new ArrayBuffer(bufferLength);
    const bytes = new Uint8Array(arraybuffer);

    let p = 0;
    for (let i = 0; i < base64.length; i += 4) {
        const encoded1 = lookup[base64.charCodeAt(i)];
        const encoded2 = lookup[base64.charCodeAt(i + 1)];
        const encoded3 = lookup[base64.charCodeAt(i + 2)];
        const encoded4 = lookup[base64.charCodeAt(i + 3)];

        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        if (encoded3 !== 64) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        if (encoded4 !== 64) bytes[p++] = ((encoded3 & 3) << 6) | encoded4;
    }

    return bytes;
}

export async function uploadDeliveryProofPhoto(params: {
    deliveryId: string;
    boxId: string;
    localUri: string;
}): Promise<{ success: boolean; url?: string; error?: string }> {
    const { deliveryId, boxId, localUri } = params;

    try {
        const compression = await compressImage(localUri);
        const uploadUri = compression.success ? compression.compressedUri : localUri;

        // Read file as Base64 to bypass fetch(blob) network issues on Android
        const base64 = await FileSystem.readAsStringAsync(uploadUri, {
            encoding: 'base64', // Use string literal to avoid type errors
        });
        const arrayBuffer = base64ToUint8Array(base64);

        // Ensure auth is synced before upload
        await syncStorageSession();
        const storage = getStorageClient();

        const fileName = `${deliveryId}_${Date.now()}.jpg`;
        const objectPath = `deliveries/${boxId}/${fileName}`;

        const { data, error } = await storage.storage
            .from(PROOF_PHOTOS_BUCKET)
            .upload(objectPath, arrayBuffer, {
                contentType: 'image/jpeg',
                upsert: false,
            });

        if (error || !data?.path) {
            console.error('[ProofPhoto] Upload failed:', error);
            return { success: false, error: error?.message || 'Upload failed' };
        }

        const { data: urlData } = storage.storage
            .from(PROOF_PHOTOS_BUCKET)
            .getPublicUrl(data.path);

        const url = urlData.publicUrl;

        const db = getFirebaseDatabase();
        await update(dbRef(db, `/deliveries/${deliveryId}`), {
            proof_photo_url: url,
            proof_photo_uploaded_at: Date.now(),
            proof_photo_storage_path: data.path,
            proof_photo_storage_provider: 'supabase',
        });

        // Best-effort: also mirror into Supabase deliveries table if it exists there.
        // This keeps web/admin views consistent when they’re using Supabase.
        if (supabase) {
            await supabase
                .from('deliveries')
                .update({
                    proof_photo_url: url,
                    delivered_at: new Date().toISOString()
                })
                .or(`id.eq.${deliveryId},tracking_number.eq.${deliveryId}`);
        }

        return { success: true, url };
    } catch (error) {
        console.error('[ProofPhoto] Exception during upload:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Upload a pickup proof photo to Supabase Storage and log to Firebase + Supabase.
 * Same pattern as uploadDeliveryProofPhoto but stored under pickup/ prefix.
 */
export async function uploadPickupPhoto(params: {
    deliveryId: string;
    boxId: string;
    localUri: string;
}): Promise<{ success: boolean; url?: string; error?: string }> {
    const { deliveryId, boxId, localUri } = params;

    try {
        const compression = await compressImage(localUri);
        const uploadUri = compression.success ? compression.compressedUri : localUri;

        // Read file as Base64 to bypass fetch(blob) network issues on Android
        const base64 = await FileSystem.readAsStringAsync(uploadUri, {
            encoding: 'base64', // Use string literal to avoid type errors
        });
        const arrayBuffer = base64ToUint8Array(base64);

        // Ensure auth is synced before upload
        await syncStorageSession();
        const storage = getStorageClient();

        const fileName = `${deliveryId}_${Date.now()}.jpg`;
        const objectPath = `pickup/${boxId}/${fileName}`;

        const { data, error } = await storage.storage
            .from(PROOF_PHOTOS_BUCKET)
            .upload(objectPath, arrayBuffer, {
                contentType: 'image/jpeg',
                upsert: false,
            });

        if (error || !data?.path) {
            console.error('[ProofPhoto] Pickup upload failed:', error);
            return { success: false, error: error?.message || 'Upload failed' };
        }

        const { data: urlData } = storage.storage
            .from(PROOF_PHOTOS_BUCKET)
            .getPublicUrl(data.path);

        const url = urlData.publicUrl;

        const db = getFirebaseDatabase();
        await update(dbRef(db, `/deliveries/${deliveryId}`), {
            pickup_photo_url: url,
            pickup_photo_uploaded_at: Date.now(),
            pickup_photo_storage_path: data.path,
            proof_photo_storage_provider: 'supabase', // Also mark provider here for consistency
        });

        // Mirror into Supabase deliveries table
        if (supabase) {
            await supabase
                .from('deliveries')
                .update({
                    pickup_photo_url: url,
                    picked_up_at: new Date().toISOString()
                })
                .or(`id.eq.${deliveryId},tracking_number.eq.${deliveryId}`);
        }

        return { success: true, url };
    } catch (error) {
        console.error('[ProofPhoto] Exception during pickup upload:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
