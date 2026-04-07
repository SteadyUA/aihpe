import { Body, HttpError, JsonController, Post } from "routing-controllers";
import { AuthService } from "../services/AuthService";
import { Service } from "typedi";

interface LoginRequest {
    login: string;
    password: string;
}

interface RefreshRequest {
    refreshToken: string;
}

@JsonController('/api/auth')
@Service()
export class AuthController {
    constructor(
        private readonly authService: AuthService
    ) { }

    @Post('/login')
    async login(@Body() body: LoginRequest) {
        if (!body.login || !body.password) {
            throw new HttpError(400, 'Login and password are required');
        }
        return await this.authService.login(body.login, body.password);
    }

    @Post('/refresh')
    async refresh(@Body() body: RefreshRequest) {
        if (!body.refreshToken) {
            throw new HttpError(400, 'Refresh token is required');
        }
        return await this.authService.refresh(body.refreshToken);
    }

}