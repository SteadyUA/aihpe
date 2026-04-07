import './config/env';
import { createApp } from './app';
import { Container } from 'typedi';
import { AppDataSource } from './data-source';
import { bootstrapBus, EventBus, AppStartedEvent, AppStoppingEvent } from './utils/bus';

const port = Number(process.env.PORT ?? 5000);
const host = process.env.HOST ?? '0.0.0.0';

const app = createApp();

AppDataSource.initialize()
    .then(() => {
        console.log('📦 Data Source has been initialized!');
        app.listen(port, host, () => {
            console.log(`🚀 Server listening on http://${host}:${port}`);

            bootstrapBus();
            const bus = Container.get(EventBus);
            bus.publish(AppStartedEvent());
        });
    })
    .catch((err) => {
        console.error('Error during Data Source initialization:', err);
    });

async function shutdown(signal: string) {
    console.log(`Received ${signal}. Starting graceful shutdown...`);

    try {
        const bus = Container.get(EventBus);
        await bus.publishAndWait(AppStoppingEvent());
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
