import { JsonController, Post, Body, HttpError } from 'routing-controllers';
import { Service } from 'typedi';
import { AccountService } from '../services/AccountService';

interface LoginRequest {
    login: string;
    password: string;
}

interface RefreshRequest {
    refreshToken: string;
}

@JsonController('/api/account')
@Service()
export class AccountController {
    constructor(private accountService: AccountService) { }

    @Post('/login')
    login(@Body() body: LoginRequest) {
        if (!body.login || !body.password) {
            throw new HttpError(400, 'Login and password are required');
        }
        return this.accountService.login(body.login, body.password);
    }

    @Post('/refresh')
    refresh(@Body() body: RefreshRequest) {
        if (!body.refreshToken) {
            throw new HttpError(400, 'Refresh token is required');
        }
        return this.accountService.refresh(body.refreshToken);
    }
}
