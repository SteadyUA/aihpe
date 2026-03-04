import { AppDataSource } from './src/data-source';
import { Job } from './src/entities/Job';

async function main() {
    await AppDataSource.initialize();
    const jobs = await AppDataSource.getRepository(Job).find();
    console.log(JSON.stringify(jobs, null, 2));
    await AppDataSource.destroy();
}
main();
