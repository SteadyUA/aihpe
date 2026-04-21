import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { TaskStatus } from '../types/chat';

export interface Job {
    description: string;
    shortDescription: string;
    completed: boolean;
}

export interface Step {
    stepName: string;
    concurrentJobs: Job[];
}

@Entity('task')
export class Task {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'varchar', default: TaskStatus.PENDING })
    status!: TaskStatus;

    @Column({ type: 'text', nullable: true })
    errorMessage?: string | null;

    @Column('simple-json', { default: '[]' })
    steps!: Step[];

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
