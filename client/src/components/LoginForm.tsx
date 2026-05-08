import React, { useState } from 'react';
import styles from './LoginForm.module.css';
import { UiInput } from './UiInput';
import { UiCheckbox } from './UiCheckbox';
import { UiButton, ButtonVariant } from './UiButton';
import { UiLabel } from './UiLabel';

interface LoginFormProps {
    onLogin: (token: string, refreshToken: string, remember: boolean) => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onLogin }) => {
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [remember, setRemember] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            const baseUrl = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
            const res = await fetch(`${baseUrl}api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ login, password }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Login failed');
            }

            const data = await res.json();
            onLogin(data.accessToken, data.refreshToken, remember);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <form className={styles.form} onSubmit={handleSubmit}>
                <h2 className={styles.title}>Login</h2>
                {error && <div className={styles.error}>{error}</div>}

                <div className={styles.field}>
                    <UiLabel htmlFor="login">Login</UiLabel>
                    <UiInput
                        id="login"
                        type="text"
                        value={login}
                        onChange={(e) => setLogin(e.target.value)}
                        required
                    />
                </div>

                <div className={styles.field}>
                    <UiLabel htmlFor="password">Password</UiLabel>
                    <UiInput
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </div>

                <div className={styles.checkboxWrapper}>
                    <UiCheckbox
                        checked={remember}
                        onChange={setRemember}
                        label="Remember me"
                    />
                </div>

                <UiButton 
                    type="submit" 
                    disabled={isLoading} 
                    variant={ButtonVariant.PRIMARY}
                    style={{ marginTop: '0.5rem' }}
                >
                    {isLoading ? 'Logging in...' : 'Login'}
                </UiButton>
            </form>
        </div>
    );
};
