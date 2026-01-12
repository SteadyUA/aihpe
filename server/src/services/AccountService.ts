import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Service } from 'typedi';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

// Use env secret or fallback dev secret
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-12345';
const ACCESS_TOKEN_EXPIRATION = '1h'; // 1 hour
const REFRESH_TOKEN_EXPIRATION = '7d'; // 7 days

interface AccountTokens {
    refreshToken: string;
    accessToken: string; // Not strictly needed to store access token if stateless, but maybe useful for debugging or revocation
}

interface Account {
    id: number;
    login: string;
    passwordHash: string;
    tokens?: AccountTokens; // Current active tokens
}

interface AccountsData {
    autoincrement: number;
    accounts: Record<string, Account>;
}

@Service()
export class AccountService {
    private data: AccountsData = {
        autoincrement: 0,
        accounts: {},
    };

    constructor() {
        this.loadAccounts();
    }

    private loadAccounts() {
        if (!fs.existsSync(ACCOUNTS_FILE)) {
            return;
        }
        try {
            const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
            this.data = JSON.parse(raw);
        } catch (error) {
            console.error('Failed to load accounts:', error);
        }
    }

    private saveAccounts() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    }

    private hashPassword(password: string): string {
        const salt = process.env.SALT;
        if (!salt) {
            throw new Error('SALT environment variable is not set');
        }
        return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    }

    createAccount(login: string, password: string): number {
        const passwordHash = this.hashPassword(password);

        // Check if login already exists
        for (const acc of Object.values(this.data.accounts)) {
            if (acc.login === login) {
                throw new Error(`Account with login "${login}" already exists`);
            }
        }

        this.data.autoincrement++;
        const accountId = this.data.autoincrement;

        this.data.accounts[accountId.toString()] = {
            id: accountId,
            login,
            passwordHash,
        };

        this.saveAccounts();
        return accountId;
    }

    changePassword(login: string, oldPass: string, newPass: string): void {
        const account = Object.values(this.data.accounts).find(acc => acc.login === login);
        if (!account) {
            throw new Error(`Account with login "${login}" not found`);
        }

        const oldHash = this.hashPassword(oldPass);
        if (oldHash !== account.passwordHash) {
            throw new Error('Invalid old password');
        }

        const newHash = this.hashPassword(newPass);
        account.passwordHash = newHash;

        // Revoke tokens on password change
        delete account.tokens;

        this.saveAccounts();
    }

    login(login: string, password: string): { accessToken: string; refreshToken: string } {
        const account = Object.values(this.data.accounts).find(acc => acc.login === login);
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
        this.data.accounts[account.id.toString()].tokens = {
            accessToken,
            refreshToken
        };
        this.saveAccounts();

        return { accessToken, refreshToken };
    }

    refresh(incomingRefreshToken: string): { accessToken: string; refreshToken: string } {
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

        const account = this.data.accounts[payload.accountId.toString()];
        if (!account) {
            throw new Error('Account not found');
        }

        // Verify stored token matches (basic rotation/reuse check)
        if (account.tokens?.refreshToken !== incomingRefreshToken) {
            // In a strict system, this might indicate token theft and we should revoke all.
            // For now, just deny.
            throw new Error('Invalid or expired refresh token');
        }

        // Rotate tokens
        const newAccessToken = jwt.sign({ accountId: account.id, login: account.login }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRATION });
        const newRefreshToken = jwt.sign({ accountId: account.id, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRATION });

        this.data.accounts[account.id.toString()].tokens = {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken
        };
        this.saveAccounts();

        return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    }
}
