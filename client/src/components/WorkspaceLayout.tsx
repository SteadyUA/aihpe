
import React from 'react';
import { SessionBar } from './SessionBar';
import { MainLayout } from './MainLayout';
import { ConfirmationModal } from './ConfirmationModal';
import { ProjectCreationModal } from './ProjectCreationModal';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { withSession, SessionContextProps } from '../contexts/SessionContext';
import { SessionManager } from './SessionManager';
import { LlmProvider, SessionStatus } from '../types';
import { withRouter, RouterProps } from './withRouter';
// import styles from './WorkspaceLayout.module.css'; // Replaced by MainLayout

interface WorkspaceLayoutProps extends SessionContextProps, RouterProps {
    projectId: string | null;
    currentName?: string;
    projectDefaultProvider?: LlmProvider;
    initialProjectSessions?: any[];
    initialActiveSessionId?: string | null;

    onUpdateProject: (defaultProvider: LlmProvider, name: string) => Promise<void>;
    onCreateProject: (defaultProvider: LlmProvider, name: string, file?: File) => Promise<void>;

    fetchProject: (id: string, sessionContextSync?: (sessions: any[], activeId?: string) => void) => Promise<void>;
}

interface WorkspaceLayoutState {
    showProjectCreation: boolean;
    showProjectSettings: boolean;
}

class WorkspaceLayoutInternal extends React.Component<WorkspaceLayoutProps, WorkspaceLayoutState> {
    constructor(props: WorkspaceLayoutProps) {
        super(props);
        this.state = {
            showProjectCreation: false,
            showProjectSettings: false,
        };
    }

    componentDidMount() {
        this.updateTitle();
        if (this.props.initialProjectSessions && this.props.initialProjectSessions.length > 0) {
            const sessionId = this.props.initialActiveSessionId || this.props.activeSessionId || this.props.router.searchParams.get('sessionId') || undefined;
            this.props.syncProjectSessions(this.props.initialProjectSessions, sessionId);
        } else {
            // Auto-create if no sessions exist
            this.props.createSession();
        }
    }

    componentDidUpdate(prevProps: WorkspaceLayoutProps) {
        if (
            prevProps.router.location.pathname !== this.props.router.location.pathname ||
            prevProps.activeSessionId !== this.props.activeSessionId ||
            prevProps.sessions !== this.props.sessions ||
            prevProps.currentName !== this.props.currentName
        ) {
            this.updateTitle();
        }

        if (this.props.initialProjectSessions !== prevProps.initialProjectSessions) {
            if (this.props.initialProjectSessions && this.props.initialProjectSessions.length > 0) {
                const sessionId = this.props.initialActiveSessionId || this.props.activeSessionId || this.props.router.searchParams.get('sessionId') || undefined;
                this.props.syncProjectSessions(this.props.initialProjectSessions, sessionId);
            } else {
                // Auto-create if updated project has no sessions
                this.props.createSession();
            }
        }

        // If all sessions were deleted, create a new one
        if (prevProps.sessionOrder.length > 0 && this.props.sessionOrder.length === 0) {
            this.props.createSession();
        }
    }

    updateTitle = () => {
        const { activeSessionId, sessions, currentName } = this.props;

        if (activeSessionId && sessions[activeSessionId]) {
            const session = sessions[activeSessionId];
            const subject = session.subject || '...';
            const project = currentName || 'AiLand';
            document.title = `${project} - ${subject}`;
        } else if (currentName) {
            document.title = currentName;
        } else {
            document.title = 'AiLand';
        }
    }

    toggleProjectSettings = () => {
        this.setState(prev => ({ showProjectSettings: !prev.showProjectSettings }));
    };

    handleCreateProjectWrapper = async (provider: LlmProvider, name: string, file?: File) => {
        await this.props.onCreateProject(provider, name, file);
        this.setState({ showProjectCreation: false });
    }

    render() {
        const {
            currentName,
            projectDefaultProvider,
            onUpdateProject,

            sessions,
            sessionOrder,
            activeSessionId,
            switchSession,
            createSession,
            removeSession,
            sessionToDelete,
            confirmDeleteSession,
            cancelDeleteSession,
            handleSessionReorder,
        } = this.props;

        const {
            showProjectCreation,
            showProjectSettings,
        } = this.state;

        const statusMap: Record<string, SessionStatus> = {};
        const groups: Record<string, number> = {};
        const pendingSessions: string[] = [];
        const subjects: Record<string, string> = {};
        const versions: Record<string, number> = {};

        sessionOrder.forEach(id => {
            const s = sessions[id];
            if (s) {
                statusMap[id] = s.status;
                groups[id] = s.group;
                subjects[id] = s.subject || '...';
                versions[id] = s.currentVersion || 0;
                if (s.status === SessionStatus.PENDING) pendingSessions.push(id);
            }
        });

        return (
            <>
                <ProjectCreationModal
                    isOpen={showProjectCreation}
                    onCreate={this.handleCreateProjectWrapper}
                    onClose={() => this.setState({ showProjectCreation: false })}
                />

                <ProjectSettingsModal
                    isOpen={showProjectSettings}
                    currentName={currentName}
                    currentDefaultProvider={projectDefaultProvider}
                    onUpdate={onUpdateProject}
                    onClose={this.toggleProjectSettings}
                />

                <ConfirmationModal
                    isOpen={!!sessionToDelete}
                    title="Close Session"
                    message="Are you sure you want to close this session? This will permanently delete the session and all its files from the server."
                    onConfirm={confirmDeleteSession}
                    onCancel={cancelDeleteSession}
                />

                <MainLayout
                    noScroll={true}
                    headerContent={
                        <SessionBar
                            sessions={sessionOrder}
                            activeSessionId={activeSessionId}
                            onSwitch={switchSession}
                            onCreate={createSession}
                            onRemove={removeSession}
                            statusMap={statusMap}
                            groups={groups}
                            subjects={subjects}
                            pendingSessions={pendingSessions}
                            onProjectSettings={this.toggleProjectSettings}
                            projectName={currentName || 'Untitled'}
                            onReorder={handleSessionReorder}
                            versions={versions}
                        />
                    }
                >
                    <SessionManager />
                </MainLayout>
            </>
        );
    }
}

export const WorkspaceLayout = withRouter(withSession(WorkspaceLayoutInternal));
