import { LlmClient, LlmConfig } from './types';

export const FALLBACK_RESPONSE: any = {
    summary: 'API key not configured.',
    files: {},
};

export abstract class BaseLlmClient<TRequest = any, TResult = any> implements LlmClient<TRequest, TResult> {
    protected agentName: string = 'chat';

    constructor(
        protected readonly config: LlmConfig<TRequest, any, TResult>,
        protected readonly maxContextTokens: number = 128000,
    ) { }

    abstract generate(request: TRequest): Promise<TResult>;

    getCapacity(): number {
        return this.maxContextTokens;
    }

    protected formatError(error: unknown): string {
        if (typeof error === 'string') {
            return error;
        }
        if (error && typeof error === 'object' && 'message' in error) {
            return String(
                (error as { message: unknown }).message || 'unknown error',
            );
        }
        return 'unknown error';
    }
}
