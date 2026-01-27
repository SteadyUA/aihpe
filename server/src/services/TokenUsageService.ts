
import { Service } from 'typedi';
import { AppDataSource } from '../data-source';
import { TokenUsage } from '../entities/TokenUsage';
import { TokenUsage as TokenUsageType } from '../types/chat';

@Service()
export class TokenUsageService {
    private readonly repository = AppDataSource.getRepository(TokenUsage);

    async saveUsage(data: {
        projectId: string;
        sessionId: string;
        agent: string;
        turn: number;
        model: string;
        total: number;
        prompt: number;
        completion: number;
    }): Promise<void> {
        const usage = new TokenUsage();
        usage.projectId = data.projectId;
        usage.sessionId = data.sessionId;
        usage.agent = data.agent;
        usage.turn = data.turn;
        usage.model = data.model;
        usage.total = data.total;
        usage.prompt = data.prompt;
        usage.completion = data.completion;
        await this.repository.save(usage);
    }

    async getSummary(sessionId: string, agent: string): Promise<Omit<TokenUsageType, 'capacity'>> {
        const totals = await this.repository.createQueryBuilder('usage')
            .select('SUM(usage.total)', 'total')
            .addSelect('SUM(usage.prompt)', 'prompt')
            .addSelect('SUM(usage.completion)', 'completion')
            .where('usage.sessionId = :sessionId', { sessionId })
            .andWhere('usage.agent = :agent', { agent })
            .getRawOne();

        const latest = await this.repository.findOne({
            where: { sessionId, agent },
            order: { id: 'DESC' }
        });

        return {
            prompt: parseInt(totals?.prompt || '0', 10),
            completion: parseInt(totals?.completion || '0', 10),
            total: parseInt(totals?.total || '0', 10),
            request: latest?.total || 0,
        };
    }
}
