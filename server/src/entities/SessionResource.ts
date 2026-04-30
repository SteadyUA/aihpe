import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Index(['sessionId', 'version'])
@Entity()
export class SessionResource {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column()
    sessionId!: string;

    @Column()
    version!: number;

    @Column()
    filename!: string;

    @Column()
    mimetype!: string;

    @Column('simple-json', { nullable: true, default: '{}' })
    metadata!: Record<string, any>;

    @CreateDateColumn()
    createdAt!: Date;
}
