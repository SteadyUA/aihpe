import { JsonController, Get, Delete, UseBefore, CurrentUser } from 'routing-controllers';
import { Service } from 'typedi';
import { ClipboardService } from '../services/ClipboardService';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';

@Service()
@JsonController('/api/clipboard')
@UseBefore(AuthMiddleware)
export class ClipboardController {
    constructor(private clipboardService: ClipboardService) {}

    @Get('/active')
    async getActive(@CurrentUser() user: any) {
        const accountId = user?.accountId;
        if (!accountId) {
            throw new Error('Account not found in request');
        }
        const record = await this.clipboardService.getActive(accountId);
        return { record };
    }

    @Delete('/active')
    async deactivateActive(@CurrentUser() user: any) {
        const accountId = user?.accountId;
        if (!accountId) {
            throw new Error('Account not found in request');
        }
        await this.clipboardService.deactivate(accountId);
        return { success: true };
    }
}
