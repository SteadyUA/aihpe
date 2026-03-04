
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { LlmProvider } from '../types/chat';

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

    @Column('text')
    rulesAndGoal!: string;

    @Column({ nullable: true })
    imageGenerationPref?: string;

    @Column({ type: 'simple-json', nullable: true })
    defaultProvider?: LlmProvider;

    @Column({ nullable: true })
    modelRole?: string;

    // Storing session IDs as a simple JSON array or simple-array
    @Column('simple-json', { default: '[]' })
    sessionIds!: string[];

    @Column({ nullable: true })
    lastAssignedSessionGroup?: number;

    // Add activeSessionId
    @Column({ nullable: true })
    activeSessionId?: string;

    @Column({ default: 'ready' })
    status!: 'initialization' | 'ready';

    @Column({ nullable: true })
    taskId?: string;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
