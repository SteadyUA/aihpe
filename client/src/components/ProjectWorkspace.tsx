
import React from 'react';
import { WorkspaceLayout } from './WorkspaceLayout';
import { SessionProvider } from '../contexts/SessionContext';
import { apiAuth } from '../utils/api';
import { LlmProvider, ProjectStatus, Project, Session } from '../types';
import { withRouter, RouterProps } from './withRouter';
import { ProjectInitialization } from './ProjectInitialization';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface ProjectWorkspaceProps extends RouterProps {
}

interface ProjectWorkspaceState {
    projectId: string | null;
    project: Project | null;
    projectDefaultProvider?: LlmProvider;
    isSettingsModalOpen: boolean;
    sessions: Session[];
    activeSessionId?: string | null;
    projectStatus?: ProjectStatus;
    projectTaskId?: string;
}

class ProjectWorkspace extends React.Component<ProjectWorkspaceProps, ProjectWorkspaceState> {
    constructor(props: ProjectWorkspaceProps) {
        super(props);
        this.state = {
            projectId: null,
            project: null,
            isSettingsModalOpen: false,
            sessions: [],
            activeSessionId: null,
            projectStatus: ProjectStatus.READY,
            projectTaskId: undefined,
        };
    }

    componentDidMount() {
        this.initWorkspace();
    }

    componentDidUpdate(prevProps: ProjectWorkspaceProps) {
        const prevParams = prevProps.router.params as Record<string, string | undefined>;
        const currParams = this.props.router.params as Record<string, string | undefined>;

        if (prevParams['projectId'] !== currParams['projectId']) {
            this.initWorkspace();
        }
    }

    initWorkspace = async () => {
        const { params } = this.props.router;
        const projectIdParam = (params as Record<string, string | undefined>)['projectId'];

        if (projectIdParam) {
            await this.fetchProject(projectIdParam);
        }
    };

    fetchProject = async (id: string, sessionContextSync?: (sessions: any[], activeId?: string) => void) => {
        try {
            const res = await apiAuth.fetch(`/api/projects/${id}`);
            if (!res.ok) throw new Error('Failed to fetch project');

            const data = await res.json();

            let sessionsData = [];
            try {
                const sessionsRes = await apiAuth.fetch(`/api/sessions?projectId=${id}`);
                if (sessionsRes.ok) {
                    const unsortedSessions = await sessionsRes.json();
                    
                    if (data.sessionIds && Array.isArray(data.sessionIds)) {
                        sessionsData = data.sessionIds
                            .map((sessionId: string) => unsortedSessions.find((s: any) => s.id === sessionId))
                            .filter(Boolean);
                    } else {
                        sessionsData = unsortedSessions;
                    }
                }
            } catch (sessionErr) {
                console.error('Failed to fetch project sessions', sessionErr);
            }

            this.setState({
                projectId: id,
                project: data,
                projectDefaultProvider: data.defaultProvider,
                sessions: sessionsData,
                activeSessionId: data.activeSessionId,
                projectStatus: data.status,
                projectTaskId: data.taskId,
            }, () => {
                if (sessionContextSync && sessionsData) {
                    sessionContextSync(sessionsData, data.activeSessionId);
                }
                this.normalizeUrl({ ...data, sessions: sessionsData });
            });

        } catch (e) {
            console.error('Failed to load project', e);
        }
    };

    normalizeUrl = (projectData: any) => {
        const { router } = this.props;
        const { searchParams, navigate, location } = router;

        const sessionIdQuery = searchParams.get('sessionId');

        if (!sessionIdQuery) {
            // No session specified. Find active.
            const activeId = projectData.activeSessionId ||
                (projectData.sessions && projectData.sessions.length > 0 ? (projectData.sessions[0].id || projectData.sessions[0].sessionId) : null);

            if (activeId) {
                // Replace URL
                const newParams = new URLSearchParams(searchParams);
                newParams.set('sessionId', activeId);
                navigate(`${location.pathname}?${newParams.toString()}`, { replace: true });
            }
        }
    };

    handleSaveProjectSettings = async (defaultProvider: LlmProvider, name: string) => {
        try {
            const { project } = this.state;
            if (!project) return;

            const response = await apiAuth.fetch(`/api/projects/${project.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    defaultProvider,
                    name
                })
            });
            if (!response.ok) throw new Error('Failed to update project');
            const updatedProject = await response.json();

            this.setState({
                project: updatedProject,
                projectDefaultProvider: updatedProject.defaultProvider,
                isSettingsModalOpen: false
            });
        } catch (e) {
            console.error('Failed to update project', e);
        }
    };

    render() {
        const {
            projectId, project, projectDefaultProvider,
            projectStatus, projectTaskId
        } = this.state;

        console.log("RENDER ProjectWorkspace", { projectId, projectStatus, projectTaskId });

        if (!projectId) return <div>Loading Workspace...</div>;

        if (projectStatus === ProjectStatus.INITIALIZATION && projectTaskId) {
            return (
                <ProjectInitialization
                    taskId={projectTaskId}
                    onComplete={() => this.fetchProject(projectId)}
                />
            );
        }

        return (
            <SessionProvider projectId={projectId} initialActiveSessionId={this.state.activeSessionId}>
                <WorkspaceLayout
                    projectId={projectId}
                    currentName={project?.name}
                    projectDefaultProvider={projectDefaultProvider}
                    onUpdateProject={this.handleSaveProjectSettings}
                    initialProjectSessions={this.state.sessions}
                    initialActiveSessionId={this.state.activeSessionId}
                    
                    onCreateProject={async (prov, name, file) => {
                        // Not implemented at workspace level yet, usually done in Projects
                    }}
                    fetchProject={this.fetchProject}
                />
            </SessionProvider>
        );
    }
}

export default withRouter(ProjectWorkspace);
