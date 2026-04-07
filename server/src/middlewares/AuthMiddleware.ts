import { ExpressMiddlewareInterface } from 'routing-controllers';
import { Service } from 'typedi';
import { Request, Response, NextFunction } from 'express';
import { HttpError } from 'routing-controllers';
import { AuthService } from '../services/AuthService';

@Service()
export class AuthMiddleware implements ExpressMiddlewareInterface {
    constructor(private authService: AuthService) {}
    async use(request: Request, response: Response, next: NextFunction): Promise<any> {
        const authHeader = request.headers['authorization'];
        if (!authHeader) {
            throw new HttpError(401, 'No authorization header provided');
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            throw new HttpError(401, 'Invalid authorization header format');
        }

        try {
            // Verify using AuthService
            const payload = await this.authService.verifyToken(token);

            // Attach user info to request if needed
            (request as any).user = payload;
            next();
        } catch (error) {
            throw new HttpError(401, 'Invalid or expired token');
        }
    }
}
