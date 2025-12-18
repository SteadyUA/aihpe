
import React from 'react';

interface SessionBarProps {
    sessions: string[];
    activeSessionId: string | null;
    onSwitch: (id: string) => void;
    onCreate: () => void;
    statusMap: Record<string, string>;
    groups: Record<string, number>; // Map sessionId -> groupId
    onRemove: (id: string) => void;
}

interface SessionBarState { }

export class SessionBar extends React.Component<SessionBarProps, SessionBarState> {
    render() {
        const { sessions, activeSessionId, onSwitch, onCreate, statusMap, onRemove, groups } = this.props;

        return (
            <div className="session-bar">
                <div className="session-tabs">
                    {sessions.map(id => {
                        const isActive = id === activeSessionId;
                        const status = statusMap?.[id] || 'idle';
                        const isBusy = status === 'busy';
                        const groupId = groups?.[id];
                        const groupClass = groupId ? `session-group-${groupId}` : '';

                        return (
                            <div
                                key={id}
                                className={`session-tab ${isActive ? 'active' : ''} ${groupClass}`}
                                onClick={() => onSwitch(id)}
                            >
                                <span className={`session-tab-status ${isBusy ? 'busy' : ''}`}>
                                    {!isBusy && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                        </svg>
                                    )}
                                </span>
                                <span>{id.slice(0, 8)}</span>
                                <span
                                    className="session-tab-close"
                                    onClick={(e) => { e.stopPropagation(); onRemove(id); }}
                                >×</span>
                            </div>
                        );
                    })}
                    <button className="session-tab-new" onClick={onCreate} title="New Chat">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                </div>
            </div>
        );
    }
}
