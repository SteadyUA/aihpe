import { Get, JsonController, Param, UseBefore, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { AppDataSource } from '../data-source';
import { Job } from '../entities/Job';

@Service()
@JsonController()
export class JobController {
    @Get('/api/jobs/:jobId')
    @UseBefore(AuthMiddleware)
    async getJob(@Param('jobId') jobId: string) {
        const repo = AppDataSource.getRepository(Job);
        const job = await repo.findOne({ where: { id: jobId } });
        if (!job) {
            throw new NotFoundError('Job not found');
        }
        return job;
    }
}
