import {
    Body,
    Delete,
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







    @Get('/api/sse')
    stream(@Req() request: Request, @Res() response: Response): Response {
        this.sseService.addClient(request, response);
        return response;
    }

    @Post('/api/sessions')
    createSession(@Res() response: Response) {
        const { id, group } = this.sessionStore.prepareCreate();

        // Start creation in background
        setImmediate(async () => {
            try {
                await this.sessionStore.executeCreate(id, group);
                this.sseService.emitSessionCreated({
                    sourceSessionId: 'system',
                    newSessionId: id,
                    group,
                });
            } catch (error) {
                console.error('Background session creation failed', error);
                this.sseService.emitChatStatus({
                    sessionId: id,
                    status: 'error',
                    message: 'Failed to create session in background',
                    details: error,
                });
            }
        });

        return response.status(201).json({
            id,
            group,
            currentVersion: 0,
            history: [],
            files: {}, // Empty/Minimal files for client compliance if needed
            updatedAt: new Date().toISOString(),
            imageGenerationAllowed: true, // Default
        });
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
            // files and history removed. Fetch files via static routes and history via history route.
            updatedAt: snapshot.updatedAt.toISOString(),
            group: snapshot.group,
            currentVersion: snapshot.currentVersion,
            currentTurn: snapshot.lastTurn ?? 0,
            imageGenerationAllowed: snapshot.imageGenerationAllowed ?? true,
        };
    }

    @Get('/api/sessions/:sessionId/history')
    getHistory(
        @Param('sessionId') sessionId: string,
        @Res() response: Response,
    ) {
        const history = this.sessionStore.getAllHistory(sessionId);
        if (!history) {
            return response.status(404).json({ message: 'History not found' });
        }
        return history;
    }

    @Post('/api/sessions/:sessionId/settings')
    updateSettings(
        @Param('sessionId') sessionId: string,
        @Body() body: { imageGenerationAllowed: boolean },
    ) {
        const updated = this.sessionStore.updateImageGenerationAllowed(
            sessionId,
            body.imageGenerationAllowed,
        );
        return {
            id: updated.id,
            files: updated.files,
            history: updated.history,
            updatedAt: updated.updatedAt.toISOString(),
            group: updated.group,
            currentVersion: updated.currentVersion,
            imageGenerationAllowed: updated.imageGenerationAllowed,
        };
    }

    @Delete('/api/sessions/:sessionId')
    deleteSession(@Param('sessionId') sessionId: string, @Res() response: Response) {
        try {
            this.sessionStore.deleteSession(sessionId);
            return response.status(200).json({ message: 'Session deleted' });
        } catch (error) {
            console.error('Failed to delete session', error);
            return response.status(500).json({ message: 'Failed to delete session' });
        }
    }




    @Get('/api/sessions/:sessionId/turns/:turn/archive')
    async downloadArchive(
        @Param('sessionId') sessionId: string,
        @Param('turn') turnParam: string,
        @Res() response: Response,
    ) {
        const turn = Number.parseInt(turnParam, 10);
        if (!Number.isFinite(turn) || Number.isNaN(turn) || turn < 0) {
            return response
                .status(400)
                .json({ message: 'Некорректный номер хода' });
        }

        try {
            // Resolve version from turn
            const version = this.sessionStore.getVersionForTurn(sessionId, turn);
            if (version === undefined) {
                return response
                    .status(404)
                    .json({ message: 'Ход не найден или не содержит файлов' });
            }

            // Get code files
            const files = this.sessionStore.getFilesByVersion(sessionId, version);
            if (!files) {
                return response
                    .status(404)
                    .json({ message: 'Файлы для указанного хода не найдены' });
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
                `attachment; filename="session-${safeId}-turn${turn}.zip"`,
            );

            archive.pipe(response);

            // Add code files
            archive.append(files.html ?? '', { name: 'index.html' });
            archive.append(files.css ?? '', { name: 'styles.css' });
            archive.append(files.js ?? '', { name: 'script.js' });

            // Add images
            try {
                // Images also need to be filtered? 
                // Images are versioned. We used `version`.
                const images = await this.imageService.listImages(sessionId, version);
                const cwd = process.cwd();
                const sessionRoot = process.env.SESSION_ROOT?.trim() || path.resolve(cwd, 'data', 'sessions');
                // We still need to read from filesystem based on VERSION dir
                const safeVersion = Number.isInteger(version) && version >= 0 ? version : 0;

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

    @Get('/api/sessions/:sessionId/turns/:turn/static/:filename')
    getStaticFile(
        @Param('sessionId') sessionId: string,
        @Param('turn') turnParam: string,
        @Param('filename') filename: string,
        @Res() response: Response,
    ) {
        // Basic validation
        const turn = Number.parseInt(turnParam, 10);
        if (!Number.isFinite(turn) || Number.isNaN(turn) || turn < 0) {
            return response.status(400).send('Invalid turn');
        }

        // Allow alphanumeric, dashes, underscores, dots only
        if (!/^[a-zA-Z0-9-_\.]+$/.test(filename)) {
            return response.status(400).send('Invalid filename');
        }

        const version = this.sessionStore.getVersionForTurn(sessionId, turn);
        if (version === undefined) {
            return response.status(404).send('Turn not found');
        }

        const validFiles = ['index.html', 'styles.css', 'script.js'];
        if (validFiles.includes(filename)) {
            const files = this.sessionStore.getFilesByVersion(sessionId, version);
            if (!files) {
                return response.status(404).send('Files not found');
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


    @Post('/api/sessions/:sessionId/undo')
    undoLastTurn(
        @Param('sessionId') sessionId: string,
        @Res() response: Response,
    ) {
        try {
            const result = this.sessionStore.undoLastTurn(sessionId);
            return result;
        } catch (error) {
            console.error('Failed to undo last turn', error);
            return response
                .status(500)
                .json({ message: 'Failed to undo last turn' });
        }
    }

    @Post('/api/sessions/:sessionId/turns/:turn/clone')
    cloneTurn(
        @Param('sessionId') sessionId: string,
        @Param('turn') turnParam: string,
        @Res() response: Response,
    ) {
        const turn = Number.parseInt(turnParam, 10);
        if (!Number.isFinite(turn) || Number.isNaN(turn) || turn < 0) {
            return response
                .status(400)
                .json({ message: 'Некорректный номер хода' });
        }

        try {
            // Prepare ID and Group
            const { id } = this.sessionStore.prepareClone(sessionId);
            const { group } = this.sessionStore.getOrCreate(sessionId);

            // Start cloning in background
            setImmediate(async () => {
                try {
                    await this.sessionStore.executeCloneAtTurn(id, sessionId, turn);
                    this.sseService.emitSessionCreated({
                        sourceSessionId: sessionId,
                        newSessionId: id,
                        group,
                    });
                } catch (error) {
                    console.error('Background session cloning failed', error);
                    this.sseService.emitChatStatus({
                        sessionId: id,
                        status: 'error',
                        message: 'Failed to clone session in background',
                        details: error,
                    });
                }
            });

            return response.status(201).json({
                id,
                group,
                currentTurn: turn,
                updatedAt: new Date().toISOString(),
            });
        } catch (error) {
            console.error('Failed to clone session by turn', error);
            return response
                .status(400)
                .json({ message: 'Не удалось инициировать клонирование хода' });
        }
    }

    @Post('/api/sessions/:sessionId/turns/:turn/static/:filename')
    updateStaticFile(
        @Param('sessionId') sessionId: string,
        @Param('turn') turnParam: string,
        @Param('filename') filename: string,
        @Req() req: Request,
        @Res() response: Response
    ) {
        // Basic validation
        const turn = Number.parseInt(turnParam, 10);
        if (!Number.isFinite(turn) || Number.isNaN(turn) || turn < 0) {
            return response.status(400).send('Invalid turn');
        }

        const version = this.sessionStore.getVersionForTurn(sessionId, turn);
        if (version === undefined) {
            return response.status(404).send('Turn not found');
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
    @Get('/api/sessions/:sessionId/turns/:turn/images')
    async getImages(
        @Param('sessionId') sessionId: string,
        @Param('turn') turnParam: string,
        @Res() response: Response,
    ) {
        const turn = Number.parseInt(turnParam, 10);
        if (!Number.isFinite(turn) || Number.isNaN(turn) || turn < 0) {
            return response.status(400).json({ message: 'Invalid turn' });
        }

        const version = this.sessionStore.getVersionForTurn(sessionId, turn);
        if (version === undefined) {
            // Fallback to empty list or 404? 
            // If turn exists but has no version, it's effectively version 0 for images usually
            return response.json([]);
        }

        return this.imageService.listImages(sessionId, version);
    }

}
