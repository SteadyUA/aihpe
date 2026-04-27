
import React from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { LoginForm } from './components/LoginForm';
import Projects from './components/Projects';
import Settings from './components/Settings';
import ProjectWorkspace from './components/ProjectWorkspace';
import { MainLayout } from './components/MainLayout';
import { withRouter, RouterProps } from './components/withRouter';
import { ConnectionProvider } from './contexts/ConnectionContext';
import { ClipboardProvider } from './contexts/ClipboardContext';
import { apiAuth } from './utils/api';


interface AppState {
    token: string | null;
    isConnected: boolean;
}

class App extends React.Component<RouterProps, AppState> {
    private evtSource: EventSource | null = null;
    private retryTimeout: any = null;

    constructor(props: RouterProps) {
        super(props);
        this.state = {
            token: localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken'),
            isConnected: false,
        };
    }

    componentDidMount() {
        if (this.state.token) {
            this.setupSse();
        }
        apiAuth.addTokenListener(this.onTokenChange);
    }

    componentDidUpdate(_prevProps: RouterProps, prevState: AppState) {
        if (this.state.token !== prevState.token) {
            if (this.state.token) {
                this.setupSse();
            } else {
                this.closeSse();
            }
        }
    }

    componentWillUnmount() {
        this.closeSse();
        apiAuth.removeTokenListener(this.onTokenChange);
    }

    onTokenChange = (newToken: string) => {
        console.log('App: Token refreshed, updating state');
        this.setState({ token: newToken });
    };

    setupSse = () => {
        this.closeSse(); // Ensure clean start

        this.evtSource = new EventSource(`${import.meta.env.BASE_URL}api/sse?token=${this.state.token}`);

        this.evtSource.onopen = () => {
            console.log('Global SSE Connected');
            this.setState({ isConnected: true });
        };

        this.evtSource.onerror = (err: any) => {
            console.error('Global SSE Error', err);
            this.setState({ isConnected: false });

            // If the browser natively closed the connection (e.g. fatal network error),
            // it will not auto-reconnect. We must trigger a manual reconnect.
            // Otherwise, let the browser's EventSource handle reconnection naturally.
            if (this.evtSource && this.evtSource.readyState === EventSource.CLOSED) {
                console.log('SSE connection closed permanently. Scheduling manual reconnect...');
                this.closeSse();
                this.retryTimeout = setTimeout(() => this.setupSse(), 2000);
            }
        };

        // Handle specific auth error event from server
        this.evtSource.addEventListener('auth-error', () => {
            console.log('SSE Auth Error received');
            this.closeSse();

            // Trigger token refresh via probe
            apiAuth.fetch('/api/projects').catch(e => {
                console.warn('SSE Auth Refresh failed', e);
                // If refresh fails, we are likely logged out by apiAuth, so do not retry.
            });
        });

        // Forward Events
        this.evtSource.addEventListener('chat-status', (e: any) => {
            const data = JSON.parse(e.data);
            window.dispatchEvent(new CustomEvent('app:chat-status', { detail: data }));
            window.dispatchEvent(new CustomEvent('processed-chat-event', { detail: data }));
        });

        this.evtSource.addEventListener('session-created', (e: any) => {
            const data = JSON.parse(e.data);
            window.dispatchEvent(new CustomEvent('app:session-created', { detail: data }));
        });

        this.evtSource.addEventListener('turn-completed', (e: any) => {
            const data = JSON.parse(e.data);
            window.dispatchEvent(new CustomEvent('app:turn-completed', { detail: data }));
        });

        this.evtSource.addEventListener('token-usage', (e: any) => {
            const data = JSON.parse(e.data);
            window.dispatchEvent(new CustomEvent('app:token-usage', { detail: data }));
        });

        this.evtSource.addEventListener('session-update', (event: any) => {
            try {
                const payload = JSON.parse(event.data);
                window.dispatchEvent(new CustomEvent('app:session-update', { detail: payload }));
            } catch (e) {
                console.error('Failed to parse session-update', e);
            }
        });

        this.evtSource.addEventListener('clipboard-update', (e: any) => {
            const data = JSON.parse(e.data);
            window.dispatchEvent(new CustomEvent('app:clipboard-update', { detail: data }));
        });

        this.evtSource.addEventListener('server-stop', () => {
            console.log('Server stopping');
            this.closeSse();
            window.dispatchEvent(new CustomEvent('app:server-stop'));
            this.retryTimeout = setTimeout(() => {
                this.setupSse();
            }, 5000);
        });
    };

    closeSse = () => {
        if (this.evtSource) {
            this.evtSource.close();
            this.evtSource = null;
        }
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }
        this.setState({ isConnected: false });
    };

    handleLogin = (newToken: string, refreshToken: string, remember: boolean) => {
        if (remember) {
            localStorage.setItem('accessToken', newToken);
            localStorage.setItem('refreshToken', refreshToken);
        } else {
            sessionStorage.setItem('accessToken', newToken);
            sessionStorage.setItem('refreshToken', refreshToken);
        }
        this.setState({ token: newToken });
    };

    render() {
        const { token, isConnected } = this.state;
        const { navigate } = this.props.router;

        if (!token) {
            return <LoginForm onLogin={this.handleLogin} />;
        }

        return (
            <ConnectionProvider isConnected={isConnected}>
                <ClipboardProvider>
                    <Routes>
                        <Route path="/projects" element={
                            <MainLayout headerContent={
                                <div style={{ marginLeft: '1rem', fontWeight: 600, fontSize: '1.2rem' }}>My Projects</div>
                            }>
                                <Projects
                                    currentProjectId={null}
                                    onSelectProject={(id) => navigate(`/project/${id}`)}
                                />
                            </MainLayout>
                        } />
                        <Route path="/settings" element={
                            <MainLayout headerContent={
                                <div style={{ marginLeft: '1rem', fontWeight: 600, fontSize: '1.2rem' }}>Settings</div>
                            }>
                                <Settings />
                            </MainLayout>
                        } />
                        <Route path="/project/:projectId" element={
                            <ProjectWorkspace />
                        } />
                        <Route path="/" element={<Navigate to="/projects" replace />} />
                        <Route path="*" element={<Navigate to="/projects" replace />} />
                    </Routes>
                </ClipboardProvider>
            </ConnectionProvider>
        );
    }
}

export default withRouter(App);
