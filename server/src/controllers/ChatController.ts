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
    NotFoundError,
    QueryParam,
} from 'routing-controllers';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
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
    IsBoolean,
    IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Service } from 'typedi';
import path from 'path';
import fs from 'fs';
import { ChatService } from '../services/ChatService';
import { ProjectService } from '../services/ProjectService';
import { SseService } from '../services/SseService';
import { FilesService } from '../services/session/FilesService';
import { SessionService } from '../services/session/SessionService';
import { ContextService } from '../services/session/ContextService';
import { TurnService } from '../services/session/TurnService';
import { TokenUsageService } from '../services/TokenUsageService';
import { LlmFactory } from '../services/llm/LlmFactory';

import { ChatAttachment, LlmProvider, UnsentData } from '../types/chat';
import { ImageService } from '../services/image/ImageService';
import { UploadService } from '../services/image/UploadService';
import { UnsentService } from '../services/session/UnsentService';
import { getSessionsDir } from '../utils/pathUtils';

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

    @IsOptional()
    @IsBoolean()
    fastMode?: boolean;
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

    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    modelRole?: string;
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

    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    activeSessionId?: string;

    @IsOptional()
    @IsString()
    modelRole?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    sessionIds?: string[];
}

@Service()
@JsonController()
export class ChatController {
    constructor(
        private readonly chatService: ChatService,
        private readonly projectService: ProjectService,
        private readonly sseService: SseService,
        private readonly imageService: ImageService,
        private readonly tokenUsageService: TokenUsageService,
        private readonly llmFactory: LlmFactory,
        private readonly uploadService: UploadService,
        private readonly unsentService: UnsentService,
        private readonly filesService: FilesService,
        private readonly sessionService: SessionService,
        private readonly contextService: ContextService,
        private readonly turnService: TurnService,
    ) {
        console.log('ChatController initialized');
    }







    @Get('/api/sse')
    stream(@Req() request: Request, @Res() response: Response): Response {
        this.sseService.addClient(request, response);
        return response;
    }

    @Post('/api/projects')
    @UseBefore(AuthMiddleware)
    async createProject(@Body() body: CreateProjectRequest, @Req() request: Request) {
        const accountId = (request as any).user?.accountId;
        return await this.projectService.createProject(body.rulesAndGoal, body.imageGenerationPref, body.defaultProvider, body.name, accountId, body.modelRole);
    }

    @Get('/api/projects')
    @UseBefore(AuthMiddleware)
    async getUserProjects(@Req() request: Request) {
        const accountId = (request as any).user?.accountId;
        if (!accountId) return [];
        return await this.projectService.getUserProjects(accountId);
    }

    @Get('/api/projects/:projectId')
    @UseBefore(AuthMiddleware)
    async getProject(@Param('projectId') projectId: string, @Res() response: Response, @Req() request: Request) {
        const accountId = (request as any).user?.accountId;
        const project = await this.projectService.getProject(projectId, accountId);
        if (!project) {
            return response.status(404).json({ message: 'Project not found' });
        }

        const sessionIds = await this.projectService.getProjectSessions(projectId);
        const sessionDataList = [];
        for (const id of sessionIds) {
            const s = await this.sessionService.getMetadata(id);
            if (s && s.projectId === projectId) {
                sessionDataList.push({
                    sessionId: s.id,
                    group: s.group,
                    status: s.status,
                    subject: s.subject,
                    lastTurn: s.lastTurn ?? 0
                });
            }
        }

        return {
            id: project.id,
            name: project.name,
            rulesAndGoal: project.rulesAndGoal,
            imageGenerationPref: project.imageGenerationPref,
            defaultProvider: project.defaultProvider,
            activeSessionId: project.activeSessionId,
            modelRole: project.modelRole,
            sessions: sessionDataList,
        };
    }

    @Patch('/api/projects/:projectId')
    @UseBefore(AuthMiddleware)
    async updateProject(
        @Param('projectId') projectId: string,
        @Body() body: UpdateProjectRequest,
        @Req() request: Request
    ) {
        const updateData: any = {};
        if (body.rulesAndGoal !== undefined) updateData.rulesAndGoal = body.rulesAndGoal;
        if (body.imageGenerationPref !== undefined) updateData.imageGenerationPref = body.imageGenerationPref;
        if (body.defaultProvider !== undefined) updateData.defaultProvider = body.defaultProvider;
        if (body.name !== undefined) updateData.name = body.name;
        if (body.activeSessionId !== undefined) updateData.activeSessionId = body.activeSessionId;
        if (body.modelRole !== undefined) updateData.modelRole = body.modelRole;
        if (body.sessionIds !== undefined) updateData.sessionIds = body.sessionIds;

        // Since projectService.updateProject expects specific args or a partial object?
        // Let's check how it's called. 
        // Previously: return this.projectService.updateProject(projectId, body);
        // If ProjectService.updateProject takes (id, data), and data matches UpdateProjectRequest structure, then passing body is fine
        // IF the DTO matches the service expectation. 
        // Service updateProject signature: (projectId: string, data: Partial<Project>) OR (..., goal, ...)
        // I need to be careful about what updateProject expects. 
        // Let's assume for now I pass the body with rulesAndGoal.

        const accountId = (request as any).user?.accountId;
        return await this.projectService.updateProject(projectId, updateData, accountId);
    }

    @Delete('/api/projects/:projectId')
    @UseBefore(AuthMiddleware)
    async deleteProject(
        @Param('projectId') projectId: string,
        @Req() request: Request,
        @Res() response: Response
    ) {
        const accountId = (request as any).user?.accountId;
        // Check ownership
        const project = await this.projectService.getProject(projectId, accountId);
        if (!project) {
            return response.status(404).json({ message: 'Project not found' });
        }

        // Delete all sessions associated with the project
        const sessionIds = await this.projectService.getProjectSessions(projectId);
        for (const sessionId of sessionIds) {
            try {
                // Ensure active generation is stopped
                await this.chatService.stopGeneration(sessionId).catch(() => { });
                await this.chatService.deleteSession(sessionId);
            } catch (e) {
                console.error(`Failed to delete session ${sessionId} during project deletion`, e);
                // Continue deleting other sessions and the project
            }
        }

        // Delete the project itself
        await this.projectService.deleteProject(projectId);

        return response.status(200).json({ message: 'Project deleted' });
    }

    @Post('/api/sessions')
    @UseBefore(AuthMiddleware)
    async createSession(@Body() body: CreateSessionRequest, @Res() response: Response) {
        const { projectId } = body;
        const id = crypto.randomUUID();
        const group = this.sessionService.getNextGroup();

        // 1. Immediate response
        response.status(201).json({
            id,
            projectId,
            group,
        });

        // 2. Background processing
        setImmediate(async () => {
            try {
                // Determine provider: explicitly requested > project default > 'openai'
                const project = await this.projectService.getProject(projectId);
                const provider = project?.defaultProvider || 'openai';

                await this.chatService.createSession(id, projectId, group);

                // If we have a project default provider, update the session immediately
                if (provider) {
                    await this.sessionService.updateMetadata(id, { provider });
                }

                await this.projectService.addSessionToProject(projectId, id);

                // 3. Emit event to confirm creation
                this.sseService.emitSessionCreated({
                    sourceSessionId: 'system', // or empty
                    id,
                    group,
                    projectId,
                });

            } catch (error) {
                console.error(`Background session creation failed for ${id}`, error);
                // Should we emit an error event?
                this.sseService.emitChatStatus({
                    sessionId: id,
                    status: 'error',
                    message: 'Failed to create session',
                });
            }
        });

        return response;
    }



    @Post('/api/sessions/:sessionId/unsent')
    @UseBefore(AuthMiddleware)
    async saveUnsent(
        @Param('sessionId') sessionId: string,
        @Body() body: UnsentDataRequest,
    ) {
        // Filter out undefined values from body to ensure we don't overwrite existing data with undefined
        // This is crucial for partial updates (e.g. saving input shouldn't clear selection)
        const updates: Partial<UnsentData> = {};

        const fields: (keyof UnsentDataRequest)[] = ['input', 'attachment', 'selection', 'provider', 'fastMode'];

        for (const field of fields) {
            const value = body[field];
            if (value !== undefined) {
                updates[field] = value as any;
            }
        }

        await this.unsentService.saveUnsent(sessionId, updates);

        return { status: 'saved' };
    }

    @Post('/api/sessions/:sessionId/chat')
    @UseBefore(AuthMiddleware)
    async sendMessage(
        @Param('sessionId') sessionId: string,
        @Body() body: { message: string; attachment?: any; selection?: { selector: string }, provider?: LlmProvider, fastMode?: boolean },
        @Res() response: Response,
    ) {
        const result = await this.chatService.addUserMessage(
            sessionId,
            body.message,
            body.attachment,
            body.selection,
            body.provider,
            body.fastMode,
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

    @Post('/api/sessions/:sessionId/stop')
    @UseBefore(AuthMiddleware)
    async stopGeneration(
        @Param('sessionId') sessionId: string,
    ) {
        return await this.chatService.stopGeneration(sessionId);
    }

    @Post('/api/sessions/:sessionId/uploads')
    @UseBefore(AuthMiddleware)
    async uploadImage(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        const sessionRoot = getSessionsDir();
        const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_');
        const uploadDir = path.join(sessionRoot, safeId, 'uploads');

        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const upload = multer({ storage: multer.memoryStorage() }).single('file');

        return new Promise((resolve) => {
            upload(req, res, async (err) => {
                if (err) {
                    console.error('File upload failed', err);
                    return resolve(
                        res.status(500).json({ message: 'File upload failed' }),
                    );
                }
                if (!req.file || !req.file.buffer) {
                    return resolve(
                        res.status(400).json({ message: 'No file provided' }),
                    );
                }

                try {
                    const metadata = await this.uploadService.saveUpload(sessionId, req.file);

                    resolve(
                        res.json({
                            filename: metadata.filename,
                            type: 'image',
                            originalName: metadata.originalName,
                        }),
                    );
                } catch (e) {
                    console.error('Failed to save uploaded file', e);
                    return resolve(
                        res.status(500).json({ message: 'Failed to save file' }),
                    );
                }
            });
        });
    }

    @Delete('/api/sessions/:sessionId/uploads/:filename')
    @UseBefore(AuthMiddleware)
    async deleteUploadedFile(
        @Param('sessionId') sessionId: string,
        @Param('filename') filename: string,
        @Res() response: Response,
    ) {
        // Sanitize
        if (!/^[a-zA-Z0-9-_\. \(\)]+$/.test(filename)) {
            return response.status(400).send('Invalid filename');
        }

        const sessionRoot = getSessionsDir();
        const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_');
        const uploadDir = path.join(sessionRoot, safeId, 'uploads');
        const filePath = path.join(uploadDir, filename);

        try {
            // Check if file is used in session history or turns
            const turns = await this.turnService.loadTurns(sessionId);
            const isUsedInTurns = turns.some(turn => turn.attachment?.filename === filename);

            if (isUsedInTurns) {
                // Do not delete physically, just return success (it was removed from the active input on client)
                return response.status(200).json({ message: 'Attachment detached' });
            }

            // Safety: if the deleted file was currently the unsent attachment, clear it
            const unsent = await this.unsentService.getUnsent(sessionId);
            if (unsent?.attachment?.filename === filename) {
                await this.unsentService.saveUnsent(sessionId, { attachment: null });
            }

            await this.uploadService.deleteUpload(sessionId, filename);

            return response.status(200).json({ message: 'File deleted' });
        } catch (error) {
            console.error('Failed to delete file', error);
            return response.status(500).json({ message: 'Failed to delete file' });
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

        const sessionRoot = getSessionsDir();
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
    @UseBefore(AuthMiddleware)
    async getSession(@Param('sessionId') sessionId: string) {
        const snapshot = await this.sessionService.getMetadata(sessionId);
        if (!snapshot) {
            throw new NotFoundError('Session not found');
        }

        // history removed
        const usageSummary = await this.tokenUsageService.getSummary(sessionId, 'chat');
        const client = this.llmFactory.getClient(snapshot.provider || 'openai');
        const tokenUsage = {
            ...usageSummary,
            capacity: client.getCapacity()
        };

        return {
            id: snapshot.id,
            updatedAt: snapshot.updatedAt.toISOString(),
            group: snapshot.group,
            currentVersion: snapshot.currentVersion,
            lastTurn: snapshot.lastTurn ?? 0,
            provider: snapshot.provider ?? 'openai',
            fastMode: snapshot.fastMode ?? false,
            subject: snapshot.subject,
            tokenUsage,
            unsent: await this.unsentService.getUnsent(sessionId),
            status: snapshot.status,
            errorMessage: snapshot.errorMessage,
            projectId: snapshot.projectId,
        };
    }

    @Get('/api/sessions/:sessionId/turns')
    @UseBefore(AuthMiddleware)
    async getTurns(
        @Param('sessionId') sessionId: string,
        @QueryParam('limit') limitArg?: number,
        @QueryParam('before') beforeTurn?: number,
    ) {
        // Enforce a static limit for now, ignoring request limit if we want to be strict,
        // or allow it up to a max. Let's stick to 10 as requested in previous tasks,
        // or just use the store default. The user asked to keep pagination logic.
        const limit = 10;
        const turns = await this.turnService.loadTurns(sessionId);
        // We probably need to implement pagination in TurnService if needed, but for now:
        const slicedTurns = turns.filter(t => !beforeTurn || t.turn < beforeTurn).slice(-limit);

        return {
            turns,
        };
    }

    @Get('/api/sessions/:sessionId/summary')
    @UseBefore(AuthMiddleware)
    async getSessionSummary(@Param('sessionId') sessionId: string) {
        const s = await this.sessionService.getMetadata(sessionId);
        return {
            summary: s?.summary,
            summaryTurn: s?.summaryTurn,
        };
    }



    @Delete('/api/sessions/:sessionId')
    @UseBefore(AuthMiddleware)
    async deleteSession(@Param('sessionId') sessionId: string, @Res() response: Response) {
        try {
            const session = await this.sessionService.getMetadata(sessionId);

            if (session?.projectId) {
                await this.projectService.removeSessionFromProject(session.projectId, sessionId);
            }

            // Ensure active generation is stopped
            await this.chatService.stopGeneration(sessionId).catch(() => { });

            // Remove session files
            await this.chatService.deleteSession(sessionId);

            return response.status(200).json({ message: 'Session deleted' });
        } catch (error) {
            console.error('Failed to delete session', error);
            return response.status(500).json({ message: 'Failed to delete session' });
        }
    }




    @Get('/api/sessions/:sessionId/:version/archive')
    @UseBefore(AuthMiddleware)
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
            const session = await this.sessionService.getMetadata(sessionId);
            if (!session) {
                return response.status(404).json({ message: 'Session not found' });
            }
            const files = this.filesService.readVersionFiles(sessionId, version);
            if (!files) {
                return response
                    .status(404)
                    .json({ message: 'Files for the specified turn not found' });
            }

            const safeId =
                sessionId?.replace(/[^a-zA-Z0-9-_]/g, '_') || 'session';
            const archive = archiver('zip', { zlib: { level: 9 } });

            archive.on('error', (error) => {
                console.error('Failed to stream session archive', error);
                if (!response.headersSent) {
                    response
                        .status(500)
                        .json({ message: 'Failed to create archive' });
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
                const sessionRoot = getSessionsDir();
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
                .json({ message: 'Failed to prepare archive' });
        }
    }

    @Get('/api/sessions/:sessionId/:version/files/:filename')
    async getFile(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Param('filename') filename: string,
        @Res() response: Response,
    ) {
        const version = Number.parseInt(versionParam, 10);
        if (!Number.isFinite(version) || Number.isNaN(version) || version < 0) {
            return response.status(400).send('Invalid version');
        }

        const validFiles = ['index.html', 'styles.css', 'script.js'];
        if (validFiles.includes(filename)) {
            const files = this.filesService.readVersionFiles(sessionId, version);
            if (!files) {
                return response.status(404).send('Files not found');
            }

            let content = files[filename];
            let contentType = 'text/plain';

            if (filename === 'index.html') contentType = 'text/html';
            else if (filename === 'styles.css') contentType = 'text/css';
            else if (filename === 'script.js') contentType = 'application/javascript';


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
        const sessionRoot = getSessionsDir();
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
    @UseBefore(AuthMiddleware)
    async undoLastTurn(
        @Param('sessionId') sessionId: string,
        @Res() response: Response,
    ) {
        try {
            if (this.chatService.isGenerating(sessionId)) {
                return response.status(400).json({ message: 'Cannot undo while generation is in progress. Please stop the generation first.' });
            }
            const { success, restoredInput, restoredSelection, restoredAttachment, previousTurn } = await this.chatService.undoLastTurn(sessionId);
            return { success, restoredInput, restoredSelection, restoredAttachment, previousTurn };
        } catch (error) {
            console.error('Failed to undo last turn', error);
            return response
                .status(500)
                .json({ message: 'Failed to undo last turn' });
        }
    }

    @Post('/api/sessions/:sessionId/clone/:turn')
    @UseBefore(AuthMiddleware)
    async cloneTurn(
        @Param('sessionId') sessionId: string,
        @Param('turn') turnParam: string,
        @Res() response: Response,
    ) {
        const turn = Number.parseInt(turnParam, 10);
        if (!Number.isFinite(turn) || Number.isNaN(turn) || turn < 0) {
            return response
                .status(400)
                .json({ message: 'Invalid turn number' });
        }

        try {
            // Prepare ID and Group
            const newSessionId = crypto.randomUUID();
            const sourceSession = await this.sessionService.getMetadata(sessionId);
            if (!sourceSession) {
                return response.status(404).json({ message: 'Source session not found' });
            }
            const variantGroup = sourceSession.group;

            // Start cloning in background
            setImmediate(async () => {
                try {
                    const newSessionMetadata = await this.chatService.performCloneSession(newSessionId, sessionId, turn);

                    // Add new session to project (using source session's project)
                    if (sourceSession.projectId) {
                        await this.projectService.addSessionToProject(sourceSession.projectId, newSessionId);
                    }

                    this.sseService.emitSessionCreated({
                        sourceSessionId: sessionId,
                        id: newSessionId,
                        group: variantGroup,
                        projectId: sourceSession.projectId,
                        lastTurn: newSessionMetadata.lastTurn,
                    });
                } catch (error) {
                    console.error('Background session cloning failed', error);
                    this.sseService.emitChatStatus({
                        sessionId: newSessionId,
                        status: 'error',
                        message: 'Failed to clone session in background',
                        details: error,
                    });
                }
            });

            return response.status(201).json({
                id: newSessionId,
                group: variantGroup,
                currentTurn: turn,
                updatedAt: new Date().toISOString(),
            });
        } catch (error) {
            console.error('Failed to clone session by turn', error);
            return response
                .status(400)
                .json({ message: 'Failed to initiate turn cloning' });
        }
    }

    @Post('/api/sessions/:sessionId/:version/files/:filename')
    async updateStaticFile(
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
            await this.filesService.persistSessionFile(
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
                .json({ message: 'Failed to update file' });
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
                    const session = await this.sessionService.getMetadata(sessionId);
                    const metadata = await this.imageService.saveUploadedImage(sessionId, version, req.file);

                    // Handle description generation
                    const generateDescription = req.body.generateDescription === 'true';
                    if (generateDescription) {
                        try {
                            const tracker = await this.createTokenTracker(sessionId);
                            const description = await this.imageService.describeImage(sessionId, version, metadata.filename, undefined, tracker);
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
            const tracker = await this.createTokenTracker(sessionId);
            const description = await this.imageService.describeImage(sessionId, version, filename, undefined, tracker);
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

    private async createTokenTracker(sessionId: string) {
        // Fetch session to getKey info
        const session = await this.sessionService.getMetadata(sessionId);
        if (!session) throw new Error(`Session ${sessionId} not found`);

        return async (usage: { prompt: number, completion: number, total: number, model: string }) => {
            const currentTurn = session.lastTurn || 0;
            // Maybe increment turn? Or attach to current turn? 
            // In ChatService we attached to the turn being generated. 
            // Here we are outside of a chat turn generation flow (it's a manual upload or manual describe trigger).
            // Attaching to currentTurn is probably safest.

            await this.tokenUsageService.saveUsage({
                projectId: session.projectId,
                sessionId: sessionId,
                agent: 'image',
                turn: currentTurn,
                model: usage.model,
                prompt: usage.prompt,
                completion: usage.completion,
                total: usage.total,
            });
        };
    }
}
