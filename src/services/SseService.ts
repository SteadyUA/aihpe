import { Request, Response } from 'express';
import { Service } from 'typedi';

export type ChatStatus = 'started' | 'completed' | 'error' | 'skipped';

export interface ChatStatusPayload {
  sessionId: string;
  status: ChatStatus;
  message?: string;
  details?: unknown;
  timestamp?: string;
}

interface SseClient {
  id: number;
  response: Response;
  heartbeat: NodeJS.Timeout;
}

export interface SessionCreatedPayload {
  sourceSessionId: string;
  newSessionId: string;
  group?: number;
  timestamp?: string;
}

@Service()
export class SseService {
  private readonly clients = new Map<number, SseClient>();

  private nextClientId = 1;

  addClient(request: Request, response: Response): void {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();
    response.write('retry: 5000\n\n');

    const client: SseClient = {
      id: this.nextClientId++,
      response,
      heartbeat: setInterval(() => {
        this.pushRaw(client.id, ': keep-alive\n\n');
      }, 25000),
    };

    this.clients.set(client.id, client);

    const closeHandler = () => {
      this.removeClient(client.id);
      request.removeListener('close', closeHandler);
    };

    request.on('close', closeHandler);
  }

  emitChatStatus(payload: ChatStatusPayload): void {
    const enriched: ChatStatusPayload = {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };

    this.broadcast('chat-status', enriched);
  }

  emitSessionCreated(payload: SessionCreatedPayload): void {
    const enriched: SessionCreatedPayload = {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };

    this.broadcast('session-created', enriched);
  }

  private broadcast(event: string, data: unknown): void {
    const serialized = JSON.stringify(data);
    for (const client of this.clients.values()) {
      this.pushRaw(client.id, `event: ${event}\n`);
      this.pushRaw(client.id, `data: ${serialized}\n\n`);
    }
  }

  private pushRaw(clientId: number, chunk: string): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    try {
      client.response.write(chunk);
    } catch (error) {
      console.error('Failed to push SSE chunk, removing client', error);
      this.removeClient(clientId);
    }
  }

  private removeClient(clientId: number): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    clearInterval(client.heartbeat);
    try {
      client.response.end();
    } catch (error) {
      console.error('Failed to close SSE response', error);
    }
    this.clients.delete(clientId);
  }
}
