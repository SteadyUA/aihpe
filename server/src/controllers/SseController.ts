import { Controller, Get, Req, Res, QueryParam, UnauthorizedError } from 'routing-controllers';
import { Service } from 'typedi';
import { Request, Response } from 'express';
import { SseService } from '../services/SseService';
import { AccountService } from '../services/AccountService';

@Service()
@Controller() // Use @Controller instead of @JsonController to avoid auto-json serialization
export class SseController {
    constructor(
        private readonly sseService: SseService,
        private readonly accountService: AccountService
    ) {
        console.log('SseController initialized');
    }

    @Get('/api/sse')
    async stream(@Req() request: Request, @Res() response: Response, @QueryParam('token') token?: string) {
        try {
            if (!token) {
                throw new UnauthorizedError('Token required');
            }

            await this.accountService.verifyToken(token);

            this.sseService.addClient(request, response);
        } catch (error) {
            console.error('Error in SSE stream:', error);
            if (!response.headersSent) {
                return response.status(401).send('Unauthorized');
            }
        }
        // Return response to request that routing-controllers does not send headers
        return response;
    }
}
