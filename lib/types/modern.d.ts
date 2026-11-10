import type { IncomingMessage, ServerResponse } from 'node:http';
/** DSH release series this adapter has been verified against; keep in sync with protocol-contract.json. */
export declare const VERIFIED_HOST_SERIES: string[];
export declare const hostVerified: (version: string | undefined) => boolean;
export declare function assistantBaseline(attempt: any): {
    text: string;
    reasoning: string;
    startedAfterSeq: any;
};
/** Responses above this size are gzip-compressed when the phone accepts it (session.history can be megabytes). */
export declare const COMPRESS_MIN_BYTES = 4096;
/**
 * JSON reply that compresses large bodies off the event loop (zlib runs on the thread pool).
 * The phone's HTTP client sends Accept-Encoding: gzip and inflates transparently.
 */
export declare function replyJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): Promise<void>;
export declare function createModernAdapter(ctx: any, register: (route: any) => void): {
    dispose: () => Promise<void>;
};
