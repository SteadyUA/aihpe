
import { Service } from 'typedi';
import { AppDataSource } from '../../data-source';
import { TokenUsage } from '../../entities/TokenUsage';
import { TokenUsage as TokenUsageType } from '../../types/chat';
import { EventBus } from '../../utils/bus';

export const TokenUsageChangedEvent = EventBus.createEvent<{
    sessionId: string;
    tokenUsage: TokenUsageType;
}>('token.usage.changed');

@Service()
export class TokenUsageService {
    private readonly repository = AppDataSource.getRepository(TokenUsage);

    getCapacityForModel(modelId: string | undefined): number {
        if (!modelId) return 128000;
        if (modelId.includes('gpt-5.1') || modelId.includes('gemini-')) {
            return 1000000;
        } else if (modelId.includes('claude-3-5')) {
            return 200000;
        } else if (modelId.includes('gpt-3.5')) {
            return 16000;
        }
        return 128000;
    }

    constructor(private readonly eventBus: EventBus) {}

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

        const summary = await this.getSummary(data.sessionId, data.agent);
        this.eventBus.publish(TokenUsageChangedEvent({
            sessionId: data.sessionId,
            tokenUsage: summary
        }));
    }

    async getSummary(sessionId: string, agent: string): Promise<TokenUsageType> {
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

        const capacity = this.getCapacityForModel(latest?.model);

        return {
            prompt: parseInt(totals?.prompt || '0', 10),
            completion: parseInt(totals?.completion || '0', 10),
            total: parseInt(totals?.total || '0', 10),
            request: latest?.total || 0,
            capacity,
        };
    }
}
