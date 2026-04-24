import {
    Body,
    Delete,
    Get,
    JsonController,
    Param,
    Post,
    UseBefore,
    NotFoundError,
    QueryParam,
    UseInterceptor,
    BadRequestError,
    UploadedFile,
    HttpCode,
} from 'routing-controllers';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import {
    IsIn,
    IsNotEmpty,
    IsOptional,
    IsString,
    ValidateIf,
    ValidateNested,
    IsBoolean,
    IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Service } from 'typedi';
import { ChatService } from '../services/ChatService';

import { SseService } from '../services/SseService';
import { SessionService } from '../services/session/SessionService';
import { TurnService } from '../services/session/TurnService';
import { TokenUsageService } from '../services/llm/TokenUsageService';
import { MemoryService } from '../services/session/MemoryService';

import { LlmProvider, SessionMetadata, UnsentData, SessionStatus } from '../types/chat';
import { UploadService } from '../services/image/UploadService';
import { UnsentService } from '../services/session/UnsentService';
import { FileResponse, FileResponseHandler } from '../interceptors/FileResponseHandler';

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

class UploadResponse {
    @IsNumber()
    id!: number;

    @IsString()
    @IsNotEmpty()
    filename!: string;

    @IsString()
    @IsNotEmpty()
    type!: string;

    @IsString()
    @IsNotEmpty()
    originalName!: string;
}

class SelectionRequest {
    @IsString()
    @IsNotEmpty()
    selector!: string;
}

class ChatRequest {
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

    @IsOptional()
    @IsString()
    provider?: LlmProvider;

    @IsOptional()
    @IsBoolean()
    fastMode?: boolean;
}

class ChatResponse {
    @IsNumber()
    turn!: number;
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

    @IsOptional()
    @IsString()
    provider?: LlmProvider;
}

class OkResponse {
    @IsString()
    message!: string;
}

class CreateSessionResponse {
    @IsString()
    id!: string;

    @IsString()
    projectId!: string;

    @IsNumber()
    group!: number;
}

class CloneSessionResponse {
    @IsString()
    id!: string;

    @IsNumber()
    group!: number;

    @IsNumber()
    currentTurn!: number;

    @IsString()
    updatedAt!: string;

    @IsOptional()
    @IsString()
    subject?: string;

    @IsOptional()
    @IsString()
    provider?: LlmProvider;

    @IsOptional()
    @IsBoolean()
    fastMode?: boolean;
}

class StopGenerationResponse {
    @IsBoolean()
    success!: boolean;

    @IsOptional()
    @IsString()
    restoredInput?: string;

    @IsOptional()
    @IsString()
    restoredSelection?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => AttachmentRequest)
    restoredAttachment?: AttachmentRequest;

    @IsNumber()
    previousTurn!: number;
}

class TurnResponse {
    @IsNumber()
    turn!: number;

    @IsString()
    beginTime!: string;

    @IsOptional()
    @IsString()
    endTime?: string;

    @IsString()
    request!: string;

    @IsString()
    response!: string;

    @IsString()
    provider!: LlmProvider;

    @IsBoolean()
    fastMode!: boolean;

    @IsOptional()
    @ValidateNested()
    @Type(() => SelectionRequest)
    selection?: SelectionRequest;

    @IsOptional()
    @ValidateNested()
    @Type(() => AttachmentRequest)
    attachment?: AttachmentRequest;

    @IsNumber()
    version!: number;
}

class GetTurnsResponse {
    @ValidateNested({ each: true })
    @Type(() => TurnResponse)
    turns!: TurnResponse[];
}

class TokenUsageResponse {
    @IsNumber()
    prompt!: number;
    @IsNumber()
    completion!: number;
    @IsNumber()
    total!: number;
    @IsNumber()
    request!: number;
    @IsNumber()
    capacity!: number;
}

class UnsentDataResponse {
    @IsOptional()
    @IsString()
    input?: string | null;

    @IsOptional()
    @ValidateNested()
    @Type(() => AttachmentRequest)
    attachment?: AttachmentRequest | null;

    @IsOptional()
    @IsString()
    selection?: string | null;

    @IsOptional()
    @IsString()
    provider?: LlmProvider | null;

    @IsOptional()
    @IsBoolean()
    fastMode?: boolean | null;
}

class SessionResponse {
    @IsString()
    id!: string;

    @IsString()
    updatedAt!: string;

    @IsNumber()
    group!: number;

    @IsNumber()
    currentVersion!: number;

    @IsNumber()
    lastTurn!: number;

    @IsString()
    provider!: LlmProvider;

    @IsBoolean()
    fastMode!: boolean;

    @IsOptional()
    @IsString()
    subject?: string;

    @ValidateNested()
    @Type(() => TokenUsageResponse)
    tokenUsage!: TokenUsageResponse;

    @ValidateNested()
    @Type(() => UnsentDataResponse)
    unsent?: UnsentDataResponse;

    @IsString()
    status!: SessionStatus;

    @IsOptional()
    @IsString()
    errorMessage?: string;

    @IsString()
    projectId!: string;
}

@Service()
@JsonController()
export class SessionController {
    constructor(
        private readonly chatService: ChatService,
        private readonly sseService: SseService,
        private readonly tokenUsageService: TokenUsageService,

        private readonly uploadService: UploadService,
        private readonly unsentService: UnsentService,
        private readonly sessionService: SessionService,
        private readonly turnService: TurnService,
        private readonly memoryService: MemoryService,
    ) {
    }

    private async enrichSession(snapshot: SessionMetadata): Promise<SessionResponse> {
        const tokenUsage = await this.tokenUsageService.getSummary(snapshot.id, 'chat');

        return {
            id: snapshot.id,
            updatedAt: snapshot.updatedAt.toISOString(),
            group: snapshot.group,
            currentVersion: snapshot.currentVersion,
            lastTurn: snapshot.lastTurn ?? 0,
            provider: snapshot.provider ?? LlmProvider.OPENAI,
            fastMode: snapshot.fastMode ?? false,
            subject: snapshot.subject,
            tokenUsage,
            unsent: await this.unsentService.getUnsent(snapshot.id),
            status: snapshot.status,
            errorMessage: snapshot.errorMessage,
            projectId: snapshot.projectId,
        };
    }

    @Get('/api/sessions')
    @UseBefore(AuthMiddleware)
    async getSessions(@QueryParam('projectId') projectId: string): Promise<SessionResponse[]> {
        if (!projectId) {
            throw new BadRequestError('projectId query parameter is required');
        }

        const sessions = await this.sessionService.getSessionsByProjectId(projectId);
        const enrichedPromises = sessions.map(s => this.enrichSession(s));

        return Promise.all(enrichedPromises);
    }

    @Post('/api/sessions')
    @UseBefore(AuthMiddleware)
    @HttpCode(201)
    async createSession(@Body() body: CreateSessionRequest): Promise<CreateSessionResponse> {
        const { projectId, provider } = body;
        const id = this.sessionService.getNextId();
        const group = this.sessionService.getNextGroup();

        // Background processing
        setImmediate(async () => {
            try {
                await this.chatService.createSession(id, projectId, group, provider);
            } catch (error) {
                console.error(`Background session creation failed for ${id}`, error);
                this.sseService.emitChatStatus({
                    sessionId: id,
                    status: SessionStatus.ERROR,
                    message: 'Failed to create session',
                });
            }
        });

        return {
            id,
            projectId,
            group,
        };
    }

    @Post('/api/sessions/:sessionId/unsent')
    @UseBefore(AuthMiddleware)
    async saveUnsent(
        @Param('sessionId') sessionId: string,
        @Body() body: UnsentDataRequest,
    ): Promise<OkResponse> {
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

        return { message: 'saved' };
    }

    @Post('/api/sessions/:sessionId/chat')
    @UseBefore(AuthMiddleware)
    @HttpCode(201)
    async sendMessage(
        @Param('sessionId') sessionId: string,
        @Body() body: ChatRequest,
    ): Promise<ChatResponse> {
        const result = await this.chatService.addUserMessage(
            sessionId,
            body.message ?? '',
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

        return {
            turn: result.turn,
        };
    }

    @Post('/api/sessions/:sessionId/stop')
    @UseBefore(AuthMiddleware)
    async stopGeneration(
        @Param('sessionId') sessionId: string,
    ): Promise<StopGenerationResponse> {
        const result = await this.chatService.stopGeneration(sessionId);

        return {
            success: true,
            restoredInput: result.restoredInput,
            restoredSelection: result.restoredSelection,
            restoredAttachment: result.restoredAttachment,
            previousTurn: result.previousTurn
        }
    }

    @Post('/api/sessions/:sessionId/uploads')
    @UseBefore(AuthMiddleware)
    async uploadImage(
        @Param('sessionId') sessionId: string,
        @UploadedFile('file') file: Express.Multer.File,
    ): Promise<UploadResponse> {
        if (!file || !file.buffer) {
            throw new BadRequestError('No file provided');
        }

        const metadata = await this.uploadService.saveUpload(sessionId, file);

        return {
            id: metadata.id,
            filename: metadata.filename,
            type: 'image',
            originalName: metadata.originalName,
        }
    }

    @Delete('/api/sessions/:sessionId/uploads/:filename')
    @UseBefore(AuthMiddleware)
    async deleteUploadedFile(
        @Param('sessionId') sessionId: string,
        @Param('filename') filename: string,
    ): Promise<OkResponse> {
        // Safety: if the deleted file was currently the unsent attachment, clear it
        const unsent = await this.unsentService.getUnsent(sessionId);
        if (unsent?.attachment?.filename === filename) {
            await this.unsentService.saveUnsent(sessionId, { attachment: null });
        }

        // Check if file is used in session history or turns
        const turns = await this.turnService.loadTurns(sessionId);
        const isUsedInTurns = turns.some(turn => turn.attachment?.filename === filename);

        if (isUsedInTurns) {
            // Do not delete physically, just return success (it was removed from the active input on client)
            return { message: 'Attachment detached' };
        }

        await this.uploadService.deleteUpload(sessionId, filename);

        return { message: 'File deleted' };
    }

    @Get('/api/sessions/:sessionId/uploads/:filename')
    @UseInterceptor(FileResponseHandler)
    getUploadedFile(
        @Param('sessionId') sessionId: string,
        @Param('filename') filename: string,
    ) {
        const filePath = this.uploadService.getExistsFilePath(sessionId, filename);
        if (!filePath) {
            throw new NotFoundError('File not found');
        }

        return new FileResponse(filePath);
    }

    @Get('/api/sessions/:sessionId')
    @UseBefore(AuthMiddleware)
    async getSession(@Param('sessionId') sessionId: string): Promise<SessionResponse> {
        const snapshot = await this.sessionService.getMetadata(sessionId);
        if (!snapshot) {
            throw new NotFoundError('Session not found');
        }
        return this.enrichSession(snapshot);
    }

    @Get('/api/sessions/:sessionId/summary')
    @UseBefore(AuthMiddleware)
    async getSessionSummary(@Param('sessionId') sessionId: string): Promise<{ summary: string }> {
        const snapshot = await this.sessionService.getMetadata(sessionId);
        if (!snapshot) {
            throw new NotFoundError('Session not found');
        }
        
        const summary = await this.memoryService.getMemoryContext(sessionId, snapshot.currentVersion);
        return { summary };
    }

    @Get('/api/sessions/:sessionId/turns')
    @UseBefore(AuthMiddleware)
    async getTurns(
        @Param('sessionId') sessionId: string,
    ): Promise<GetTurnsResponse> {
        const turns = await this.turnService.loadTurns(sessionId);

        return {
            turns: turns.map(t => ({
                ...t,
                beginTime: t.beginTime.toISOString(),
                endTime: t.endTime?.toISOString(),
            })),
        };
    }

    @Delete('/api/sessions/:sessionId')
    @UseBefore(AuthMiddleware)
    async deleteSession(@Param('sessionId') sessionId: string): Promise<OkResponse> {
        await this.chatService.deleteSession(sessionId);

        return { message: 'Session deleted' };
    }

    @Post('/api/sessions/:sessionId/undo')
    @UseBefore(AuthMiddleware)
    async undoLastTurn(
        @Param('sessionId') sessionId: string,
    ): Promise<StopGenerationResponse> {
        if (this.chatService.isGenerating(sessionId)) {
            throw new BadRequestError('Cannot undo while generation is in progress. Please stop the generation first.');
        }
        const result = await this.chatService.undoLastTurn(sessionId);
        return {
            success: true,
            restoredInput: result.restoredInput,
            restoredSelection: result.restoredSelection,
            restoredAttachment: result.restoredAttachment,
            previousTurn: result.previousTurn,
        };
    }

    @Post('/api/sessions/:sessionId/clone/:turn')
    @UseBefore(AuthMiddleware)
    @HttpCode(201)
    async cloneTurn(
        @Param('sessionId') sessionId: string,
        @Param('turn') turnParam: string,
    ): Promise<CloneSessionResponse> {
        const turn = Number.parseInt(turnParam, 10);
        if (!Number.isFinite(turn) || Number.isNaN(turn) || turn < 0) {
            throw new BadRequestError('Invalid turn number');
        }

        const sourceSession = await this.sessionService.getMetadata(sessionId);
        if (!sourceSession) {
            throw new NotFoundError('Source session not found');
        }

        const newSessionId = this.sessionService.getNextId();
        const variantGroup = sourceSession.group;

        // Start cloning in background
        setImmediate(async () => {
            try {
                await this.chatService.performCloneSession(newSessionId, sessionId, turn);
            } catch (error) {
                console.error('Background session cloning failed', error);
                this.sseService.emitChatStatus({
                    sessionId: newSessionId,
                    status: SessionStatus.ERROR,
                    message: 'Failed to clone session in background',
                });
            }
        });

        return {
            id: newSessionId,
            group: variantGroup,
            currentTurn: turn,
            updatedAt: new Date().toISOString(),
            subject: sourceSession.subject,
            provider: sourceSession.provider,
            fastMode: sourceSession.fastMode,
        };
    }

}
