import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity()
export class ClipboardRecord {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column()
    accountId!: number;

    @Column({ nullable: true })
    projectId!: string;

    @Column({ nullable: true })
    sessionId!: string;

    @Column({ type: 'integer', nullable: true })
    version!: number;

    @Column({ type: 'text' })
    description!: string;

    @Column({ default: true })
    isActive!: boolean;

    @CreateDateColumn()
    createdAt!: Date;
}
