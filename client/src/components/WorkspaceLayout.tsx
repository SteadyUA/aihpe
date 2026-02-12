
import React from 'react';
import { SessionBar } from './SessionBar';
import { MainLayout } from './MainLayout';
import { ConfirmationModal } from './ConfirmationModal';
import { ProjectCreationModal } from './ProjectCreationModal';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { withSession, SessionContextProps } from '../contexts/SessionContext';
import { SessionManager } from './SessionManager';
import { LlmProvider } from '../types';
import { withRouter, RouterProps } from './withRouter';
// import styles from './WorkspaceLayout.module.css'; // Replaced by MainLayout

interface WorkspaceLayoutProps extends SessionContextProps, RouterProps {
    projectId: string | null;
    projectName: string;
    projectRulesAndGoal: string;
    projectImageGenerationPref?: string;
    projectDefaultProvider?: LlmProvider;
    projectModelRole?: string;
    initialProjectSessions?: any[];
    initialActiveSessionId?: string | null;

    onUpdateProject: (rules: string, imgPref: string, provider: LlmProvider, name: string, role: string) => Promise<void>;
    onCreateProject: (rules: string, imgPref: string, provider: LlmProvider, name: string) => Promise<void>;

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
        }
    }

    componentDidUpdate(prevProps: WorkspaceLayoutProps) {
        if (
            prevProps.router.location.pathname !== this.props.router.location.pathname ||
            prevProps.activeSessionId !== this.props.activeSessionId ||
            prevProps.sessions !== this.props.sessions ||
            prevProps.projectName !== this.props.projectName
        ) {
            this.updateTitle();
        }

        if (this.props.initialProjectSessions !== prevProps.initialProjectSessions) {
            if (this.props.initialProjectSessions && this.props.initialProjectSessions.length > 0) {
                const sessionId = this.props.initialActiveSessionId || this.props.activeSessionId || this.props.router.searchParams.get('sessionId') || undefined;
                this.props.syncProjectSessions(this.props.initialProjectSessions, sessionId);
            }
        }
    }

    updateTitle = () => {
        const { activeSessionId, sessions, projectName } = this.props;

        if (activeSessionId && sessions[activeSessionId]) {
            const session = sessions[activeSessionId];
            const subject = session.subject || '...';
            const project = projectName || 'AiLand';
            document.title = `${project} - ${subject}`;
        } else if (projectName) {
            document.title = projectName;
        } else {
            document.title = 'AiLand';
        }
    }

    toggleProjectSettings = () => {
        this.setState(prev => ({ showProjectSettings: !prev.showProjectSettings }));
    };

    handleCreateProjectWrapper = async (rules: string, imgPref: string, provider: LlmProvider, name: string) => {
        await this.props.onCreateProject(rules, imgPref, provider, name);
        this.setState({ showProjectCreation: false });
    }

    render() {
        const {
            projectId,
            projectName,
            projectRulesAndGoal,
            projectImageGenerationPref,
            projectDefaultProvider,
            projectModelRole,
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

        const statusMap: Record<string, string> = {};
        const groups: Record<string, number> = {};
        const pendingSessions: string[] = [];
        const subjects: Record<string, string> = {};

        sessionOrder.forEach(id => {
            const s = sessions[id];
            if (s) {
                statusMap[id] = s.status;
                groups[id] = s.group;
                subjects[id] = s.subject || '...';
                if (s.status === 'pending') pendingSessions.push(id);
            }
        });

        return (
            <>
                <ProjectCreationModal
                    isOpen={showProjectCreation}
                    onCreate={this.handleCreateProjectWrapper}
                    onClose={() => this.setState({ showProjectCreation: false })}
                />

                {projectId && (
                    <ProjectSettingsModal
                        isOpen={showProjectSettings}
                        projectId={projectId}
                        currentName={projectName}
                        currentRulesAndGoal={projectRulesAndGoal}
                        currentImageGenerationPref={projectImageGenerationPref}
                        currentDefaultProvider={projectDefaultProvider}
                        currentModelRole={projectModelRole}
                        onUpdate={onUpdateProject}
                        onClose={this.toggleProjectSettings}
                    />
                )}

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
                            projectName={projectName}
                            onReorder={handleSessionReorder}
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
