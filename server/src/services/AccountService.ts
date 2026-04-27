import crypto from 'node:crypto';
import { Service } from 'typedi';
import { AppDataSource } from '../data-source';
import { Account } from '../entities/Account';
import { EventBus } from '../utils/bus';

export const AccountDeletedEvent = EventBus.createEvent<{ accountId: number }>('ACCOUNT_DELETED');

@Service()
export class AccountService {
    constructor(private eventBus: EventBus) {}
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

    async validateCredentials(login: string, password: string): Promise<Account> {
        const account = await this.accountRepository.findOneBy({ login });
        if (!account) {
            throw new Error('Invalid login or password');
        }

        const inputHash = this.hashPassword(password);
        if (inputHash !== account.passwordHash) {
            throw new Error('Invalid login or password');
        }

        return account;
    }

    async findById(id: number): Promise<Account | null> {
        return this.accountRepository.findOneBy({ id });
    }

    async deleteAccount(id: number): Promise<void> {
        await this.accountRepository.delete(id);
        this.eventBus.publish(AccountDeletedEvent({ accountId: id }));
    }
}
