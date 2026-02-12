import { Service, Container } from 'typedi';
import { ImageService } from './ImageService';


@Service()
export class ImageServiceFactory {
    create(): ImageService {
        const litellmUrl = process.env.LITELLM_API_URL;
        const litellmKey = process.env.LITELLM_API_KEY;

        if (litellmUrl && litellmKey) {
            // console.log('Using LiteLLMImageService');
            const { LiteLLMImageService } = require('./LiteLLMImageService');
            return Container.get(LiteLLMImageService);
        }

        // console.log('Using GoogleImageService');
        const { GoogleImageService } = require('./GoogleImageService');
        return Container.get(GoogleImageService);
    }
}
