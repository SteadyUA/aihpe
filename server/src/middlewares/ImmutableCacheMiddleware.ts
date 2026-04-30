import { ExpressMiddlewareInterface } from 'routing-controllers';
import { Service } from 'typedi';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

@Service()
export class ImmutableCacheMiddleware implements ExpressMiddlewareInterface {
    use(request: Request, response: Response, next: NextFunction): void {
        const urlToHash = request.originalUrl || request.url;
        const etag = `W/"${crypto.createHash('md5').update(urlToHash).digest('hex')}"`;
        
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        response.setHeader('ETag', etag);

        if (request.headers['if-none-match'] === etag) {
            response.status(304).end();
            return;
        }

        next();
    }
}
