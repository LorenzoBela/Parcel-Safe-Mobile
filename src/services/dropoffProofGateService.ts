export interface DropoffProofGateInput {
    otpConfirmedByCloud: boolean;
    espPreviewRendered: boolean;
    espFullProofRendered: boolean;
    fallbackPhotoRendered: boolean;
    hasFallbackPhoto: boolean;
    fallbackModeActive: boolean;
    proofWaitTimedOut: boolean;
    proofRenderFailed: boolean;
}

export interface DropoffProofGateResult {
    canSwipe: boolean;
    fallbackAllowed: boolean;
    visibleProofLoaded: boolean;
}

export function getDropoffProofGate(input: DropoffProofGateInput): DropoffProofGateResult {
    const espProofRendered = input.espPreviewRendered || input.espFullProofRendered;
    const fallbackAllowed =
        input.fallbackModeActive ||
        input.proofWaitTimedOut ||
        (input.proofRenderFailed && !espProofRendered);
    const fallbackProofRendered =
        fallbackAllowed && input.hasFallbackPhoto && input.fallbackPhotoRendered;
    const visibleProofLoaded = espProofRendered || fallbackProofRendered;

    return {
        canSwipe: input.otpConfirmedByCloud && visibleProofLoaded,
        fallbackAllowed,
        visibleProofLoaded,
    };
}
