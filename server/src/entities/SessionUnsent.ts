import { Entity, PrimaryColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { SessionUpload } from './SessionUpload';

@Entity()
export class SessionUnsent {
    @PrimaryColumn()
    sessionId!: string;

    @Column({ type: 'text', nullable: true })
    input!: string | null;

    @Column({ type: 'varchar', nullable: true })
    provider!: string | null;

    @Column({ type: 'boolean', nullable: true })
    fastMode!: boolean | null;

    @Column({ type: 'text', nullable: true })
    selection!: string | null;

    @Column({ nullable: true })
    uploadId!: number | null;

    @OneToOne(() => SessionUpload)
    @JoinColumn({ name: 'uploadId' })
    attachment!: SessionUpload | null;
}
