import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity()
@Index(['sessionId'])
export class SessionUpload {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column()
    sessionId!: string;

    @Column()
    filename!: string;

    @Column()
    originalName!: string;

    @Column()
    mimeType!: string;

    @Column()
    size!: number;

    @CreateDateColumn()
    createdAt!: Date;
}
