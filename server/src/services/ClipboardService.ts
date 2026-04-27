import { Service } from 'typedi';
import { AppDataSource } from '../data-source';
import { ClipboardRecord } from '../entities/ClipboardRecord';
import { SseService } from './SseService';

@Service()
export class ClipboardService {
    constructor(private sseService: SseService) {}

    private get repository() {
        return AppDataSource.getRepository(ClipboardRecord);
    }

    async saveToClipboard(
        accountId: number,
        description: string,
        projectId?: string,
        sessionId?: string,
        version?: number
    ): Promise<ClipboardRecord> {
        // Deactivate all currently active records for this account
        await this.repository.update({ accountId, isActive: true }, { isActive: false });

        // Maintain max 10 records per account
        const count = await this.repository.count({ where: { accountId } });
        if (count >= 10) {
            // Find records to delete (keep newest 9)
            const records = await this.repository.find({
                where: { accountId },
                order: { createdAt: 'DESC' },
                skip: 9
            });

            if (records.length > 0) {
                const idsToDelete = records.map(r => r.id);
                await this.repository.delete(idsToDelete);
            }
        }

        const record = new ClipboardRecord();
        record.accountId = accountId;
        if (projectId) record.projectId = projectId;
        if (sessionId) record.sessionId = sessionId;
        if (version !== undefined) record.version = version;
        record.description = description;
        record.isActive = true;

        const saved = await this.repository.save(record);

        // Broadcast to specific account
        this.sseService.broadcastToAccount(accountId, 'clipboard-update', saved);

        return saved;
    }

    async getActive(accountId: number): Promise<ClipboardRecord | null> {
        return this.repository.findOne({ where: { accountId, isActive: true } });
    }

    async deactivate(accountId: number): Promise<void> {
        await this.repository.update({ accountId, isActive: true }, { isActive: false });
        this.sseService.broadcastToAccount(accountId, 'clipboard-update', null);
    }

    async deleteByProject(projectId: string): Promise<void> {
        const records = await this.repository.find({ where: { projectId } });
        if (records.length > 0) {
            await this.repository.delete(records.map(r => r.id));
            
            // Check if active records were deleted and notify accounts if necessary
            for (const record of records) {
                if (record.isActive) {
                    this.sseService.broadcastToAccount(record.accountId, 'clipboard-update', null);
                }
            }
        }
    }

    async deleteBySession(sessionId: string): Promise<void> {
        const records = await this.repository.find({ where: { sessionId } });
        if (records.length > 0) {
            await this.repository.delete(records.map(r => r.id));
            
            for (const record of records) {
                if (record.isActive) {
                    this.sseService.broadcastToAccount(record.accountId, 'clipboard-update', null);
                }
            }
        }
    }

    async deleteByAccount(accountId: number): Promise<void> {
        await this.repository.delete({ accountId });
        this.sseService.broadcastToAccount(accountId, 'clipboard-update', null);
    }

    async deleteBySessionVersion(sessionId: string, maxVersion: number): Promise<void> {
        // Delete records associated with this session that have a version > maxVersion
        const records = await this.repository.createQueryBuilder('record')
            .where('record.sessionId = :sessionId', { sessionId })
            .andWhere('record.version > :maxVersion', { maxVersion })
            .getMany();

        if (records.length > 0) {
            await this.repository.delete(records.map(r => r.id));
            
            for (const record of records) {
                if (record.isActive) {
                    this.sseService.broadcastToAccount(record.accountId, 'clipboard-update', null);
                }
            }
        }
    }
}
