import { Request, Response } from 'express';
import { Service } from 'typedi';

export type ChatStatus =
    | 'started'
    | 'generating'
    | 'completed'
    | 'error'
    | 'skipped';

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
    projectId?: string;
    timestamp?: string;
}

@Service()
export class SseService {
    private readonly clients = new Map<number, SseClient>();
    private static instanceCount = 0;
    private readonly instanceId: number;

    private nextClientId = 1;

    constructor() {
        SseService.instanceCount++;
        this.instanceId = SseService.instanceCount;
        console.log(`[SseService] Created instance #${this.instanceId}. Total instances: ${SseService.instanceCount}`);
    }

    addClient(request: Request, response: Response): void {
        response.setHeader('Content-Type', 'text/event-stream');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('Connection', 'keep-alive');
        response.flushHeaders?.();
        response.write('retry: 5000\n\n');

        console.log(`[SseService #${this.instanceId}] Client connecting...`);

        const client: SseClient = {
            id: this.nextClientId++,
            response,
            heartbeat: setInterval(() => {
                this.pushRaw(client.id, ': keep-alive\n\n');
            }, 25000),
        };

        this.clients.set(client.id, client);
        console.log(`[SseService #${this.instanceId}] Client #${client.id} registered. Active clients: ${this.clients.size}`);

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
        console.log(`[SseService #${this.instanceId}] Broadcasting '${event}' to ${this.clients.size} clients.`);
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
        console.log(`[SseService #${this.instanceId}] Client #${clientId} removed. Active clients: ${this.clients.size}`);
    }
}
