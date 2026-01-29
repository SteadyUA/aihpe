import 'reflect-metadata';
import '../config/env';
import { Container } from 'typedi';
import { ChatService } from '../services/ChatService';
import { AppDataSource } from '../data-source';

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 1) {
        console.error('Usage: ts-node src/scripts/regenerate-summary.ts <sessionId>');
        process.exit(1);
    }

    const [sessionId] = args;

    if (!sessionId) {
        console.error('Session ID is required');
        process.exit(1);
    }

    try {
        console.log('Initializing database...');
        await AppDataSource.initialize();
        console.log('Database initialized.');

        const chatService = Container.get(ChatService);

        console.log(`Starting summary regeneration for session: ${sessionId}`);
        await chatService.rebuildSessionSummary(sessionId);
        console.log('Summary regeneration completed successfully.');

        process.exit(0);
    } catch (error: any) {
        console.error('Failed to regenerate summary:', error.message);
        console.error(error);
        process.exit(1);
    }
}

main();
