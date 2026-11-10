/** DSH release series this adapter has been verified against; keep in sync with protocol-contract.json. */
export declare const VERIFIED_HOST_SERIES: string[];
export declare const hostVerified: (version: string | undefined) => boolean;
export declare function assistantBaseline(attempt: any): {
    text: string;
    reasoning: string;
    startedAfterSeq: any;
};
export declare function createModernAdapter(ctx: any, register: (route: any) => void): {
    dispose: () => Promise<void>;
};
