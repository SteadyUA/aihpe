import 'reflect-metadata';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { useContainer, useExpressServer } from 'routing-controllers';
import { Container } from 'typedi';
import { ChatController } from './controllers/ChatController';

useContainer(Container);

export function createApp(): express.Express {
    const app = express();

    app.set('etag', false);
    app.use(cors());
    // app.use(express.json());
    app.use(express.text());

    // Disable caching for API routes
    app.use('/api', (req, res, next) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
        next();
    });

    const publicDir = path.resolve(__dirname, '..', 'public');
    app.use(express.static(publicDir));

    useExpressServer(app, {
        controllers: [ChatController],
        validation: {
            whitelist: true,
            forbidNonWhitelisted: true,
            validationError: { target: false },
        },
        classTransformer: true,
    });

    return app;
}
