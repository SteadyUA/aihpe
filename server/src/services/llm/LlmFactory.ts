import { Service, Inject } from 'typedi';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { LanguageModel } from 'ai';
import { LlmClient } from './types';
import { AiSdkClient } from './AiSdkClient';
import { OpenaiRawClient } from './OpenaiRawClient';
import { ImageService } from '../image/ImageService';
import { SessionStore } from '../session/SessionStore';
import { LlmProvider } from '../../types/chat';

@Service()
export class LlmFactory {
    @Inject()
    private imageService!: ImageService;

    @Inject()
    private sessionStore!: SessionStore;

    getClient(provider: LlmProvider = 'openai'): LlmClient {
        let modelId = '';
        if (provider === 'google') {
            modelId = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
        } else {
            modelId = process.env.OPENAI_MODEL || 'gpt-4o';
        }

        const isGemini = provider === 'google';

        let model: LanguageModel | undefined;
        // Determine approximate context window
        let maxTokens = 128000;
        if (modelId.includes('gpt-5.1')) {
            maxTokens = 400000;
        } else if (modelId.includes('gemini-3-pro')) {
            maxTokens = 1000000;
        } else if (modelId.includes('gemini-1.5-flash')) {
            maxTokens = 1000000;
        } else if (modelId.includes('claude-3-5')) {
            maxTokens = 200000;
        } else if (modelId.includes('gpt-4')) {
            maxTokens = 128000;
        } else if (modelId.includes('gpt-3.5')) {
            maxTokens = 16000;
        }

        const litellmUrl = process.env.LITELLM_API_URL;
        const litellmKey = process.env.LITELLM_API_KEY;

        if (litellmUrl && litellmKey) {
            return new OpenaiRawClient(
                this.imageService,
                this.sessionStore,
                litellmUrl,
                litellmKey,
                modelId,
                maxTokens
            );
        } else if (isGemini) {
            // Check for explicit GEMINI_API_KEY (custom) or standard GOOGLE_GENERATIVE_AI_API_KEY
            const apiKey =
                process.env.GEMINI_API_KEY ||
                process.env.GOOGLE_GENERATIVE_AI_API_KEY;

            if (apiKey) {
                // Explicitly create provider with the found API key
                const google = createGoogleGenerativeAI({
                    apiKey: apiKey,
                });
                model = google(modelId);
            }
        } else {
            const apiKey = process.env.OPENAI_API_KEY;

            if (apiKey) {
                // Explicitly create provider with the found API key
                const openai = createOpenAI({
                    apiKey: apiKey,
                });
                model = openai(modelId);
            }
        }

        return new AiSdkClient(
            this.imageService,
            this.sessionStore,
            model,
            modelId,
            maxTokens,
        );
    }
}
