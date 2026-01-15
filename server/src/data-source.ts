
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATABASE_FILE = path.join(DATA_DIR, 'database.sqlite');

export const AppDataSource = new DataSource({
    type: 'sqlite',
    database: DATABASE_FILE,
    synchronize: false, // Disable synchronize for migrations
    logging: false,
    entities: [path.join(__dirname, 'entities', '*.ts')],
    subscribers: [],
    migrations: [path.join(__dirname, 'migrations', '*.ts')],
});
