import { JsonController, Post, Body, HttpError, UseBefore, Req, Res } from 'routing-controllers';
import { Service } from 'typedi';
import { AccountService } from '../services/AccountService';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { Request, Response } from 'express';

interface ChangePasswordRequest {
    oldPassword: string;
    newPassword: string;
}

@JsonController('/api/account')
@Service()
export class AccountController {
    constructor(
        private accountService: AccountService,
    ) { }

    @Post('/change-password')
    @UseBefore(AuthMiddleware)
    async changePassword(@Body() body: ChangePasswordRequest, @Req() request: Request, @Res() response: Response) {
        const user = (request as any).user;
        if (!user || !user.login) {
            throw new HttpError(401, 'Unauthorized');
        }

        if (!body.oldPassword || !body.newPassword) {
            throw new HttpError(400, 'Old and new passwords are required');
        }

        await this.accountService.verifyPassword(user.login, body.oldPassword);
        await this.accountService.changePassword(user.login, body.newPassword);
        return response.status(200).json({ message: 'Password changed successfully' });
    }
}
