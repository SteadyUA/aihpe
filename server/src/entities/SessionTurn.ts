import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { SessionUpload } from './SessionUpload';

@Entity()
export class SessionTurn {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column()
    @Index()
    sessionId!: string;

    @Column({ type: 'integer' })
    turn!: number;

    @Column({ type: 'datetime' })
    beginTime!: Date;

    @Column({ type: 'datetime', nullable: true })
    endTime!: Date | null;

    @Column({ type: 'text' })
    request!: string;

    @Column({ type: 'text' })
    response!: string;

    @Column({ type: 'varchar' })
    provider!: string;

    @Column({ type: 'boolean' })
    fastMode!: boolean;

    @Column({ type: 'text', nullable: true })
    selection!: string | null;

    @Column({ nullable: true })
    uploadId!: number | null;

    @ManyToOne(() => SessionUpload)
    @JoinColumn({ name: 'uploadId' })
    attachment!: SessionUpload | null;

    @Column({ type: 'integer' })
    version!: number;
}
