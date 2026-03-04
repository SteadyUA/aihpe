import { Get, JsonController, Param, UseBefore, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { AppDataSource } from '../data-source';
import { Task } from '../entities/Task';

@Service()
@JsonController()
export class TaskController {
    @Get('/api/tasks/:taskId')
    @UseBefore(AuthMiddleware)
    async getTask(@Param('taskId') taskId: string) {
        const repo = AppDataSource.getRepository(Task);
        const task = await repo.findOne({ where: { id: taskId } });
        if (!task) {
            throw new NotFoundError('Task not found');
        }
        return task;
    }
}
