import { Service } from 'typedi';
import { AccountService } from './AccountService';
import { AuthTokenService } from './AuthTokenService';

@Service()
export class AuthService {
    constructor(
        private accountService: AccountService,
        private authTokenService: AuthTokenService
    ) {}

    async login(login: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
        const account = await this.accountService.validateCredentials(login, password);
        return this.authTokenService.generateTokens(account);
    }

    async refresh(incomingRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
        const decoded = this.authTokenService.decodeTokenUnverified(incomingRefreshToken);
        if (!decoded || !decoded.accountId || decoded.type !== 'refresh') {
            throw new Error('Invalid token structure or type');
        }

        const account = await this.accountService.findById(Number(decoded.accountId));
        if (!account) {
            throw new Error('Account not found');
        }

        try {
            this.authTokenService.verifyRefreshToken(incomingRefreshToken, account.tokenSecret);
        } catch (e) {
            throw new Error('Invalid or expired refresh token');
        }

        return this.authTokenService.generateTokens(account);
    }

    async verifyToken(token: string): Promise<any> {
        const decoded = this.authTokenService.decodeTokenUnverified(token);
        if (!decoded || !decoded.accountId) {
            throw new Error('Invalid token structure');
        }

        const account = await this.accountService.findById(Number(decoded.accountId));
        if (!account) {
            throw new Error('User not found');
        }

        return this.authTokenService.verifyToken(token, account.tokenSecret);
    }
}
