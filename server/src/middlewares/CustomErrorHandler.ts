import { Middleware, ExpressErrorMiddlewareInterface, HttpError } from 'routing-controllers';
import { Service } from 'typedi';
import { Request, Response, NextFunction } from 'express';

@Service()
@Middleware({ type: 'after' })
export class CustomErrorHandler implements ExpressErrorMiddlewareInterface {
    error(error: any, request: Request, response: Response, next: NextFunction): void {
        const status = error instanceof HttpError ? error.httpCode : (error.status || 500);
        const message = error.message || 'Internal Server Error';

        const logEntry = {
            timestamp: new Date().toISOString(),
            method: request.method,
            path: request.path,
            status,
            message,
            // stack: error.stack,
        };

        // For now, write structured JSON to console.error
        console.error(JSON.stringify(logEntry, null, 2));

        // Skip the default routing-controllers handler and send the response directly
        if (!response.headersSent) {
            response.status(status).json({
                name: error.name || 'Error',
                message: message,
                errors: error.errors || [] // Important for class-validator
            });
        }
    }
}
