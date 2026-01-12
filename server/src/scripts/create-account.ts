import 'reflect-metadata';
import 'dotenv/config';
import { Container } from 'typedi';
import { AccountService } from '../services/AccountService';

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 2) {
        console.error('Usage: ts-node src/scripts/create-account.ts <login> <password>');
        process.exit(1);
    }

    const [login, password] = args;

    if (!login || !password) {
        console.error('Login and password are required');
        process.exit(1);
    }

    try {
        // We use Container to get the instance, although it has no dependencies, 
        // this maintains consistency if dependencies are added later.
        const accountService = Container.get(AccountService);
        const accountId = accountService.createAccount(login, password);
        console.log(`Account created successfully. Account ID: ${accountId}`);
    } catch (error: any) {
        console.error('Failed to create account:', error.message);
        process.exit(1);
    }
}

main();
