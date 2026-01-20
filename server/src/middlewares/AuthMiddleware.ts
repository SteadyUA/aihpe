import { ExpressMiddlewareInterface } from 'routing-controllers';
import { Service } from 'typedi';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError } from 'routing-controllers';
import { AppDataSource } from '../data-source';
import { Account } from '../entities/Account';


@Service()
export class AuthMiddleware implements ExpressMiddlewareInterface {
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
            // Decode first without verification to find account
            const decoded = jwt.decode(token) as any;
            if (!decoded || !decoded.accountId) {
                throw new HttpError(401, 'Invalid token structure');
            }

            // Fetch account to get the secret
            const accountRepository = AppDataSource.getRepository(Account);
            const account = await accountRepository.findOneBy({ id: Number(decoded.accountId) });

            if (!account) {
                throw new HttpError(401, 'User not found');
            }

            // Verify using the account's secret
            const payload = jwt.verify(token, account.tokenSecret);

            // Attach user info to request if needed
            (request as any).user = payload;
            next();
        } catch (error) {
            throw new HttpError(401, 'Invalid or expired token');
        }
    }
}
