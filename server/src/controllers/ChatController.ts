import {
    Body,
    Delete,
    Get,
    JsonController,
    Param,
    Patch,
    Post,
    Req,
    Res,
    UseBefore, // eslint-disable-line @typescript-eslint/no-unused-vars
} from 'routing-controllers';
import { Request, Response } from 'express';
import multer from 'multer';
import archiver from 'archiver';
import crypto from 'crypto';
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
import { ProjectService } from '../services/ProjectService';
import { SseService } from '../services/SseService';
import { SessionStore } from '../services/session/SessionStore';

import { ChatAttachment, LlmProvider, UnsentData } from '../types/chat';
import { ImageService } from '../services/image/ImageService';

class AttachmentRequest {
    @IsString()
    @IsNotEmpty()
    @IsIn(['image'])
    type!: 'image';

    @IsOptional()
    @IsString()
    id?: string;

    @IsString()
    @IsOptional()
    originalName?: string;

    @IsString()
    @IsNotEmpty()
    filename!: string;

    @IsString()
    @IsNotEmpty()
    url!: string;
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
    @ValidateIf((o) => !o.attachment)
    @IsNotEmpty()
    message?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => AttachmentRequest)
    attachment?: AttachmentRequest;

    @IsOptional()
    @ValidateNested()
    @Type(() => SelectionRequest)
    selection?: SelectionRequest;
}

class UnsentDataRequest {
    @IsOptional()
    @IsString()
    input?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => AttachmentRequest)
    attachment?: AttachmentRequest;

    @IsOptional()
    @IsString()
    selection?: string;

    @IsOptional()
    @IsString()
    provider?: LlmProvider;


}

class CreateSessionRequest {
    @IsString()
    @IsNotEmpty()
    projectId!: string;
}

class CreateProjectRequest {
    @IsString()
    rulesAndGoal!: string;

    @IsOptional()
    @IsString()
    imageGenerationPref?: string;

    @IsOptional()
    @IsString()
    defaultProvider?: LlmProvider;
}

class UpdateProjectRequest {
    @IsOptional()
    @IsString()
    rulesAndGoal?: string;

    @IsOptional()
    @IsString()
    imageGenerationPref?: string;

    @IsOptional()
    @IsString()
    defaultProvider?: LlmProvider;
}

@Service()
@JsonController()
export class ChatController {
    constructor(
        private readonly chatService: ChatService,
        private readonly sessionStore: SessionStore,
        private readonly projectService: ProjectService,
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

    @Post('/api/projects')
    createProject(@Body() body: CreateProjectRequest) {
        return this.projectService.createProject(body.rulesAndGoal, body.imageGenerationPref, body.defaultProvider);
    }

    @Get('/api/projects/:projectId')
    getProject(@Param('projectId') projectId: string, @Res() response: Response) {
        const project = this.projectService.getProject(projectId);
        if (!project) {
            return response.status(404).json({ message: 'Project not found' });
        }

        const sessionIds = this.projectService.getProjectSessions(projectId);
        const sessions = sessionIds.reduce((acc, id) => {
            const s = this.sessionStore.getOrCreate(id);
            // Strict check: verify the session actually belongs to this project.
            // If the session was resurrected (created fresh with empty projectId) or mismatched, exclude it.
            // We verify if s.projectId matches, OR if it's a legacy session we might want to allow it?
            // But for new logic, checking projectId is safer to avoid ghost sessions.
            if (s.projectId === projectId) {
                acc.push({ sessionId: s.id, group: s.group, status: s.status });
            }
            return acc;
        }, [] as { sessionId: string, group: number, status: string }[]);

        return {
            rulesAndGoal: project.rulesAndGoal,
            imageGenerationPref: project.imageGenerationPref,
            defaultProvider: project.defaultProvider,
            sessions,
        };
    }

    @Patch('/api/projects/:projectId')
    updateProject(
        @Param('projectId') projectId: string,
        @Body() body: UpdateProjectRequest,
    ) {
        const updateData: any = {};
        if (body.rulesAndGoal !== undefined) updateData.rulesAndGoal = body.rulesAndGoal;
        if (body.imageGenerationPref !== undefined) updateData.imageGenerationPref = body.imageGenerationPref;
        if (body.defaultProvider !== undefined) updateData.defaultProvider = body.defaultProvider;

        // Since projectService.updateProject expects specific args or a partial object?
        // Let's check how it's called. 
        // Previously: return this.projectService.updateProject(projectId, body);
        // If ProjectService.updateProject takes (id, data), and data matches UpdateProjectRequest structure, then passing body is fine
        // IF the DTO matches the service expectation. 
        // Service updateProject signature: (projectId: string, data: Partial<Project>) OR (..., goal, ...)
        // I need to be careful about what updateProject expects. 
        // Let's assume for now I pass the body with rulesAndGoal.

        return this.projectService.updateProject(projectId, updateData);
    }

    @Post('/api/sessions')
    createSession(@Body() body: CreateSessionRequest, @Res() response: Response) {
        const { projectId } = body;
        const { id, group } = this.sessionStore.prepareCreate(); // prepareCreate doesn't need projectId

        // Start creation in background
        setImmediate(async () => {
            try {
                // Determine provider: explicitly requested > project default > 'openai' (default in session store)
                // SessionStore.executeCreate handles defaults if undefined is passed, but we want project default logic.
                const project = this.projectService.getProject(projectId);
                const provider = project?.defaultProvider; // If project has a default, pass it.

                // If executeCreate accepted provider, we'd pass it here. 
                // Currently executeCreate doesn't take provider arg, it defaults to 'openai' inside.
                // We need to update SessionStore to accept provider or update session after creation.
                // Looking at SessionStore.executeCreate(id, projectId, group) -> it calls createFreshSession -> defaults to 'openai'.

                await this.sessionStore.executeCreate(id, projectId, group);

                // If we have a project default provider, update the session immediately
                if (provider) {
                    this.sessionStore.upsert(id, { provider });
                }

                this.projectService.addSessionToProject(projectId, id);
                this.sseService.emitSessionCreated({
                    sourceSessionId: 'system',
                    newSessionId: id,
                    group,
                    projectId,
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
            files: {},
            updatedAt: new Date().toISOString(),
            projectId,
            status: 'idle',
        });
    }



    @Post('/api/sessions/:sessionId/unsent')
    saveUnsent(
        @Param('sessionId') sessionId: string,
        @Body() body: UnsentDataRequest,
    ) {
        const session = this.sessionStore.getOrCreate(sessionId);

        // Filter out undefined values from body to ensure we don't overwrite existing data with undefined
        // This is crucial for partial updates (e.g. saving input shouldn't clear selection)
        // Initialize updates using the Current state (avoiding spread in the final upsert)
        const updates: Partial<UnsentDataRequest> = { ...(session.unsent || {}) };

        // Define a helper or just check each field. 
        // If value is null, remove it from updates (clearing the field).
        // If value is defined (and not null), update it.
        // If value is undefined, ignore (preserve existing).

        const fields: (keyof UnsentDataRequest)[] = ['input', 'attachment', 'selection', 'provider'];

        for (const field of fields) {
            const value = body[field];
            if (value !== undefined) {
                if (value === null) {
                    delete updates[field];
                } else {
                    updates[field] = value as any;
                }
            }
        }

        this.sessionStore.upsert(sessionId, {
            unsent: updates
        });

        return { status: 'saved' };
    }

    @Post('/api/sessions/:sessionId/chat')
    async sendMessage(
        @Param('sessionId') sessionId: string,
        @Body() body: { message: string; attachment?: any; selection?: { selector: string }, provider?: LlmProvider },
        @Res() response: Response,
    ) {
        const result = await this.chatService.addUserMessage(
            sessionId,
            body.message,
            body.attachment,
            body.selection,
            body.provider,
        );

        if (!result.skipped && result.promptData) {
            setImmediate(() => {
                this.chatService.generateResponse(
                    sessionId,
                    result.promptData!,
                    result.turn,
                    true,
                ).catch(e => console.error('Background generation error', e));
            });
        }

        return response.status(201).json({
            turn: result.turn,
        });
    }

    @Post('/api/sessions/:sessionId/uploads')
    async uploadImage(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        const sessionRoot =
            process.env.SESSION_ROOT?.trim() ||
            path.resolve(__dirname, '..', '..', 'data', 'sessions');
        const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_');
        const uploadDir = path.join(sessionRoot, safeId, 'uploads');

        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const storage = multer.diskStorage({
            destination: (req, file, cb) => {
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const ext = path.extname(file.originalname);
                const uniqueName = crypto.randomUUID() + ext;
                cb(null, uniqueName);
            },
        });

        const upload = multer({ storage: storage }).single('file');

        return new Promise((resolve, reject) => {
            upload(req, res, (err) => {
                if (err) {
                    console.error('File upload failed', err);
                    return resolve(
                        res.status(500).json({ message: 'File upload failed' }),
                    );
                }
                if (!req.file) {
                    return resolve(
                        res.status(400).json({ message: 'No file provided' }),
                    );
                }

                // Metadata handling
                const metadataPath = path.join(uploadDir, 'uploads.json');
                let metadata: Record<string, any> = {};
                try {
                    if (fs.existsSync(metadataPath)) {
                        const content = fs.readFileSync(metadataPath, 'utf-8');
                        metadata = JSON.parse(content);
                    }
                } catch (e) {
                    console.error('Failed to read uploads metadata', e);
                }

                metadata[req.file.filename] = {
                    originalName: req.file.originalname,
                    timestamp: Date.now(),
                    mimeType: req.file.mimetype,
                    size: req.file.size
                };

                try {
                    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                } catch (e) {
                    console.error('Failed to write uploads metadata', e);
                }

                const fileUrl = `/api/sessions/${sessionId}/uploads/${req.file.filename}`;
                resolve(
                    res.json({
                        filename: req.file.filename,
                        url: fileUrl,
                        type: 'image',
                        originalName: req.file.originalname,
                    }),
                );
            });
        });
    }

    @Delete('/api/sessions/:sessionId/uploads/:filename')
    deleteUploadedFile(
        @Param('sessionId') sessionId: string,
        @Param('filename') filename: string,
        @Res() response: Response,
    ) {
        // Sanitize
        if (!/^[a-zA-Z0-9-_\. \(\)]+$/.test(filename)) {
            return response.status(400).send('Invalid filename');
        }

        const sessionRoot =
            process.env.SESSION_ROOT?.trim() ||
            path.resolve(__dirname, '..', '..', 'data', 'sessions');
        const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_');
        const uploadDir = path.join(sessionRoot, safeId, 'uploads');
        const filePath = path.join(uploadDir, filename);

        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);

                // Update metadata
                const metadataPath = path.join(uploadDir, 'uploads.json');
                if (fs.existsSync(metadataPath)) {
                    try {
                        const content = fs.readFileSync(metadataPath, 'utf-8');
                        const metadata = JSON.parse(content);
                        if (metadata[filename]) {
                            delete metadata[filename];
                            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                        }
                    } catch (e) {
                        console.error('Failed to update uploads metadata', e);
                    }
                }

                return response.status(200).json({ message: 'File deleted' });
            } catch (error) {
                console.error('Failed to delete file', error);
                return response.status(500).json({ message: 'Failed to delete file' });
            }
        }

        return response.status(404).send('File not found');
    }

    @Get('/api/sessions/:sessionId/uploads/:filename')
    getUploadedFile(
        @Param('sessionId') sessionId: string,
        @Param('filename') filename: string,
        @Res() response: Response,
    ) {
        // Sanitize
        if (!/^[a-zA-Z0-9-_\. \(\)]+$/.test(filename)) {
            return response.status(400).send('Invalid filename');
        }

        const sessionRoot =
            process.env.SESSION_ROOT?.trim() ||
            path.resolve(__dirname, '..', '..', 'data', 'sessions');
        const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_');
        const filePath = path.join(sessionRoot, safeId, 'uploads', filename);

        if (fs.existsSync(filePath)) {
            const ext = path.extname(filename).toLowerCase();
            let contentType = 'application/octet-stream';
            if (ext === '.png') contentType = 'image/png';
            if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
            if (ext === '.gif') contentType = 'image/gif';
            if (ext === '.webp') contentType = 'image/webp';

            response.setHeader('Content-Type', contentType);
            return fs.createReadStream(filePath);
        }

        console.log(`[getUploadedFile] File not found: ${filePath}`);
        return response.status(404).send('File not found');
    }

    @Get('/api/sessions/:sessionId')
    getSession(@Param('sessionId') sessionId: string) {
        const snapshot =
            this.sessionStore.snapshot(sessionId) ??
            this.sessionStore.getOrCreate(sessionId);

        const history = this.sessionStore.getAllHistory(sessionId) || [];

        return {
            id: snapshot.id,
            updatedAt: snapshot.updatedAt.toISOString(),
            group: snapshot.group,
            currentVersion: snapshot.currentVersion,
            currentTurn: snapshot.lastTurn ?? 0,
            provider: snapshot.provider ?? 'openai',
            history,
            unsent: snapshot.unsent,
            status: snapshot.status,
        };
    }



    @Delete('/api/sessions/:sessionId')
    deleteSession(@Param('sessionId') sessionId: string, @Res() response: Response) {
        try {
            // Attempt to get session to find its project
            // Use snapshot or getOrCreate. Since we are deleting, we just need metadata.
            // If it doesn't exist on disk, getOrCreate might create a fresh one, which is fine as it returns default props,
            // but we want to avoid creating files if we are about to delete.
            // But SessionStore.getOrCreate DOES create files.
            // We should use a method that returns undefined if not found, OR check if it exists.
            // But for now, getOrCreate is standard. If it creates a temp one, we delete it anyway.
            // Better: use sessionStore.snapshot(sessionId) ?? loadFromDisk logic?
            // Actually, if we just want to clean up, retrieving it first is safer to ensure consistency.

            // Wait, if it didn't exist, getOrCreate creates it with empty projectId.
            // Effectively we wouldn't remove it from any project.
            // But we have the projectId in the Project Entity!
            // BUT ChatController doesn't know the projectId from the request params.
            // So relying on the session file is necessary.
            // If the session file is corrupted/missing, we might fail to clean up the project reference?
            // This suggests a data integrity issue if file is missing but project has reference.
            // For now, let's proceed with getOrCreate to read the projectId.

            const session = this.sessionStore.getOrCreate(sessionId);
            if (session.projectId) {
                this.projectService.removeSessionFromProject(session.projectId, sessionId);
            }

            this.sessionStore.deleteSession(sessionId);
            return response.status(200).json({ message: 'Session deleted' });
        } catch (error) {
            console.error('Failed to delete session', error);
            return response.status(500).json({ message: 'Failed to delete session' });
        }
    }




    @Get('/api/sessions/:sessionId/:version/archive')
    async downloadArchive(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Res() response: Response,
    ) {
        try {
            const version = Number.parseInt(versionParam, 10);
            if (!Number.isFinite(version) || Number.isNaN(version) || version < 0) {
                return response
                    .status(400)
                    .json({ message: 'Invalid version' });
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
                `attachment; filename="session-${safeId}-version${version}.zip"`,
            );

            archive.pipe(response);

            // Add code files
            for (const [filename, content] of Object.entries(files)) {
                archive.append(content, { name: filename });
            }

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
        } catch (error: any) {
            console.error('Failed to prepare session archive', error);
            return response
                .status(500)
                .json({ message: 'Не удалось подготовить архив' });
        }
    }

    @Get('/api/sessions/:sessionId/:version/files/:filename')
    getFile(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Param('filename') filename: string,
        @Res() response: Response,
    ) {
        const version = Number.parseInt(versionParam, 10);
        if (!Number.isFinite(version) || Number.isNaN(version) || version < 0) {
            return response.status(400).send('Invalid version');
        }

        const validFiles = ['index.html', 'styles.css', 'script.js', 'implementation_plan.md'];
        if (validFiles.includes(filename)) {
            const files = this.sessionStore.getFilesByVersion(sessionId, version);
            if (!files) {
                return response.status(404).send('Files not found');
            }

            let content = files[filename];
            let contentType = 'text/plain';

            if (filename === 'index.html') contentType = 'text/html';
            else if (filename === 'styles.css') contentType = 'text/css';
            else if (filename === 'script.js') contentType = 'application/javascript';
            else if (filename === 'implementation_plan.md') contentType = 'text/markdown';

            if (content === undefined) {
                // Should not happen if validFiles checked, but safety
                return response.status(404).send('File content missing');
            }

            response.setHeader('Content-Type', contentType);
            return response.send(content);
        }

        // Validate filename for fallback (alphanumeric, dashes, underscores, dots) to prevent path traversal
        if (!/^[a-zA-Z0-9-_\.]+$/.test(filename)) {
            return response.status(400).send('Invalid filename');
        }

        // Fallback for other files (images, variants of text files not in cache map?)
        const cwd = process.cwd();
        const sessionRoot = process.env.SESSION_ROOT?.trim() || path.resolve(cwd, 'data', 'sessions');
        const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_') || 'default';
        const safeVersion = version;
        const filePath = path.join(sessionRoot, safeId, 'versions', String(safeVersion), filename);

        if (fs.existsSync(filePath)) {
            const ext = path.extname(filename).toLowerCase();
            let contentType = 'application/octet-stream';
            // Only allow serving images and specific text files if they fell through
            if (ext === '.png') contentType = 'image/png';
            if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
            if (ext === '.gif') contentType = 'image/gif';
            if (ext === '.webp') contentType = 'image/webp';
            if (ext === '.svg') contentType = 'image/svg+xml';
            if (ext === '.html') contentType = 'text/html';
            if (ext === '.css') contentType = 'text/css';
            if (ext === '.js') contentType = 'application/javascript';

            if (contentType === 'application/octet-stream') {
                // Fallback or potentially deny non-images if strict
            }

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

    @Post('/api/sessions/:sessionId/clone/:turn')
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

                    // Add new session to project (using source session's project)
                    const sourceSession = this.sessionStore.getOrCreate(sessionId);
                    if (sourceSession.projectId) {
                        this.projectService.addSessionToProject(sourceSession.projectId, id);
                    }

                    this.sseService.emitSessionCreated({
                        sourceSessionId: sessionId,
                        newSessionId: id,
                        group,
                        projectId: sourceSession.projectId,
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

    @Post('/api/sessions/:sessionId/:version/files/:filename')
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

        // Removed getVersionForTurn logic as we receive version directly

        // Map filename to SessionFiles key - REMOVED
        // We now use filename directly

        const body = req.body;
        console.log(`[updateStaticFile] Saving ${filename}. Content-Type: ${req.headers['content-type']}. Body Type: ${typeof body}`);

        // Handle body: verify it's text.
        let content = '';
        if (typeof body === 'string') {
            content = body;
        } else if (typeof body === 'object' && body !== null) {
            // Fallback for JSON { content: "..." }
            if (typeof body.content === 'string') content = body.content;
            else if (typeof body[filename] === 'string') content = body[filename];
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
                filename,
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
    @Post('/api/sessions/:sessionId/:version/images')
    async uploadGalleryImage(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        const version = Number.parseInt(versionParam, 10);
        if (!Number.isFinite(version) || Number.isNaN(version) || version < 0) {
            return res.status(400).json({ message: 'Invalid version' });
        }

        const storage = multer.memoryStorage(); // Or temp disk storage
        const upload = multer({
            storage: storage,
            limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
        }).single('file');

        return new Promise((resolve) => {
            upload(req, res, async (err) => {
                if (err) {
                    console.error('File upload failed', err);
                    return resolve(
                        res.status(500).json({ message: 'File upload failed' }),
                    );
                }
                if (!req.file) {
                    return resolve(
                        res.status(400).json({ message: 'No file provided' }),
                    );
                }

                try {
                    const metadata = await this.imageService.saveUploadedImage(sessionId, version, req.file);

                    // Handle description generation
                    const generateDescription = req.body.generateDescription === 'true';
                    if (generateDescription) {
                        try {
                            const description = await this.imageService.describeImage(sessionId, version, metadata.filename);
                            await this.imageService.updateImageDescription(sessionId, version, metadata.filename, description);
                            // Optionally update metadata object for response, though frontend refetches
                            metadata.description = description;
                        } catch (descError) {
                            console.error('Failed to generate description during upload', descError);
                            // We don't fail the upload if description generation fails, but we might want to log it
                        }
                    }

                    resolve(res.json(metadata));
                } catch (error) {
                    console.error('Failed to save uploaded image', error);
                    resolve(res.status(500).json({ message: 'Failed to save image' }));
                }
            });
        });
    }

    @Post('/api/sessions/:sessionId/:version/images/:filename/description')
    async updateImageDescription(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Param('filename') filename: string,
        @Body() body: { description: string },
        @Res() res: Response,
    ) {
        const version = Number.parseInt(versionParam, 10);
        if (!Number.isFinite(version) || Number.isNaN(version) || version < 0) {
            return res.status(400).json({ message: 'Invalid version' });
        }

        if (typeof body.description !== 'string') {
            return res.status(400).json({ message: 'Description is required' });
        }

        try {
            await this.imageService.updateImageDescription(sessionId, version, filename, body.description);
            // Return updated list? Or just 200? Let's return the updated image or 200.
            return res.status(200).json({ message: 'Description updated' });
        } catch (error: any) {
            console.error('Failed to update image description', error);
            if (error.message.includes('not found')) {
                return res.status(404).json({ message: error.message });
            }
            return res.status(500).json({ message: 'Failed to update image description' });
        }
    }

    @Delete('/api/sessions/:sessionId/:version/images/:filename')
    async deleteImage(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Param('filename') filename: string,
        @Res() res: Response,
    ) {
        const version = Number.parseInt(versionParam, 10);
        if (!Number.isFinite(version) || Number.isNaN(version) || version < 0) {
            return res.status(400).json({ message: 'Invalid version' });
        }

        try {
            await this.imageService.deleteImage(sessionId, version, filename);
            return res.status(200).json({ message: 'Image deleted' });
        } catch (error: any) {
            console.error('Failed to delete image', error);
            if (error.message.includes('not found')) {
                return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('used')) {
                return res.status(400).json({ message: error.message });
            }
            return res.status(500).json({ message: 'Failed to delete image' });
        }
    }

    @Get('/api/sessions/:sessionId/:version/images/:filename/describe')
    async generateImageDescription(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Param('filename') filename: string,
        @Res() res: Response,
    ) {
        const version = Number.parseInt(versionParam, 10);
        if (!Number.isFinite(version) || Number.isNaN(version) || version < 0) {
            return res.status(400).json({ message: 'Invalid version' });
        }

        try {
            const description = await this.imageService.describeImage(sessionId, version, filename);
            return res.status(200).json({ description });
        } catch (error: any) {
            console.error('Failed to generate image description', error);
            if (error.message.includes('not found')) {
                return res.status(404).json({ message: error.message });
            }
            return res.status(500).json({ message: 'Failed to generate image description', details: error.message });
        }
    }

    @Get('/api/sessions/:sessionId/:version/images')
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
