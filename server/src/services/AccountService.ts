import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Service } from 'typedi';
import { AppDataSource } from '../data-source';
import { Account } from '../entities/Account';

const ACCESS_TOKEN_EXPIRATION = '1h'; // 1 hour
const REFRESH_TOKEN_EXPIRATION = '7d'; // 7 days

@Service()
export class AccountService {
    private get accountRepository() {
        return AppDataSource.getRepository(Account);
    }

    private hashPassword(password: string): string {
        const salt = process.env.SALT;
        if (!salt) {
            throw new Error('SALT environment variable is not set');
        }
        return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    }

    async createAccount(login: string, password: string): Promise<number> {
        const passwordHash = this.hashPassword(password);

        // Check if login already exists
        const existing = await this.accountRepository.findOneBy({ login });
        if (existing) {
            throw new Error(`Account with login "${login}" already exists`);
        }

        const account = new Account();
        account.login = login;
        account.passwordHash = passwordHash;
        account.tokenSecret = crypto.randomBytes(32).toString('hex');

        const saved = await this.accountRepository.save(account);
        return saved.id;
    }

    async verifyPassword(login: string, password: string): Promise<void> {
        const account = await this.accountRepository.findOneBy({ login });
        if (!account) {
            throw new Error(`Account with login "${login}" not found`);
        }

        const hash = this.hashPassword(password);
        if (hash !== account.passwordHash) {
            throw new Error('Invalid password');
        }
    }

    async changePassword(login: string, newPass: string): Promise<void> {
        const account = await this.accountRepository.findOneBy({ login });
        if (!account) {
            throw new Error(`Account with login "${login}" not found`);
        }

        const newHash = this.hashPassword(newPass);
        account.passwordHash = newHash;
        // Rotate secret to invalidate all existing tokens
        account.tokenSecret = crypto.randomBytes(32).toString('hex');

        await this.accountRepository.save(account);
    }

    async login(login: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
        const account = await this.accountRepository.findOneBy({ login });
        if (!account) {
            throw new Error('Invalid login or password');
        }

        const inputHash = this.hashPassword(password);
        if (inputHash !== account.passwordHash) {
            throw new Error('Invalid login or password');
        }

        // Generate tokens
        const accessToken = jwt.sign({ accountId: account.id, login: account.login }, account.tokenSecret, { expiresIn: ACCESS_TOKEN_EXPIRATION });
        const refreshToken = jwt.sign({ accountId: account.id, type: 'refresh' }, account.tokenSecret, { expiresIn: REFRESH_TOKEN_EXPIRATION });

        return { accessToken, refreshToken };
    }

    async refresh(incomingRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
        // Decode without verifying to get accountId
        const payload = jwt.decode(incomingRefreshToken) as any;

        if (!payload || payload.type !== 'refresh' || !payload.accountId) {
            throw new Error('Invalid token type');
        }

        const account = await this.accountRepository.findOneBy({ id: Number(payload.accountId) });
        if (!account) {
            throw new Error('Account not found');
        }

        // Verify with account-specific secret
        try {
            jwt.verify(incomingRefreshToken, account.tokenSecret);
        } catch (e) {
            throw new Error('Invalid or expired refresh token');
        }

        // Rotate tokens
        const newAccessToken = jwt.sign({ accountId: account.id, login: account.login }, account.tokenSecret, { expiresIn: ACCESS_TOKEN_EXPIRATION });
        const newRefreshToken = jwt.sign({ accountId: account.id, type: 'refresh' }, account.tokenSecret, { expiresIn: REFRESH_TOKEN_EXPIRATION });

        return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    }

    async verifyToken(token: string): Promise<any> {
        // Decode first without verification to find account
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.accountId) {
            throw new Error('Invalid token structure');
        }

        // Fetch account to get the secret
        const account = await this.accountRepository.findOneBy({ id: Number(decoded.accountId) });

        if (!account) {
            throw new Error('User not found');
        }

        // Verify using the account's secret
        return jwt.verify(token, account.tokenSecret);
    }
}
