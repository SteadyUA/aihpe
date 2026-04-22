import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Project } from './Project';

import { SessionStatus } from '../types/chat';

@Entity()
export class Session {
    @PrimaryColumn()
    sessionId!: string;

    @Column({ type: 'varchar' })
    projectId!: string;

    @Column({ type: 'integer' })
    group!: number;

    @Column({ type: 'integer' })
    currentVersion!: number;

    @Column({ type: 'integer', nullable: true })
    lastTurn!: number | null;

    @Column({ type: 'varchar' })
    provider!: string;

    @Column({ type: 'varchar' })
    status!: SessionStatus;

    @Column({ type: 'boolean' })
    fastMode!: boolean;

    @Column({ type: 'text', nullable: true })
    subject!: string | null;

    @Column({ type: 'text', nullable: true })
    summary!: string | null;

    @Column({ type: 'integer', nullable: true })
    summaryTurn!: number | null;

    @Column({ type: 'text', nullable: true })
    errorMessage!: string | null;

    @Column({ type: 'datetime' })
    updatedAt!: Date;
}
