
import React from 'react';
import { WorkspaceLayout } from './WorkspaceLayout';
import { SessionProvider } from '../contexts/SessionContext';
import { apiAuth } from '../utils/api';
import { LlmProvider, ProjectStatus } from '../types';
import { withRouter, RouterProps } from './withRouter';
import { ProjectInitialization } from './ProjectInitialization';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface ProjectWorkspaceProps extends RouterProps {
}

interface ProjectWorkspaceState {
    projectId: string | null;
    projectName: string;
    projectRulesAndGoal: string;
    projectImageGenerationPref: string;
    projectDefaultProvider: LlmProvider;
    projectModelRole: string;
    projectSessions: any[];
    activeSessionId?: string | null;
    projectStatus?: ProjectStatus;
    projectTaskId?: string;
}

class ProjectWorkspace extends React.Component<ProjectWorkspaceProps, ProjectWorkspaceState> {
    constructor(props: ProjectWorkspaceProps) {
        super(props);
        this.state = {
            projectId: null,
            projectName: '',
            projectRulesAndGoal: '',
            projectImageGenerationPref: '',
            projectDefaultProvider: LlmProvider.OPENAI,
            projectModelRole: '',
            projectSessions: [],
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
                projectName: data.name || 'Untitled',
                projectRulesAndGoal: data.rulesAndGoal || '',
                projectImageGenerationPref: data.imageGenerationPref,
                projectDefaultProvider: data.defaultProvider,
                projectModelRole: data.modelRole,
                projectSessions: sessionsData,
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

    handleCreateProject = async (rules: string, imgPref: string, provider: LlmProvider, name: string, modelRole: string, file?: File) => {
        try {
            const formData = new FormData();
            formData.append('name', name);
            formData.append('rulesAndGoal', rules);
            formData.append('imageGenerationPref', imgPref);
            formData.append('defaultProvider', provider);
            formData.append('modelRole', modelRole);
            if (file) {
                formData.append('file', file);
            }

            const response = await apiAuth.fetch('/api/projects', {
                method: 'POST',
                body: formData,
            });
            if (!response.ok) throw new Error('Failed to create project');
            const project = await response.json();

            this.setState({
                projectId: project.id,
                projectName: project.name,
                projectRulesAndGoal: project.rulesAndGoal,
                projectImageGenerationPref: project.imageGenerationPref,
                projectDefaultProvider: project.defaultProvider,
                projectModelRole: project.modelRole,
                projectStatus: project.status,
                projectTaskId: project.taskId,
                activeSessionId: project.activeSessionId,
                projectSessions: project.sessions || []
            }, () => {
                this.normalizeUrl(project);
            });
        } catch (e) {
            console.error('Failed to create project', e);
            throw e;
        }
    };

    handleUpdateProject = async (rules: string, imgPref: string, provider: LlmProvider, name: string, modelRole: string) => {
        const { projectId } = this.state;
        if (!projectId) return;

        try {
            const response = await apiAuth.fetch(`/api/projects/${projectId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rulesAndGoal: rules,
                    imageGenerationPref: imgPref,
                    defaultProvider: provider,
                    name,
                    modelRole
                })
            });
            if (!response.ok) throw new Error('Failed to update project');

            this.setState({
                projectName: name,
                projectRulesAndGoal: rules,
                projectImageGenerationPref: imgPref,
                projectDefaultProvider: provider,
                projectModelRole: modelRole
            });
        } catch (e) {
            console.error('Failed to update project', e);
        }
    };

    render() {
        const {
            projectId, projectName, projectRulesAndGoal,
            projectImageGenerationPref, projectDefaultProvider, projectModelRole,
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
                    projectName={projectName}
                    projectRulesAndGoal={projectRulesAndGoal}
                    projectImageGenerationPref={projectImageGenerationPref}
                    projectDefaultProvider={projectDefaultProvider}
                    projectModelRole={projectModelRole}
                    initialProjectSessions={this.state.projectSessions}
                    initialActiveSessionId={this.state.activeSessionId}

                    onUpdateProject={this.handleUpdateProject}
                    onCreateProject={this.handleCreateProject}

                    fetchProject={this.fetchProject}
                />
            </SessionProvider>
        );
    }
}

export default withRouter(ProjectWorkspace);
