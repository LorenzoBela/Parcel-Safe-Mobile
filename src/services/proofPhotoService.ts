import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

export async function uploadDeliveryProofPhoto(params: {
    deliveryId: string;
    boxId: string;
    localUri: string;
}): Promise<{ success: boolean; url?: string; error?: string }> {
    const { deliveryId, boxId, localUri } = params;

    try {
        const compression = await compressImage(localUri);
        const uploadUri = compression.success ? compression.compressedUri : localUri;

        const response = await fetch(uploadUri);
        const blob = await response.blob();

        const storage = getStorageClient();
        const fileName = `${deliveryId}_${Date.now()}.jpg`;
        const objectPath = `deliveries/${boxId}/${fileName}`;

        const { data, error } = await storage.storage
            .from(PROOF_PHOTOS_BUCKET)
            .upload(objectPath, blob, {
                contentType: 'image/jpeg',
                upsert: false,
            });

        if (error || !data?.path) {
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
                .update({ proof_photo_url: url })
                .or(`id.eq.${deliveryId},tracking_number.eq.${deliveryId}`);
        }

        return { success: true, url };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
