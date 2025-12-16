import { Service } from 'typedi';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { LanguageModel } from 'ai';
import { LlmClient } from './types';
import { AiSdkClient } from './AiSdkClient';

@Service()
export class LlmFactory {
    
    getClient(): LlmClient {
        const modelId = process.env.MODEL || 'gpt-4o';
        const isGemini = modelId.startsWith('gemini');
        
        let model: LanguageModel | undefined;

        if (isGemini) {
            // Check for explicit GEMINI_API_KEY (custom) or standard GOOGLE_GENERATIVE_AI_API_KEY
            const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
            
            if (apiKey) {
                // Explicitly create provider with the found API key
                const google = createGoogleGenerativeAI({
                    apiKey: apiKey
                });
                model = google(modelId);
            }
        } else {
            const apiKey = process.env.OPENAI_API_KEY;
            
            if (apiKey) {
                // Explicitly create provider with the found API key
                const openai = createOpenAI({
                    apiKey: apiKey
                });
                model = openai(modelId);
            }
        }

        return new AiSdkClient(model, modelId);
    }
}
