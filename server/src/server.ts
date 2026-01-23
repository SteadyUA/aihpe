import 'dotenv/config';
import { createApp } from './app';
import { Container } from 'typedi';
import { SseService } from './services/SseService';
import { ChatService } from './services/ChatService';
import { AppDataSource } from './data-source';

const port = Number(process.env.PORT ?? 5000);
const host = process.env.HOST ?? '0.0.0.0';

const app = createApp();

AppDataSource.initialize()
    .then(() => {
        console.log('📦 Data Source has been initialized!');
        app.listen(port, host, () => {
            console.log(`🚀 Server listening on http://${host}:${port}`);
        });
    })
    .catch((err) => {
        console.error('Error during Data Source initialization:', err);
    });

async function shutdown(signal: string) {
    console.log(`Received ${signal}. Starting graceful shutdown...`);

    try {
        const sseService = Container.get(SseService);
        sseService.emitServerStop();
        console.log('Broadcasted server-stop event');

        const chatService = Container.get(ChatService);
        await chatService.stopAll();
    } catch (error) {
        console.error('Failed during graceful shutdown tasks', error);
    }

    // Give clients a moment to receive the event and close
    setTimeout(() => {
        console.log('Exiting...');
        process.exit(0);
    }, 500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
