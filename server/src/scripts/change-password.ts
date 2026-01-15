import 'reflect-metadata';
import 'dotenv/config';
import { Container } from 'typedi';
import { AccountService } from '../services/AccountService';

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 2) {
        console.error('Usage: ts-node src/scripts/change-password.ts <login> <password>');
        process.exit(1);
    }

    const [login, password] = args;

    if (!login || !password) {
        console.error('Login and password are required');
        process.exit(1);
    }

    try {
        const accountService = Container.get(AccountService);
        accountService.changePassword(login, password);
        console.log(`Password changed successfully for user: ${login}`);
    } catch (error: any) {
        console.error('Failed to change password:', error.message);
        process.exit(1);
    }
}

main();
