/**
 * EC-56: Photo Compression Service for Mobile
 * 
 * Handles client-side image compression before upload to reduce
 * bandwidth usage and improve upload speeds.
 * 
 * Features:
 * - Image resizing (800px max dimension)
 * - JPEG quality reduction (60%)
 * - Priority queue for uploads (GPS > Status > Photo)
 * - Resumable uploads support
 */

import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

// ==================== EC-56: Configuration ====================

export const COMPRESSION_CONFIG = {
    /** Maximum dimension for any side of the image */
    MAX_DIMENSION: 800,
    
    /** JPEG quality (0-1) */
    JPEG_QUALITY: 0.6,
    
    /** Minimum file size to trigger compression (bytes) */
    MIN_SIZE_FOR_COMPRESSION: 50 * 1024, // 50KB
    
    /** Maximum file size after compression (bytes) */
    TARGET_MAX_SIZE: 100 * 1024, // 100KB
    
    /** Chunk size for resumable uploads (bytes) */
    CHUNK_SIZE: 4096,
    
    /** Minimum acceptable compression ratio */
    MIN_COMPRESSION_RATIO: 0.3,
};

// EC-56: Upload priority levels
export enum UploadPriority {
    GPS = 0,      // GPS location updates - highest priority
    STATUS = 1,   // Delivery status changes
    PHOTO = 2,    // Photo uploads - lowest priority
}

// ==================== Types ====================

export interface CompressionResult {
    success: boolean;
    originalUri: string;
    compressedUri: string;
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
    originalDimensions: { width: number; height: number };
    compressedDimensions: { width: number; height: number };
    error?: string;
}

export interface PhotoUploadItem {
    id: string;
    deliveryId: string;
    uri: string;
    priority: UploadPriority;
    originalSize: number;
    compressedSize: number;
    isCompressed: boolean;
    uploadedBytes: number;
    totalBytes: number;
    status: 'pending' | 'compressing' | 'uploading' | 'completed' | 'failed';
    retryCount: number;
    createdAt: number;
    lastAttemptAt?: number;
    error?: string;
}

export interface UploadQueueState {
    items: PhotoUploadItem[];
    totalBytesSaved: number;
    averageCompressionRatio: number;
    estimatedBandwidthBps: number;
}

// ==================== Compression Functions ====================

/**
 * EC-56: Compress an image to reduce file size
 * 
 * @param uri Original image URI
 * @returns CompressionResult with compressed image details
 */
export async function compressImage(uri: string): Promise<CompressionResult> {
    const result: CompressionResult = {
        success: false,
        originalUri: uri,
        compressedUri: uri,
        originalSize: 0,
        compressedSize: 0,
        compressionRatio: 1,
        originalDimensions: { width: 0, height: 0 },
        compressedDimensions: { width: 0, height: 0 },
    };

    try {
        // Get original file info
        const originalInfo = await FileSystem.getInfoAsync(uri, { size: true });
        if (!originalInfo.exists) {
            result.error = 'Original file not found';
            return result;
        }
        
        result.originalSize = (originalInfo as any).size || 0;
        
        // Skip compression if file is already small
        if (result.originalSize < COMPRESSION_CONFIG.MIN_SIZE_FOR_COMPRESSION) {
            console.log('[EC-56] Image already small, skipping compression');
            result.success = true;
            result.compressedUri = uri;
            result.compressedSize = result.originalSize;
            result.compressionRatio = 1;
            return result;
        }

        // Get original dimensions
        const originalDimensions = await getImageDimensions(uri);
        result.originalDimensions = originalDimensions;

        // Calculate new dimensions maintaining aspect ratio
        const { width, height } = calculateResizeDimensions(
            originalDimensions.width,
            originalDimensions.height,
            COMPRESSION_CONFIG.MAX_DIMENSION
        );
        
        result.compressedDimensions = { width, height };

        // Compress the image
        const manipResult = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: { width, height } }],
            {
                compress: COMPRESSION_CONFIG.JPEG_QUALITY,
                format: ImageManipulator.SaveFormat.JPEG,
            }
        );

        result.compressedUri = manipResult.uri;

        // Get compressed file size
        const compressedInfo = await FileSystem.getInfoAsync(manipResult.uri, { size: true });
        result.compressedSize = (compressedInfo as any).size || 0;
        
        // Calculate compression ratio
        if (result.originalSize > 0) {
            result.compressionRatio = result.compressedSize / result.originalSize;
        }

        result.success = true;
        
        console.log(`[EC-56] Compression: ${formatBytes(result.originalSize)} -> ${formatBytes(result.compressedSize)} (${(result.compressionRatio * 100).toFixed(1)}%)`);

        return result;
    } catch (error) {
        console.error('[EC-56] Compression failed:', error);
        result.error = error instanceof Error ? error.message : 'Compression failed';
        return result;
    }
}

/**
 * Get image dimensions from URI
 */
async function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
    // For React Native, we'd use Image.getSize, but in Expo we can use ImageManipulator
    try {
        // Get the image info without manipulation
        const result = await ImageManipulator.manipulateAsync(uri, [], { base64: false });
        return { width: result.width, height: result.height };
    } catch {
        return { width: 0, height: 0 };
    }
}

/**
 * Calculate resize dimensions maintaining aspect ratio
 */
export function calculateResizeDimensions(
    originalWidth: number,
    originalHeight: number,
    maxDimension: number
): { width: number; height: number } {
    if (originalWidth <= maxDimension && originalHeight <= maxDimension) {
        return { width: originalWidth, height: originalHeight };
    }

    const aspectRatio = originalWidth / originalHeight;
    
    if (originalWidth > originalHeight) {
        // Landscape: width is the limiting factor
        return {
            width: maxDimension,
            height: Math.round(maxDimension / aspectRatio),
        };
    } else {
        // Portrait or square: height is the limiting factor
        return {
            width: Math.round(maxDimension * aspectRatio),
            height: maxDimension,
        };
    }
}

// ==================== Upload Queue Management ====================

let uploadQueue: PhotoUploadItem[] = [];
let totalBytesSaved = 0;
let compressionCount = 0;
let totalOriginalBytes = 0;
let totalCompressedBytes = 0;
let estimatedBandwidthBps = 10000; // Default 10KB/s

/**
 * EC-56: Add photo to upload queue with compression
 */
export async function queuePhotoForUpload(
    deliveryId: string,
    uri: string,
    priority: UploadPriority = UploadPriority.PHOTO
): Promise<PhotoUploadItem> {
    const id = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const item: PhotoUploadItem = {
        id,
        deliveryId,
        uri,
        priority,
        originalSize: 0,
        compressedSize: 0,
        isCompressed: false,
        uploadedBytes: 0,
        totalBytes: 0,
        status: 'pending',
        retryCount: 0,
        createdAt: Date.now(),
    };

    // Get original size first
    const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
    item.originalSize = (fileInfo as any).size || 0;
    item.totalBytes = item.originalSize;

    // Attempt compression
    item.status = 'compressing';
    const compression = await compressImage(uri);
    
    if (compression.success) {
        item.uri = compression.compressedUri;
        item.compressedSize = compression.compressedSize;
        item.totalBytes = compression.compressedSize;
        item.isCompressed = compression.compressionRatio < 1;
        
        // Update statistics
        if (item.isCompressed) {
            totalBytesSaved += (item.originalSize - item.compressedSize);
            compressionCount++;
            totalOriginalBytes += item.originalSize;
            totalCompressedBytes += item.compressedSize;
        }
    } else {
        item.compressedSize = item.originalSize;
    }
    
    item.status = 'pending';
    uploadQueue.push(item);
    
    // Sort by priority
    sortQueueByPriority();
    
    console.log(`[EC-56] Queued photo: ${id} (${formatBytes(item.totalBytes)}, priority: ${UploadPriority[priority]})`);
    
    return item;
}

/**
 * EC-56: Check if photo uploads should yield to higher priority
 */
export function shouldYieldToHigherPriority(
    hasGpsPending: boolean,
    hasStatusPending: boolean
): boolean {
    return hasGpsPending || hasStatusPending;
}

/**
 * EC-56: Get upload progress for an item
 */
export function getUploadProgress(itemId: string): number {
    const item = uploadQueue.find(i => i.id === itemId);
    if (!item || item.totalBytes === 0) return 0;
    return item.uploadedBytes / item.totalBytes;
}

/**
 * EC-56: Get total bytes saved by compression
 */
export function getTotalBytesSaved(): number {
    return totalBytesSaved;
}

/**
 * EC-56: Get average compression ratio
 */
export function getAverageCompressionRatio(): number {
    if (compressionCount === 0 || totalOriginalBytes === 0) return 1;
    return totalCompressedBytes / totalOriginalBytes;
}

/**
 * EC-56: Get estimated upload time
 */
export function estimateUploadTime(remainingBytes: number): number {
    if (estimatedBandwidthBps === 0) return 0;
    return Math.ceil((remainingBytes / estimatedBandwidthBps) * 1000); // ms
}

/**
 * EC-56: Update bandwidth estimate based on recent upload
 */
export function updateBandwidthEstimate(bytesSent: number, durationMs: number): void {
    if (durationMs === 0) return;
    
    const newBandwidth = (bytesSent * 1000) / durationMs;
    
    // Exponential moving average: 80% old, 20% new
    estimatedBandwidthBps = Math.round((estimatedBandwidthBps * 0.8) + (newBandwidth * 0.2));
    
    console.log(`[EC-56] Updated bandwidth estimate: ${formatBytes(estimatedBandwidthBps)}/s`);
}

/**
 * EC-56: Get current queue state
 */
export function getQueueState(): UploadQueueState {
    return {
        items: [...uploadQueue],
        totalBytesSaved,
        averageCompressionRatio: getAverageCompressionRatio(),
        estimatedBandwidthBps,
    };
}

/**
 * EC-56: Clear completed items from queue
 */
export function clearCompletedItems(): void {
    uploadQueue = uploadQueue.filter(item => item.status !== 'completed');
}

/**
 * EC-56: Clear all items from queue
 */
export function clearQueue(): void {
    uploadQueue = [];
}

/**
 * EC-56: Get pending items count
 */
export function getPendingCount(): number {
    return uploadQueue.filter(item => item.status === 'pending' || item.status === 'uploading').length;
}

/**
 * Sort queue by priority (lower number = higher priority)
 */
function sortQueueByPriority(): void {
    uploadQueue.sort((a, b) => a.priority - b.priority);
}

// ==================== Helper Functions ====================

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/**
 * EC-56: Validate compression result
 */
export function isValidCompression(result: CompressionResult): boolean {
    if (!result.success) return false;
    if (result.compressedSize > result.originalSize) return false;
    if (result.compressionRatio > 1) return false;
    return true;
}

/**
 * EC-56: Check if image needs compression
 */
export function needsCompression(fileSize: number): boolean {
    return fileSize > COMPRESSION_CONFIG.MIN_SIZE_FOR_COMPRESSION;
}

export default {
    compressImage,
    queuePhotoForUpload,
    shouldYieldToHigherPriority,
    getUploadProgress,
    getTotalBytesSaved,
    getAverageCompressionRatio,
    estimateUploadTime,
    updateBandwidthEstimate,
    getQueueState,
    clearCompletedItems,
    clearQueue,
    getPendingCount,
    formatBytes,
    formatDuration,
    calculateResizeDimensions,
    COMPRESSION_CONFIG,
    UploadPriority,
};
