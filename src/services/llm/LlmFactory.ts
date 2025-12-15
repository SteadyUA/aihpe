import { Service, Inject } from 'typedi';
import { LlmClient } from './types';
import { OpenAiClient } from './OpenAiClient';
import { GeminiClient } from './GeminiClient';

@Service()
export class LlmFactory {
    // We can let TypeDI manage the instances as singletons or create them here.
    // Since they hold state (client instance), singletons via DI is good.

    constructor(
        @Inject(() => OpenAiClient) private readonly openAiClient: OpenAiClient,
        @Inject(() => GeminiClient) private readonly geminiClient: GeminiClient,
    ) { }

    getClient(): LlmClient {
        const model = process.env.MODEL || 'gpt-5.1-codex';

        if (model.startsWith('gemini')) {
            return this.geminiClient;
        }

        return this.openAiClient;
    }
}
