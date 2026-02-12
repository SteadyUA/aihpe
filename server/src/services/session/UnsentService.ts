import { Service } from 'typedi';
import { AppDataSource } from '../../data-source';
import { SessionUnsent } from '../../entities/SessionUnsent';
import { SessionUpload } from '../../entities/SessionUpload';
import { UnsentData, ChatAttachment } from '../../types/chat';

@Service()
export class UnsentService {
    private readonly repository = AppDataSource.getRepository(SessionUnsent);
    private readonly uploadRepository = AppDataSource.getRepository(SessionUpload);

    async getUnsent(sessionId: string): Promise<UnsentData | undefined> {
        const record = await this.repository.findOne({
            where: { sessionId },
            relations: ['attachment'],
        });

        if (!record) return undefined;

        const data: UnsentData = {};
        if (record.input !== null) data.input = record.input;
        if (record.provider !== null) data.provider = record.provider as any;
        if (record.fastMode !== null) data.fastMode = record.fastMode;
        if (record.selection !== null) data.selection = record.selection;

        if (record.attachment) {
            data.attachment = {
                type: 'image',
                filename: record.attachment.filename,
                originalName: record.attachment.originalName,
                id: record.attachment.filename, // Using filename as ID for consistency
            };
        }

        return data;
    }

    async saveUnsent(sessionId: string, data: Partial<UnsentData>): Promise<void> {
        let record = await this.repository.findOne({ where: { sessionId } });

        if (!record) {
            record = new SessionUnsent();
            record.sessionId = sessionId;
        }

        if (data.input !== undefined) record.input = data.input;
        if (data.provider !== undefined) record.provider = data.provider;
        if (data.fastMode !== undefined) record.fastMode = data.fastMode;
        if (data.selection !== undefined) record.selection = data.selection;

        if (data.attachment !== undefined) {
            if (data.attachment === null) {
                record.uploadId = null;
                record.attachment = null;
            } else {
                // Find uploadId by filename
                const upload = await this.uploadRepository.findOne({
                    where: { sessionId, filename: data.attachment.filename }
                });
                if (upload) {
                    record.uploadId = upload.id;
                } else {
                    console.warn(`Upload NOT found for unsent attachment: ${data.attachment.filename} in session ${sessionId}`);
                    record.uploadId = null;
                }
            }
        }

        await this.repository.save(record);
    }

    async deleteUnsent(sessionId: string): Promise<void> {
        await this.repository.delete({ sessionId });
    }
}
