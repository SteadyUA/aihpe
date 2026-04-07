import { Interceptor, InterceptorInterface, Action, InternalServerError } from 'routing-controllers';
import { Service } from 'typedi';
import { validateOrReject, getMetadataStorage } from 'class-validator';

@Service()
@Interceptor()
export class ResponseValidationInterceptor implements InterceptorInterface {
    async intercept(action: Action, content: any): Promise<any> {
        // If content is an object and not an array, check if it has validation decorators
        if (content && typeof content === 'object' && !Array.isArray(content) && !(content instanceof Buffer)) {
            const metadatas = getMetadataStorage().getTargetValidationMetadatas(content.constructor, '', true, false);
            
            if (metadatas.length > 0) {
                try {
                    // validateOrReject will throw if decorators are present and validation fails
                    await validateOrReject(content, { 
                        validationError: { target: false },
                        stopAtFirstError: true 
                    });
                } catch (errors) {
                    console.error('CRITICAL: Response validation failed!', errors);
                    // Throw 500 since this is a server-side contract violation
                    throw new InternalServerError('Internal Server Error: Invalid response format');
                }
            }
        }
        return content;
    }
}
