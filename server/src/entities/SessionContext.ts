import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { SessionUpload } from './SessionUpload';

@Entity()
export class SessionContext {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column()
    @Index()
    sessionId!: string;

    @Column({ type: 'varchar' })
    role!: string;

    @Column({ type: 'simple-json' })
    content!: any;

    @Column({ type: 'text', nullable: true })
    selection!: string | null;

    @Column({ type: 'simple-json', nullable: true })
    providerData!: any;

    @Column({ nullable: true })
    uploadId!: number | null;

    @ManyToOne(() => SessionUpload)
    @JoinColumn({ name: 'uploadId' })
    attachment!: SessionUpload | null;

    @Column({ type: 'integer' })
    version!: number;

    @Column({ type: 'integer' })
    turn!: number;

    @Column({ type: 'datetime' })
    createdAt!: Date;
}
