import React, { Component } from 'react';
import { withRouter, RouterProps } from './withRouter';
import styles from './Settings.module.css';
import { UiModal } from './UiModal';
import { UiInput } from './UiInput';
import { UiLabel } from './UiLabel';
import { UiButton, ButtonVariant } from './UiButton';
import { apiAuth } from '../utils/api';

interface SettingsProps extends RouterProps { }

interface SettingsState {
    login: string;
    isChangePasswordOpen: boolean;
    oldPassword: string;
    newPassword: string;
    repeatPassword: string;
    error: string | null;
    success: string | null;
}

class Settings extends Component<SettingsProps, SettingsState> {
    constructor(props: SettingsProps) {
        super(props);
        this.state = {
            login: '',
            isChangePasswordOpen: false,
            oldPassword: '',
            newPassword: '',
            repeatPassword: '',
            error: null,
            success: null
        };
    }

    componentDidMount() {
        document.title = 'Settings';
        const login = this.getLoginFromToken();
        if (login) {
            this.setState({ login });
        }
    }

    getLoginFromToken(): string {
        const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
        if (!token) return '';
        try {
            const payload = token.split('.')[1];
            const decoded = JSON.parse(atob(payload));
            return decoded.login || '';
        } catch (e) {
            console.error('Failed to decode token', e);
            return '';
        }
    }

    toggleChangePassword = () => {
        this.setState(prev => ({
            isChangePasswordOpen: !prev.isChangePasswordOpen,
            error: null,
            success: null,
            oldPassword: '',
            newPassword: '',
            repeatPassword: ''
        }));
    };

    handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        this.setState({ [name as any]: value } as any);
    };

    handleSubmitChangePassword = async () => {
        const { oldPassword, newPassword, repeatPassword } = this.state;
        this.setState({ error: null, success: null });

        if (!oldPassword || !newPassword || !repeatPassword) {
            this.setState({ error: 'All fields are required' });
            return;
        }

        if (newPassword !== repeatPassword) {
            this.setState({ error: 'New passwords do not match' });
            return;
        }

        if (newPassword.length < 6) {
            this.setState({ error: 'Password must be at least 6 characters long' });
            return;
        }

        try {
            const res = await apiAuth.fetch('/api/account/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPassword, newPassword })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Failed to change password');
            }

            this.setState({ success: 'Password changed successfully', error: null });

            // Close modal after short delay? Or just show success inside modal?
            // "and buttons cancel, save" - implying modal.
            // Let's close it after 1.5s or let user close.
            // Requirement says "buttons cancel, save".
            // Let's keep it simple: Show success message, maybe clear fields.
            this.setState({ oldPassword: '', newPassword: '', repeatPassword: '' });
            setTimeout(this.toggleChangePassword, 1500);

        } catch (e: any) {
            this.setState({ error: e.message });
        }
    };

    render() {
        const { login, isChangePasswordOpen, oldPassword, newPassword, repeatPassword, error, success } = this.state;

        return (
            <div className={styles.container}>
                <div className={styles.content}>
                    <div className={styles.header}>
                        <h1 className={styles.title}>Settings</h1>
                    </div>

                    <div className={styles.section}>
                        <h2 className={styles.sectionTitle}>Authentication</h2>
                        <div className={styles.fieldRow}>
                            <UiLabel>Login:</UiLabel>
                            <span className={styles.value}>{login || 'Unknown'}</span>
                        </div>
                        <div className={styles.fieldRow}>
                            <UiLabel>Password:</UiLabel>
                            <UiButton variant={ButtonVariant.SECONDARY} onClick={this.toggleChangePassword}>Change Password</UiButton>
                        </div>
                    </div>
                </div>

                <UiModal
                    isOpen={isChangePasswordOpen}
                    title="Change Password"
                    onClose={this.toggleChangePassword}
                    actions={
                        <>
                            <UiButton variant={ButtonVariant.SECONDARY} onClick={this.toggleChangePassword}>Cancel</UiButton>
                            <UiButton variant={ButtonVariant.PRIMARY} onClick={this.handleSubmitChangePassword}>Save</UiButton>
                        </>
                    }
                >
                    <div className={styles.form}>
                        {error && <div className={styles.error}>{error}</div>}
                        {success && <div className={styles.success}>{success}</div>}

                        <div className={styles.formGroup}>
                            <UiLabel>Current Password</UiLabel>
                            <UiInput
                                type="password"
                                name="oldPassword"
                                value={oldPassword}
                                onChange={this.handleChange}
                                placeholder="Enter current password"
                            />
                        </div>
                        <div className={styles.formGroup}>
                            <UiLabel>New Password</UiLabel>
                            <UiInput
                                type="password"
                                name="newPassword"
                                value={newPassword}
                                onChange={this.handleChange}
                                placeholder="Enter new password"
                            />
                        </div>
                        <div className={styles.formGroup}>
                            <UiLabel>Repeat New Password</UiLabel>
                            <UiInput
                                type="password"
                                name="repeatPassword"
                                value={repeatPassword}
                                onChange={this.handleChange}
                                placeholder="Repeat new password"
                            />
                        </div>
                    </div>
                </UiModal>
            </div>
        );
    }
}

export default withRouter(Settings);
