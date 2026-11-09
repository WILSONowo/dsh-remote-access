export type PairingPayload = {
    v: number;
    server: string;
    hostId: string;
    computerId: string;
    name: string;
    ticket: string;
    expiresAt: number;
    pin: string;
};
export type DirectPayload = {
    address: string;
    name: string;
    pin: string;
};
/** Compact v3: v2 fields plus the computer's 32-byte TLS public-key pin (see docs/e2e-secure-channel.md). */
export declare function encodePairingLink(payload: PairingPayload): string;
/** Direct address QR: pin, base address and display name. Scanning still requires the code or desktop approval. */
export declare function encodeDirectLink(payload: DirectPayload): string;
