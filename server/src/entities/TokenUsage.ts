
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Index(['sessionId', 'agent'])
@Entity()
export class TokenUsage {
    @PrimaryGeneratedColumn()
    id!: number;

    @Index()
    @Column()
    projectId!: string;

    @Column()
    sessionId!: string;

    @Column({ default: 'chat' })
    agent!: string;

    @Column()
    turn!: number;

    @Column()
    model!: string;

    @Column('int')
    total!: number;

    @Column('int')
    prompt!: number;

    @Column('int')
    completion!: number;

    @CreateDateColumn()
    createdAt!: Date;
}
