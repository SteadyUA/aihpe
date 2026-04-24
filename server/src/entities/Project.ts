
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { LlmProvider, ProjectStatus } from '../types/chat';

@Entity()
export class Project {
    @PrimaryColumn()
    id!: string;

    @Column()
    name!: string;

    // Use nullable for optional account binding, though usually we want it.
    // Migration will fit existing data.
    @Column({ nullable: true })
    accountId?: number;

    @Column({ type: 'simple-json', nullable: true })
    defaultProvider?: LlmProvider;

    // Storing session IDs as a simple JSON array or simple-array
    @Column('simple-json', { default: '[]' })
    sessionIds!: string[];

    @Column({ nullable: true })
    lastAssignedSessionGroup?: number;

    // Add activeSessionId
    @Column({ nullable: true })
    activeSessionId?: string;

    @Column({ type: 'varchar', default: ProjectStatus.READY })
    status!: ProjectStatus;

    @Column({ nullable: true })
    taskId?: string;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
