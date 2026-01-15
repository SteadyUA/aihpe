import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Service } from 'typedi';
import { AppDataSource } from '../data-source';
import { Account } from '../entities/Account';

// Use env secret or fallback dev secret
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-12345';
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

        // Revoke tokens on password change
        account.accessToken = undefined; // actually we might need to nullify them or just refresh token?
        // Service logic previously deleted `tokens` object.
        // Entity has nullable columns.
        account.refreshToken = undefined;
        account.accessToken = undefined; // Optional cleanup

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
        const accessToken = jwt.sign({ accountId: account.id, login: account.login }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRATION });
        const refreshToken = jwt.sign({ accountId: account.id, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRATION });

        // Save tokens to account
        account.accessToken = accessToken;
        account.refreshToken = refreshToken;

        await this.accountRepository.save(account);

        return { accessToken, refreshToken };
    }

    async refresh(incomingRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
        // Validate token structure first
        let payload: any;
        try {
            payload = jwt.verify(incomingRefreshToken, JWT_SECRET);
        } catch (e) {
            throw new Error('Invalid refresh token');
        }

        if (payload.type !== 'refresh' || !payload.accountId) {
            throw new Error('Invalid token type');
        }

        const account = await this.accountRepository.findOneBy({ id: Number(payload.accountId) });
        if (!account) {
            throw new Error('Account not found');
        }

        // Verify stored token matches (basic rotation/reuse check)
        if (account.refreshToken !== incomingRefreshToken) {
            // In a strict system, this might indicate token theft and we should revoke all.
            // For now, just deny.
            throw new Error('Invalid or expired refresh token');
        }

        // Rotate tokens
        const newAccessToken = jwt.sign({ accountId: account.id, login: account.login }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRATION });
        const newRefreshToken = jwt.sign({ accountId: account.id, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRATION });

        account.accessToken = newAccessToken;
        account.refreshToken = newRefreshToken;

        await this.accountRepository.save(account);

        return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    }
}
