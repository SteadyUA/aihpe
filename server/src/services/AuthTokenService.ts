import { Service } from 'typedi';
import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_EXPIRATION = '1h'; // 1 hour
const REFRESH_TOKEN_EXPIRATION = '7d'; // 7 days

export interface TokenPayload {
    accountId: number;
    login?: string;
    type?: string;
}

@Service()
export class AuthTokenService {
    generateTokens(account: { id: number; login: string; tokenSecret: string }): { accessToken: string; refreshToken: string } {
        const accessToken = jwt.sign({ accountId: account.id, login: account.login }, account.tokenSecret, { expiresIn: ACCESS_TOKEN_EXPIRATION });
        const refreshToken = jwt.sign({ accountId: account.id, type: 'refresh' }, account.tokenSecret, { expiresIn: REFRESH_TOKEN_EXPIRATION });

        return { accessToken, refreshToken };
    }

    verifyToken(token: string, tokenSecret: string): TokenPayload {
        return jwt.verify(token, tokenSecret) as TokenPayload;
    }

    verifyRefreshToken(token: string, tokenSecret: string): TokenPayload {
        return jwt.verify(token, tokenSecret) as TokenPayload;
    }

    decodeTokenUnverified(token: string): TokenPayload | null {
        return jwt.decode(token) as TokenPayload | null;
    }
}
