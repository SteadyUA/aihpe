import {
    Body,
    Get,
    JsonController,
    Param,
    Post,
    Req,
    Res,
} from 'routing-controllers';
import { Request, Response } from 'express';
import archiver from 'archiver';
import {
    IsArray,
    IsIn,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Service } from 'typedi';
import path from 'path';
import fs from 'fs';
import { ChatService } from '../services/ChatService';
import { SseService } from '../services/SseService';
import { SessionStore } from '../services/session/SessionStore';
import { ChatAttachment } from '../types/chat';
import { ImageService } from '../services/image/ImageService';

class ScreenshotAttachmentRequest {
    @IsString()
    @IsNotEmpty()
    @IsIn(['screenshot'])
    type!: 'screenshot';

    @IsOptional()
    @IsString()
    id?: string;

    @IsString()
    @IsNotEmpty()
    selector!: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^data:image\/[a-z0-9.+-]+;base64,/i)
    dataUrl!: string;
}

class SelectionRequest {
    @IsString()
    @IsNotEmpty()
    selector!: string;
}

class ChatRequest {
    @IsString()
    @IsNotEmpty()
    sessionId!: string;

    @IsString()
    @ValidateIf((o) => !o.attachments || o.attachments.length === 0)
    @IsNotEmpty()
    message?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ScreenshotAttachmentRequest)
    attachments?: ScreenshotAttachmentRequest[];

    @IsOptional()
    @ValidateNested()
    @Type(() => SelectionRequest)
    selection?: SelectionRequest;
}

@Service()
@JsonController()
export class ChatController {
    constructor(
        private readonly chatService: ChatService,
        private readonly sessionStore: SessionStore,
        private readonly sseService: SseService,
        private readonly imageService: ImageService,
    ) {
        console.log('ChatController initialized');
    }





    private formatHistory(history: any[]) {
        return history
            .map((entry) => ({
                role: entry.role,
                content: this.formatContent(entry.content),
                selection: entry.selection,
                version: entry.version,
                createdAt: entry.createdAt.toISOString(),
            }))
            .filter((entry) => {
                // Filter out empty messages (usually tool calls/results hidden from UI)
                // But always keep user messages to avoid confusion
                if (entry.role === 'user') return true;
                return entry.content.trim().length > 0;
            });
    }

    private formatContent(content: any): string {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .filter((part) => part.type === 'text')
                .map((part) => part.text)
                .join('\n');
        }
        return ''; // Fallback for unknown objects to empty string (hidden)
    }

    @Get('/api/sse')
    stream(@Req() request: Request, @Res() response: Response): Response {
        this.sseService.addClient(request, response);
        return response;
    }

    @Post('/api/sessions')
    createSession() {
        const session = this.sessionStore.create();
        return {
            id: session.id,
            files: session.files,
            history: [],
            updatedAt: session.updatedAt.toISOString(),
            group: session.group,
            currentVersion: session.currentVersion,
        };
    }



    @Post('/api/sessions/:sessionId/chat')
    sendMessage(
        @Param('sessionId') sessionId: string,
        @Body() body: { message: string; selection?: { selector: string } },
    ) {
        return this.chatService.handleUserMessage(
            sessionId,
            body.message,
            [],
            true, // allowVariants
            body.selection,
        );
    }

    @Get('/api/sessions/:sessionId')
    getSession(@Param('sessionId') sessionId: string) {
        const snapshot =
            this.sessionStore.snapshot(sessionId) ??
            this.sessionStore.getOrCreate(sessionId);
        return {
            id: snapshot.id,
            files: snapshot.files,
            history: this.formatHistory(snapshot.history),
            updatedAt: snapshot.updatedAt.toISOString(),
            group: snapshot.group,
            currentVersion: snapshot.currentVersion,
        };
    }



    @Get('/api/sessions/:sessionId/versions/:version/archive')
    async downloadArchive(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Res() response: Response,
    ) {
        const version = Number.parseInt(versionParam, 10);
        if (!Number.isFinite(version) || Number.isNaN(version) || version < 0) {
            return response
                .status(400)
                .json({ message: 'Некорректная версия' });
        }

        try {
            // Get code files
            const files = this.sessionStore.getFilesByVersion(sessionId, version);
            if (!files) {
                return response
                    .status(404)
                    .json({ message: 'Версия не найдена' });
            }

            const safeId =
                sessionId?.replace(/[^a-zA-Z0-9-_]/g, '_') || 'session';
            const archive = archiver('zip', { zlib: { level: 9 } });

            archive.on('error', (error) => {
                console.error('Failed to stream session archive', error);
                if (!response.headersSent) {
                    response
                        .status(500)
                        .json({ message: 'Не удалось сформировать архив' });
                } else {
                    response.end();
                }
                archive.abort();
            });

            response.setHeader('Content-Type', 'application/zip');
            response.setHeader(
                'Content-Disposition',
                `attachment; filename="session-${safeId}-v${version}.zip"`,
            );

            archive.pipe(response);

            // Add code files
            archive.append(files.html ?? '', { name: 'index.html' });
            archive.append(files.css ?? '', { name: 'styles.css' });
            archive.append(files.js ?? '', { name: 'script.js' });

            // Add images
            try {
                const images = await this.imageService.listImages(sessionId, version);
                const cwd = process.cwd();
                const sessionRoot = process.env.SESSION_ROOT?.trim() || path.resolve(cwd, 'data', 'sessions');
                const safeVersion = Number.isInteger(version) && version >= 0 ? version : 0;

                // Reconstruct path logic similar to getStaticFile
                // It would be better to have this in logic shared, but consistent within controller for now
                const versionDir = path.join(
                    sessionRoot,
                    safeId,
                    'versions',
                    String(safeVersion)
                );

                for (const img of images) {
                    const imgPath = path.join(versionDir, img.filename);
                    if (fs.existsSync(imgPath)) {
                        archive.file(imgPath, { name: img.filename });
                    }
                }
            } catch (imageError) {
                console.warn('Failed to add images to archive', imageError);
                // Continue without images rather than failing entire archive
            }

            void archive.finalize();
            return response;
        } catch (error) {
            console.error('Failed to prepare session archive', error);
            return response
                .status(500)
                .json({ message: 'Не удалось подготовить архив' });
        }
    }





    @Get('/api/sessions/:sessionId/versions/:version/static/:filename')
    getStaticFile(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Param('filename') filename: string,
        @Res() response: Response,
    ) {
        // Basic validation
        const version = Number.parseInt(versionParam, 10);
        if (!Number.isFinite(version) || Number.isNaN(version) || version < 0) {
            return response.status(400).send('Invalid version');
        }

        // Allow alphanumeric, dashes, underscores, dots only
        if (!/^[a-zA-Z0-9-_\.]+$/.test(filename)) {
            return response.status(400).send('Invalid filename');
        }

        const validFiles = ['index.html', 'styles.css', 'script.js'];
        if (validFiles.includes(filename)) {
            const files = this.sessionStore.getFilesByVersion(sessionId, version);
            if (!files) {
                return response.status(404).send('Version not found');
            }

            let content = '';
            let contentType = 'text/plain';

            switch (filename) {
                case 'index.html':
                    content = files.html;
                    contentType = 'text/html';
                    break;
                case 'styles.css':
                    content = files.css;
                    contentType = 'text/css';
                    break;
                case 'script.js':
                    content = files.js;
                    contentType = 'application/javascript';
                    break;
            }

            response.setHeader('Content-Type', contentType);
            return response.send(content);
        }

        const cwd = process.cwd();
        const sessionRoot = process.env.SESSION_ROOT?.trim() || path.resolve(cwd, 'data', 'sessions');
        const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_') || 'default';
        const safeVersion = Number.isInteger(version) && version >= 0 ? version : 0;
        const filePath = path.join(sessionRoot, safeId, 'versions', String(safeVersion), filename);

        if (fs.existsSync(filePath)) {
            const ext = path.extname(filename).toLowerCase();
            let contentType = 'application/octet-stream';
            if (ext === '.png') contentType = 'image/png';
            if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
            if (ext === '.html') contentType = 'text/html';
            if (ext === '.css') contentType = 'text/css';
            if (ext === '.js') contentType = 'application/javascript';

            response.setHeader('Content-Type', contentType);
            return fs.createReadStream(filePath);
        }

        return response.status(404).send('File not found');
    }

    @Post('/api/sessions/:sessionId/versions/:version/clone')
    cloneVersion(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Res() response: Response,
    ) {
        const version = Number.parseInt(versionParam, 10);
        if (!Number.isFinite(version) || Number.isNaN(version) || version < 0) {
            return response
                .status(400)
                .json({ message: 'Некорректная версия' });
        }

        try {
            const session = this.sessionStore.cloneAtVersion(
                sessionId,
                version,
            );
            return response.json({
                id: session.id,
                files: session.files,
                history: this.formatHistory(session.history),
                updatedAt: session.updatedAt.toISOString(),
                group: session.group,
                currentVersion: session.currentVersion,
            });
        } catch (error) {
            console.error('Failed to clone session by version', error);
            return response
                .status(400)
                .json({ message: 'Не удалось клонировать указанную версию' });
        }
    }

    @Post('/api/sessions/:sessionId/versions/:version/static/:filename')
    updateStaticFile(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Param('filename') filename: string,
        @Req() req: Request,
        @Res() response: Response
    ) {
        // Basic validation
        const version = Number.parseInt(versionParam, 10);
        if (!Number.isFinite(version) || Number.isNaN(version) || version < 0) {
            return response.status(400).send('Invalid version');
        }

        // Map filename to SessionFiles key
        let fileKey: 'html' | 'css' | 'js' | undefined;
        if (filename === 'index.html') fileKey = 'html';
        else if (filename === 'styles.css') fileKey = 'css';
        else if (filename === 'script.js') fileKey = 'js';

        if (!fileKey) {
            return response.status(400).send('Invalid filename');
        }

        const body = req.body;
        console.log(`[updateStaticFile] Saving ${filename}. Content-Type: ${req.headers['content-type']}. Body Type: ${typeof body}`);

        // Handle body: verify it's text.
        let content = '';
        if (typeof body === 'string') {
            content = body;
        } else if (typeof body === 'object' && body !== null) {
            // Fallback for JSON { content: "..." } or { html: "..." }
            if (typeof body.content === 'string') content = body.content;
            else if (typeof body[fileKey] === 'string') content = body[fileKey];
            else {
                console.error('[updateStaticFile] Missing content in object body', body);
                return response.status(400).send('Missing content');
            }
        } else {
            console.error('[updateStaticFile] Invalid body type', typeof body);
            return response.status(400).send('Invalid body');
        }

        try {
            this.sessionStore.updateSessionFile(
                sessionId,
                version,
                fileKey,
                content
            );
            return response.status(200).send('OK');
        } catch (error: any) {
            console.error('Failed to update file', error);
            return response
                .status(500)
                .json({ message: 'Не удалось обновить файл' });
        }
    }
    @Get('/api/sessions/:sessionId/versions/:version/images')
    async getImages(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Res() response: Response,
    ) {
        const version = Number.parseInt(versionParam, 10);
        if (!Number.isFinite(version) || Number.isNaN(version) || version < 0) {
            return response.status(400).json({ message: 'Invalid version' });
        }
        return this.imageService.listImages(sessionId, version);
    }
}
