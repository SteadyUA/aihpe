import { Service, Container } from 'typedi';
import { LlmImageService } from './LlmImageService';

@Service()
export class LlmImageServiceFactory {
    create(): LlmImageService {
        const litellmUrl = process.env.LITELLM_API_URL;
        const litellmKey = process.env.LITELLM_API_KEY;

        if (litellmUrl && litellmKey) {
            const { LiteLLMLlmImageService } = require('./LiteLLMLlmImageService');
            return Container.get(LiteLLMLlmImageService);
        }

        const { GoogleLlmImageService } = require('./GoogleLlmImageService');
        return Container.get(GoogleLlmImageService);
    }
}
