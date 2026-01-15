
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Account {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ unique: true })
    login!: string;

    @Column()
    passwordHash!: string;

    @Column({ nullable: true })
    accessToken?: string;

    @Column({ nullable: true })
    refreshToken?: string;
}
