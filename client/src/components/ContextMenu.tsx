import React from 'react';
import styles from './ContextMenu.module.css';
import { ChevronRightIcon } from '../icons';
export interface MenuItem {
    id: string;
    label: string;
    icon?: React.ReactNode;
    onClick?: () => void;
    subItems?: MenuItem[];
}

export interface ContextMenuProps {
    x: number;
    y: number;
    items: MenuItem[];
    onClose: () => void;
}

interface ContextMenuState {
    hoveredItemId: string | null;
    showSubMenuOnLeft: boolean;
    showSubMenuUp: boolean;
}

export class ContextMenu extends React.Component<ContextMenuProps, ContextMenuState> {
    private menuRef = React.createRef<HTMLDivElement>();

    constructor(props: ContextMenuProps) {
        super(props);
        this.state = {
            hoveredItemId: null,
            showSubMenuOnLeft: false,
            showSubMenuUp: false
        };
    }

    componentDidMount() {
        document.addEventListener('mousedown', this.handleClickOutside);
    }

    componentWillUnmount() {
        document.removeEventListener('mousedown', this.handleClickOutside);
    }

    handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // Prevent closing if we are clicking on the quote that opened it
        // The class name for actionableQuote comes from Chat.module.css, but we can check attribute
        if (target.closest('[class*="actionableQuote"]')) {
            return;
        }
        if (this.menuRef.current && !this.menuRef.current.contains(target)) {
            this.props.onClose();
        }
    };

    render() {
        const { x, y, items } = this.props;
        const { hoveredItemId } = this.state;

        return (
            <div
                ref={this.menuRef}
                id="chat-context-menu"
                className={styles.contextMenu}
                style={{
                    left: x,
                    top: y,
                }}
            >
                {items.map((item) => (
                    <div
                        key={item.id}
                        className={`${styles.contextMenuItem} ${item.subItems ? styles.hasSubMenu : ''}`}
                        onMouseEnter={(e) => {
                            if (item.subItems) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                // Assuming submenu is roughly 150px wide and 36px per item high
                                const showOnLeft = rect.right + 150 > window.innerWidth;
                                const estimatedHeight = item.subItems.length * 36;
                                const showUp = rect.top + estimatedHeight > window.innerHeight;
                                this.setState({ 
                                    hoveredItemId: item.id, 
                                    showSubMenuOnLeft: showOnLeft,
                                    showSubMenuUp: showUp
                                });
                            } else {
                                this.setState({ hoveredItemId: item.id });
                            }
                        }}
                        onMouseLeave={() => this.setState({ hoveredItemId: null })}
                        onClick={(e) => {
                            if (item.onClick) {
                                e.stopPropagation();
                                item.onClick();
                            }
                        }}
                    >
                        <div className={styles.menuItemContent}>
                            {item.icon && <span className={styles.menuIcon}>{item.icon}</span>}
                            <span>{item.label}</span>
                            {item.subItems && (
                                <ChevronRightIcon className={styles.chevron} size={16} />
                            )}
                        </div>
                        {item.subItems && hoveredItemId === item.id && (
                            <div className={`${styles.contextMenu} ${styles.subMenu} ${this.state.showSubMenuOnLeft ? styles.subMenuLeft : ''} ${this.state.showSubMenuUp ? styles.subMenuUp : ''}`}>
                                {item.subItems.map(subItem => (
                                    <div
                                        key={subItem.id}
                                        className={styles.contextMenuItem}
                                        onClick={(e) => {
                                            if (subItem.onClick) {
                                                e.stopPropagation();
                                                subItem.onClick();
                                            }
                                        }}
                                    >
                                        <div className={styles.menuItemContent}>
                                            {subItem.icon && <span className={styles.menuIcon}>{subItem.icon}</span>}
                                            <span>{subItem.label}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        );
    }
}
