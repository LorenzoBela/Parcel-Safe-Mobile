import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import {
    FaceDetectionProvider,
    RNMLKitFaceDetectorOptions,
    useFaceDetection,
    useFacesInPhoto,
} from '@infinitered/react-native-mlkit-face-detection';
import { PremiumAlert } from '../../../services/PremiumAlertService';

type FallbackColors = {
    card: string;
    textTitle: string;
    textLabel: string;
    borderHard: string;
    successBg: string;
    successText: string;
    errorBg: string;
    errorText: string;
    warningBg: string;
    warningText: string;
    blueBg: string;
    blueText: string;
};

interface RiderPhoneOtpFaceFallbackProps {
    expectedOtp?: string | null;
    subjectLabel: string;
    proofLabel: string;
    isDarkMode: boolean;
    colors: FallbackColors;
    disabled?: boolean;
    onVerified: (photoUri: string) => void;
}

const FACE_DETECTOR_OPTIONS: RNMLKitFaceDetectorOptions = {
    performanceMode: 'accurate',
    landmarkMode: true,
    classificationMode: true,
    minFaceSize: 0.08,
    isTrackingEnabled: false,
};

function sanitizeOtp(value: string): string {
    return value.replace(/\D/g, '').slice(0, 6);
}

function RiderPhoneOtpFaceFallbackContent({
    expectedOtp,
    subjectLabel,
    proofLabel,
    isDarkMode,
    colors: c,
    disabled = false,
    onVerified,
}: RiderPhoneOtpFaceFallbackProps) {
    const [otpInput, setOtpInput] = useState('');
    const [photoUri, setPhotoUri] = useState<string | null>(null);
    const [detectingUri, setDetectingUri] = useState<string | undefined>();
    const [verifiedUri, setVerifiedUri] = useState<string | null>(null);
    const [errorText, setErrorText] = useState<string | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);

    const normalizedExpectedOtp = useMemo(() => sanitizeOtp(expectedOtp || ''), [expectedOtp]);
    const faceDetector = useFaceDetection();
    const { faces, error, status, clearFaces } = useFacesInPhoto(detectingUri);
    const isDetecting = status === 'modelLoading' || status === 'detecting';
    const otpReady = otpInput.length === 6 && normalizedExpectedOtp.length === 6;
    const isVerified = !!verifiedUri;

    useEffect(() => {
        faceDetector.initialize(FACE_DETECTOR_OPTIONS).catch(() => {
            setErrorText('Face checker is unavailable. Reopen this fallback and try again.');
        });
    }, [faceDetector]);

    useEffect(() => {
        if (!detectingUri || isDetecting) return;

        if (error || status === 'error') {
            setErrorText('Face check failed. Retake the photo with the face clearly visible.');
            setDetectingUri(undefined);
            return;
        }

        if (status === 'done') {
            if (faces.length > 0 && photoUri) {
                setVerifiedUri(photoUri);
                setErrorText(null);
                onVerified(photoUri);
            } else {
                setVerifiedUri(null);
                setErrorText('No face was detected. Retake the photo with the face centered and well lit.');
            }
            setDetectingUri(undefined);
        }
    }, [detectingUri, error, faces.length, isDetecting, onVerified, photoUri, status]);

    const handleCapture = async () => {
        const sanitizedInput = sanitizeOtp(otpInput);
        setOtpInput(sanitizedInput);
        setErrorText(null);

        if (normalizedExpectedOtp.length !== 6) {
            PremiumAlert.alert('OTP Unavailable', 'The OTP is still syncing. Wait a moment and try again.');
            return;
        }

        if (sanitizedInput !== normalizedExpectedOtp) {
            setVerifiedUri(null);
            setPhotoUri(null);
            setErrorText('Wrong OTP. Ask the customer to check their app and enter the 6-digit code again.');
            return;
        }

        try {
            setIsCapturing(true);
            const { status: permissionStatus } = await ImagePicker.requestCameraPermissionsAsync();
            if (permissionStatus !== 'granted') {
                PremiumAlert.alert('Permission Required', 'Camera access is needed for rider phone fallback verification.');
                return;
            }

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.7,
                allowsEditing: false,
                cameraType: ImagePicker.CameraType.front,
            });

            if (!result.canceled && result.assets?.[0]?.uri) {
                const uri = result.assets[0].uri;
                clearFaces?.();
                setVerifiedUri(null);
                setPhotoUri(uri);
                setDetectingUri(uri);
            }
        } catch {
            PremiumAlert.alert('Camera Error', 'Unable to capture the fallback face photo.');
        } finally {
            setIsCapturing(false);
        }
    };

    const statusConfig = isVerified
        ? {
            bg: c.successBg,
            color: c.successText,
            text: 'Phone OTP and face photo verified.',
        }
        : errorText
            ? {
                bg: c.errorBg,
                color: c.errorText,
                text: errorText,
            }
            : {
                bg: c.warningBg,
                color: c.warningText,
                text: 'Last-resort fallback. Only use if the box keypad or camera is unavailable.',
            };

    return (
        <View style={[styles.panel, { borderColor: c.borderHard, backgroundColor: c.card }]}>
            <Text style={[styles.title, { color: c.textTitle }]}>Rider Phone Fallback</Text>
            <Text style={[styles.body, { color: c.textLabel }]}>
                Have {subjectLabel} enter the OTP here, then take a clear face photo.
            </Text>

            <View style={[styles.status, { backgroundColor: statusConfig.bg }]}>
                <Text style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.text}</Text>
            </View>

            <TextInput
                mode="outlined"
                label="6-digit OTP"
                value={otpInput}
                onChangeText={(value) => {
                    setOtpInput(sanitizeOtp(value));
                    setErrorText(null);
                }}
                keyboardType="number-pad"
                maxLength={6}
                secureTextEntry
                disabled={disabled || isCapturing || isDetecting || isVerified}
                style={[styles.input, { backgroundColor: isDarkMode ? '#18181b' : '#ffffff' }]}
                textColor={c.textTitle}
                outlineColor={c.borderHard}
                activeOutlineColor={c.blueText}
            />

            <Button
                mode="contained"
                icon={isVerified ? 'check-circle' : 'camera'}
                onPress={handleCapture}
                disabled={disabled || !otpReady || isCapturing || isDetecting || isVerified}
                loading={isCapturing || isDetecting}
                buttonColor={isVerified ? c.successText : (isDarkMode ? '#f4f4f5' : '#18181b')}
                textColor={isDarkMode && !isVerified ? '#18181b' : '#ffffff'}
                style={styles.action}
            >
                {isVerified ? 'Verified' : isDetecting ? 'Checking face...' : `Verify OTP & Capture ${proofLabel}`}
            </Button>

            {photoUri && (
                <View style={[styles.photoPreview, { borderColor: isVerified ? c.successText : c.borderHard }]}>
                    <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
                </View>
            )}
        </View>
    );
}

export default function RiderPhoneOtpFaceFallback(props: RiderPhoneOtpFaceFallbackProps) {
    return (
        <FaceDetectionProvider options={FACE_DETECTOR_OPTIONS} deferInitialization>
            <RiderPhoneOtpFaceFallbackContent {...props} />
        </FaceDetectionProvider>
    );
}

const styles = StyleSheet.create({
    panel: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
        gap: 12,
    },
    title: {
        fontSize: 15,
        fontFamily: 'Inter_700Bold',
    },
    body: {
        fontSize: 13,
        lineHeight: 18,
        fontFamily: 'Inter_500Medium',
    },
    status: {
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    statusText: {
        fontSize: 12,
        lineHeight: 16,
        fontFamily: 'Inter_600SemiBold',
        textAlign: 'center',
    },
    input: {
        fontSize: 18,
        fontFamily: 'Inter_700Bold',
        letterSpacing: 0,
    },
    action: {
        borderRadius: 8,
    },
    photoPreview: {
        borderWidth: 2,
        borderRadius: 16,
        overflow: 'hidden',
    },
    photo: {
        width: '100%',
        height: 220,
    },
});
