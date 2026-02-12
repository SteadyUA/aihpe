
import React from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { LoginForm } from './components/LoginForm';
import Projects from './components/Projects';
import Settings from './components/Settings';
import ProjectWorkspace from './components/ProjectWorkspace';
import { MainLayout } from './components/MainLayout';
import { withRouter, RouterProps } from './components/withRouter';
import { ConnectionProvider } from './contexts/ConnectionContext';


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
    }

    componentDidUpdate(_prevProps: RouterProps, prevState: AppState) {
        if (this.state.token && !prevState.token) {
            this.setupSse();
        } else if (!this.state.token && prevState.token) {
            this.closeSse();
        }
    }

    componentWillUnmount() {
        this.closeSse();
    }

    setupSse = () => {
        this.closeSse(); // Ensure clean start

        this.evtSource = new EventSource(`${import.meta.env.BASE_URL}api/sse?token=${this.state.token}`);

        this.evtSource.onopen = () => {
            console.log('Global SSE Connected');
            this.setState({ isConnected: true });
        };

        this.evtSource.onerror = (err) => {
            console.error('Global SSE Error', err);
            this.setState({ isConnected: false });
            this.closeSse();
            this.retryTimeout = setTimeout(() => this.setupSse(), 2000);
        };

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

        this.evtSource.addEventListener('session-update', (event: any) => {
            try {
                const payload = JSON.parse(event.data);
                window.dispatchEvent(new CustomEvent('app:session-update', { detail: payload }));
            } catch (e) {
                console.error('Failed to parse session-update', e);
            }
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
            </ConnectionProvider>
        );
    }
}

export default withRouter(App);
