import 'reflect-metadata';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { useContainer, useExpressServer } from 'routing-controllers';
import { Container } from 'typedi';
import { ChatController } from './controllers/ChatController';
import { AccountController } from './controllers/AccountController';

useContainer(Container);

export function createApp(): express.Express {
    const app = express();

    const basePath = process.env.APP_BASE_PATH || '';

    app.set('etag', false);
    app.use(cors());
    // app.use(express.json());
    app.use(express.text());

    // Disable caching for API routes
    app.use(`${basePath}/api`, (req, res, next) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
        next();
    });

    const localPublic = path.join(__dirname, 'public');
    const siblingPublic = path.join(__dirname, '..', 'public');
    const publicDir = require('fs').existsSync(localPublic) ? localPublic : siblingPublic;

    // Mount static files at base path
    app.use(basePath || '/', express.static(publicDir));

    useExpressServer(app, {
        routePrefix: basePath,
        controllers: [ChatController, AccountController],
        validation: {
            whitelist: true,
            forbidNonWhitelisted: true,
            validationError: { target: false },
        },
        classTransformer: true,
    });

    // SPA Fallback: Serve index.html for any unknown non-API routes
    if (process.env.NODE_ENV !== 'development') {
        app.get(/(.*)/, (req, res) => {
            if (req.path.startsWith(`${basePath}/api`)) {
                // Let API 404s follow standard behavior or return JSON
                res.status(404).json({ message: 'Not Found' });
                return;
            }
            res.sendFile(path.join(publicDir, 'index.html'));
        });
    }

    return app;
}
