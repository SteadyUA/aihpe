import { ExpressMiddlewareInterface } from 'routing-controllers';
import { Service } from 'typedi';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError } from 'routing-controllers';

// Should be shared/config but defined here for now
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-12345';

@Service()
export class AuthMiddleware implements ExpressMiddlewareInterface {
    use(request: Request, response: Response, next: NextFunction): any {
        const authHeader = request.headers['authorization'];
        if (!authHeader) {
            throw new HttpError(401, 'No authorization header provided');
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            throw new HttpError(401, 'Invalid authorization header format');
        }

        try {
            const payload = jwt.verify(token, JWT_SECRET);
            // Attach user info to request if needed
            (request as any).user = payload;
            next();
        } catch (error) {
            throw new HttpError(401, 'Invalid or expired token');
        }
    }
}
