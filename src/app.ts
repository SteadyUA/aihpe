import 'reflect-metadata';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { useContainer, useExpressServer } from 'routing-controllers';
import { Container } from 'typedi';
import { ChatController } from './controllers/ChatController';
import { GptClientToken, OpenAIGptClient } from './services/llm/GptClient';

useContainer(Container);

export function createApp(): express.Express {
  const app = express();

  Container.set(GptClientToken, Container.get(OpenAIGptClient));

  app.use(cors());

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
