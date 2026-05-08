import { getDropoffProofGate } from '../services/dropoffProofGateService';

const baseGate = {
    otpConfirmedByCloud: true,
    espPreviewRendered: false,
    espFullProofRendered: false,
    fallbackPhotoRendered: false,
    hasFallbackPhoto: false,
    fallbackModeActive: false,
    proofWaitTimedOut: false,
    proofRenderFailed: false,
};

describe('Dropoff proof gate', () => {
    it('blocks swipe when a proof URL exists but no image has rendered', () => {
        const result = getDropoffProofGate(baseGate);

        expect(result.canSwipe).toBe(false);
        expect(result.visibleProofLoaded).toBe(false);
    });

    it('allows swipe after ESP preview renders', () => {
        const result = getDropoffProofGate({
            ...baseGate,
            espPreviewRendered: true,
        });

        expect(result.canSwipe).toBe(true);
    });

    it('allows swipe after full ESP proof renders', () => {
        const result = getDropoffProofGate({
            ...baseGate,
            espFullProofRendered: true,
        });

        expect(result.canSwipe).toBe(true);
    });

    it('exposes fallback after ESP proof render failure', () => {
        const result = getDropoffProofGate({
            ...baseGate,
            proofRenderFailed: true,
        });

        expect(result.fallbackAllowed).toBe(true);
        expect(result.canSwipe).toBe(false);
    });

    it('allows fallback swipe only after fallback photo renders', () => {
        const notRendered = getDropoffProofGate({
            ...baseGate,
            fallbackModeActive: true,
            hasFallbackPhoto: true,
            fallbackPhotoRendered: false,
        });
        const rendered = getDropoffProofGate({
            ...baseGate,
            fallbackModeActive: true,
            hasFallbackPhoto: true,
            fallbackPhotoRendered: true,
        });

        expect(notRendered.canSwipe).toBe(false);
        expect(rendered.canSwipe).toBe(true);
    });

    it('allows fallback when proof preview wait times out', () => {
        const result = getDropoffProofGate({
            ...baseGate,
            proofWaitTimedOut: true,
            hasFallbackPhoto: true,
            fallbackPhotoRendered: true,
        });

        expect(result.fallbackAllowed).toBe(true);
        expect(result.canSwipe).toBe(true);
    });
});
