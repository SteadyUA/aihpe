import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Index(['sessionId', 'version'])
@Entity()
export class SessionImage {
    @PrimaryGeneratedColumn()
    id!: number;



    @Column()
    sessionId!: string;

    @Column()
    version!: number;

    @Column()
    filename!: string;

    @Column('text')
    description!: string;

    @CreateDateColumn()
    createdAt!: Date;

    @Column()
    model!: string;

    @Column({ nullable: true })
    width?: number;

    @Column({ nullable: true })
    height?: number;

    @Column()
    isUsed!: boolean;
}
