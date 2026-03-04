import { AppDataSource } from './src/data-source';
import { Project } from './src/entities/Project';

async function main() {
    await AppDataSource.initialize();
    const projects = await AppDataSource.getRepository(Project).find();
    console.log(JSON.stringify(projects, null, 2));
    await AppDataSource.destroy();
}
main();
