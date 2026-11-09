import tls from 'node:tls';
import type { Duplex } from 'node:stream';
import type { Server } from 'node:http';
/** WebSocket subprotocol carrying raw TLS records between the phone and this computer. */
export declare const SECURE_PROTOCOL = "dsh-e2e.1";
export declare const SECURE_PATH = "/api/remote-access/secure";
/** Matches the tunnel CHUNK so one frame never needs to be split by the relay. */
export declare const SECURE_MAX_FRAME = 32768;
export type SecureMaterial = {
    key: string;
    cert: string;
    pin: string;
    safetyCode: string;
};
/** Pin = SHA-256 of SubjectPublicKeyInfo. Phones check only this, never chain, name or validity. */
export declare const spkiPin: (spki: Buffer) => string;
export declare const safetyCode: (pin: string) => string;
export declare function createSelfSignedCertificate(privateKeyPem: string): string;
/** One long-term key per installation identity; a broken file refuses remote access instead of silently re-keying. */
export declare function loadSecureMaterial(home: string): SecureMaterial;
export declare const PEER_ADDRESS: unique symbol;
/** Terminates the phone's TLS inside this process and hands plaintext HTTP to the private gateway. */
export declare function createSecureTerminator(material: SecureMaterial, gateway: Server): {
    accept(transport: Duplex, peer?: string): tls.TLSSocket;
    readonly size: number;
    close(): void;
};
/** Direct LAN/public entry: a WebSocket on the host port whose binary frames are the TLS byte stream. */
export declare function createDirectSecureEndpoint(terminator: ReturnType<typeof createSecureTerminator>, maxConnections?: number): {
    handleUpgrade(req: any, socket: Duplex, head: Buffer): void;
    close(): void;
};
