import React from 'react';
import classNames from 'classnames';
import { UiCheckbox, CheckboxVariant } from '../UiCheckbox';
import { UiButton, ButtonVariant, ButtonSize } from '../UiButton';
import { UiDropdown, DropdownVariant } from '../UiDropdown';
import { UiModal } from '../UiModal';
import { UiTextarea } from '../UiTextarea';
import { UiLabel } from '../UiLabel';
import { UiTarget } from '../UiTarget';
import { ConfirmationModal } from '../ConfirmationModal';
import { Toolbar } from './Toolbar';
import { apiAuth } from '../../utils/api';
import styles from './Resources.module.css';
import { UploadIcon, ResourceIcon, XIcon } from '../../icons';

const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const ThumbnailImage: React.FC<{ src: string; alt: string; className?: string }> = ({ src, alt, className }) => {
    const [loading, setLoading] = React.useState(true);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
            {loading && (
                <div style={{
                    position: 'absolute',
                    width: '18px',
                    height: '18px',
                    border: '2px solid var(--text-secondary, #64748b)',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                }} />
            )}
            <img
                src={src}
                alt={alt}
                className={className}
                onLoad={() => setLoading(false)}
                onError={() => setLoading(false)}
                style={loading ? { opacity: 0, position: 'absolute' } : {}}
            />
            {loading && (
                <style>{`
                    @keyframes spin { 100% { transform: rotate(360deg); } }
                `}</style>
            )}
        </div>
    );
};

interface ResourceMetadata {
    mimetype?: string;
    filename: string;
    description: string;
    createdAt: string;
    model: string;
    width?: number;
    height?: number;
    duration?: number;
    fontFamily?: string;
    isUsed?: boolean;
}

interface ResourcesProps {
    sessionId: string | null;
    version: number;
    active: boolean;
    onSelectResource?: (filename: string | null) => void;
    selectedResource?: string | null;
}

interface ResourcesState {
    resources: ResourceMetadata[];
    loading: boolean;
    showUnusedOnly: boolean;
    filterType: string;

    // Upload State
    isUploadModalOpen: boolean;
    filesToUpload: File[];
    uploadProgress: number; // 0-100, -1 if idle

    // Description Edit State
    editingImage: ResourceMetadata | null;
    editDescriptionValue: string;
    isSavingDescription: boolean;
    isGeneratingDescription: boolean;
    generationTimer: number;

    // Delete State
    isConfirmingDelete: boolean;
    isDeleting: boolean;
    generateDescriptionOnUpload: boolean;
}

export class Resources extends React.Component<ResourcesProps, ResourcesState> {
    componentWillUnmount() {
        window.removeEventListener('paste', this.handlePaste);
        window.removeEventListener('app:resource-description-updated', this.handleResourceDescriptionUpdated as EventListener);
    }

    constructor(props: ResourcesProps) {
        super(props);
        this.state = {
            resources: [],
            loading: false,
            showUnusedOnly: false,
            filterType: 'all',

            isUploadModalOpen: false,
            filesToUpload: [],
            uploadProgress: -1,

            editingImage: null,
            editDescriptionValue: '',
            isSavingDescription: false,
            isGeneratingDescription: false,
            generationTimer: 0,

            isConfirmingDelete: false,
            isDeleting: false,
            generateDescriptionOnUpload: false,
        };
        window.addEventListener('paste', this.handlePaste);
    }

    componentDidMount() {
        if (this.props.active) {
            this.fetchImages();
        }
        window.addEventListener('app:resource-description-updated', this.handleResourceDescriptionUpdated as EventListener);
    }

    handleResourceDescriptionUpdated = (e: CustomEvent) => {
        const { sessionId, version, filename, description } = e.detail;
        if (this.props.sessionId === sessionId && this.props.version === version) {
            this.setState(prev => ({
                resources: prev.resources.map(img => 
                    img.filename === filename ? { ...img, description } : img
                )
            }));
        }
    };

    componentDidUpdate(prevProps: ResourcesProps) {
        // If became active, fetch if empty
        if (!prevProps.active && this.props.active && this.state.resources.length === 0) {
            this.fetchImages();
        }

        // If version changed, refill
        if (prevProps.version !== this.props.version || prevProps.sessionId !== this.props.sessionId) {
            this.setState({ resources: [] }, () => {
                if (this.props.active) {
                    this.fetchImages();
                }
            });
        }
    }

    fetchImages = async () => {
        const { sessionId } = this.props;
        if (!sessionId) return;
        if (this.state.loading) return;

        this.setState({ loading: true });

        try {
            const res = await apiAuth.fetch(
                `/api/sessions/${sessionId}/${this.props.version}/resources`,
            );
            if (!res.ok) throw new Error('Failed to fetch images');
            const resources = await res.json();
            this.setState({ resources, loading: false });
        } catch (error) {
            console.error('Failed to load images', error);
            this.setState({ resources: [], loading: false });
        }
    };

    toggleShowUnusedOnly = (checked: boolean) => {
        this.setState({ showUnusedOnly: checked });
    };

    handleFilterTypeChange = (value: string) => {
        this.setState({ filterType: value });
    };

    // --- Upload Logic ---

    openUploadModal = () => {
        this.setState({ isUploadModalOpen: true, filesToUpload: [], generateDescriptionOnUpload: false });
    };

    closeUploadModal = () => {
        this.setState({ isUploadModalOpen: false, filesToUpload: [], generateDescriptionOnUpload: false });
    };

    handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (this.state.uploadProgress !== -1) return;
        if (e.target.files) {
            this.addFiles(Array.from(e.target.files));
        }
        e.target.value = '';
    };

    handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.state.uploadProgress !== -1) return;
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            this.addFiles(Array.from(e.dataTransfer.files));
        }
    };

    handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };

    addFiles = (newFiles: File[]) => {
        this.setState((prev) => {
            const existingNames = new Set(prev.filesToUpload.map(f => f.name));
            const uniqueNewFiles = newFiles.filter(f => !existingNames.has(f.name));
            if (uniqueNewFiles.length === 0) return null;
            return { filesToUpload: [...prev.filesToUpload, ...uniqueNewFiles] };
        });
    };

    removeFile = (index: number) => {
        if (this.state.uploadProgress !== -1) return;
        this.setState((prev) => ({
            filesToUpload: prev.filesToUpload.filter((_, i) => i !== index),
        }));
    };

    handlePaste = (e: ClipboardEvent) => {
        if (!this.state.isUploadModalOpen || this.state.uploadProgress !== -1) return;

        const items = e.clipboardData?.items;
        if (!items) return;

        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    files.push(file);
                }
            }
        }

        if (files.length > 0) {
            e.preventDefault();
            this.addFiles(files);
        }
    };

    handleUpload = async () => {
        const { filesToUpload } = this.state;
        const { sessionId, version } = this.props;

        if (filesToUpload.length === 0 || !sessionId) return;

        this.setState({ uploadProgress: 0 });

        let completed = 0;
        const total = filesToUpload.length;

        for (const file of filesToUpload) {
            const formData = new FormData();
            if (this.state.generateDescriptionOnUpload) {
                formData.append('generateDescription', 'true');
            }
            formData.append('file', file);
            try {
                await apiAuth.fetch(`/api/sessions/${sessionId}/${version}/resources`, {
                    method: 'POST',
                    body: formData,
                });
            } catch (error) {
                console.error('Error uploading', file.name, error);
            }
            completed++;
            this.setState({ uploadProgress: Math.round((completed / total) * 100) });
        }

        this.setState({ uploadProgress: -1, isUploadModalOpen: false, filesToUpload: [], generateDescriptionOnUpload: false });
        this.fetchImages();
    };

    // --- Edit Description Logic ---

    handleImageClick = (img: ResourceMetadata) => {
        this.setState({
            editingImage: img,
            editDescriptionValue: img.description || '',
        });
    };

    closeEditModal = () => {
        this.setState({
            editingImage: null,
            editDescriptionValue: '',
            isSavingDescription: false,
        });
    };

    handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        this.setState({ editDescriptionValue: e.target.value });
    };

    handleSaveDescription = async () => {
        const { editingImage, editDescriptionValue } = this.state;
        const { sessionId, version } = this.props;

        if (!editingImage || !sessionId) return;

        this.setState({ isSavingDescription: true });

        try {
            const res = await apiAuth.fetch(
                `/api/sessions/${sessionId}/${version}/resources/${editingImage.filename}/description`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: editDescriptionValue }),
                }
            );

            if (!res.ok) throw new Error('Failed to update description');

            this.setState(prev => ({
                resources: prev.resources.map(img =>
                    img.filename === editingImage.filename
                        ? { ...img, description: editDescriptionValue }
                        : img
                ),
                editingImage: null,
                isSavingDescription: false,
            }));

        } catch (error) {
            console.error('Error updating description', error);
            alert('Failed to save description');
            this.setState({ isSavingDescription: false });
        }
    };

    handleGenerateDescription = async () => {
        const { editingImage } = this.state;
        const { sessionId, version } = this.props;

        if (!editingImage || !sessionId) return;

        this.setState({ isGeneratingDescription: true, generationTimer: 0 });

        const timerInterval = setInterval(() => {
            this.setState(prev => ({ generationTimer: prev.generationTimer + 1 }));
        }, 1000);

        try {
            const res = await apiAuth.fetch(
                `/api/sessions/${sessionId}/${version}/resources/${editingImage.filename}/describe`,
                { method: 'GET' }
            );

            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'Failed to generate description');
            }

            const data = await res.json();
            if (data.description) {
                this.setState({ editDescriptionValue: data.description });
            }
        } catch (error) {
            console.error('Error generating description', error);
            alert(`Failed to generate description: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            clearInterval(timerInterval);
            this.setState({ isGeneratingDescription: false });
        }
    };

    // --- Delete Logic ---

    handleDeleteClick = () => {
        this.setState({ isConfirmingDelete: true });
    };

    handleDeleteCancel = () => {
        this.setState({ isConfirmingDelete: false });
    };

    handleDeleteConfirm = async () => {
        const { editingImage } = this.state;
        const { sessionId, version } = this.props;

        if (!editingImage || !sessionId) return;

        this.setState({ isDeleting: true });

        try {
            const res = await apiAuth.fetch(
                `/api/sessions/${sessionId}/${version}/resources/${editingImage.filename}`,
                {
                    method: 'DELETE',
                }
            );

            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'Failed to delete resource');
            }

            // Success
            this.setState((prev) => ({
                resources: prev.resources.filter((img) => img.filename !== editingImage.filename),
                editingImage: null,
                isDeleting: false,
                isConfirmingDelete: false,
            }));
        } catch (error) {
            console.error('Error deleting resource', error);
            alert(`Failed to delete resource: ${error instanceof Error ? error.message : String(error)}`);
            this.setState({ isDeleting: false, isConfirmingDelete: false });
        }
    };

    // --- Render ---

    renderUploadModal() {
        const { isUploadModalOpen, filesToUpload, uploadProgress } = this.state;
        const isUploading = uploadProgress !== -1;

        const actions = (
            <>
                <UiButton variant={ButtonVariant.SECONDARY} onClick={this.closeUploadModal} disabled={isUploading}>
                    Cancel
                </UiButton>
                <UiButton
                    variant={filesToUpload.length > 0 ? ButtonVariant.PRIMARY : ButtonVariant.SECONDARY}
                    disabled={filesToUpload.length === 0 || isUploading}
                    onClick={this.handleUpload}
                >
                    {isUploading ? `Uploading ${uploadProgress}%` : 'Upload'}
                </UiButton>
            </>
        );

        return (
            <UiModal
                isOpen={isUploadModalOpen}
                title="Upload Resources"
                onClose={() => !isUploading && this.closeUploadModal()}
                actions={actions}
            >
                <div>
                    <div
                        className={classNames(styles.uploadDropZone, {
                            [styles.disabled]: isUploading
                        })}
                        onDrop={this.handleDrop}
                        onDragOver={this.handleDragOver}
                        onClick={() => !isUploading && document.getElementById('image-upload-input')?.click()}
                        style={isUploading ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                    >
                        <p>{isUploading ? 'Uploading files...' : 'Drag & drop files here, paste from clipboard, or click to select'}</p>
                        <input
                            type="file"
                            id="image-upload-input"
                            multiple
                            accept="image/png, image/jpeg, image/gif, image/webp, image/avif, image/svg+xml, .svg, .avif, video/mp4, video/webm, font/woff, font/woff2, font/ttf, .ttf, .woff, .woff2"
                            style={{ display: 'none' }}
                            onChange={this.handleFileSelect}
                            disabled={isUploading}
                        />
                    </div>
                    <div className={styles.uploadOptions} style={{ marginTop: '0.5rem' }}>
                        <UiCheckbox
                            checked={this.state.generateDescriptionOnUpload}
                            onChange={(checked) => this.setState({ generateDescriptionOnUpload: checked })}
                            label="Generate description"
                            variant={CheckboxVariant.DANGER}
                        />
                    </div>
                    {filesToUpload.length > 0 && (
                        <div className={styles.uploadFileList}>
                            {filesToUpload.map((file, index) => (
                                <UiTarget
                                    key={`${file.name}-${index}`}
                                    onRemove={() => this.removeFile(index)}
                                    removeTitle="Remove resource"
                                    disabled={isUploading}
                                >
                                    <div className={styles.uploadFileItem}>
                                        {file.type.startsWith('video/') ? (
                                            <video
                                                src={URL.createObjectURL(file)}
                                                className={styles.uploadFilePreview}
                                                onLoadedData={(e) => URL.revokeObjectURL((e.target as HTMLVideoElement).src)}
                                            />
                                        ) : file.type.startsWith('image/') ? (
                                            <img
                                                src={URL.createObjectURL(file)}
                                                alt={file.name}
                                                className={styles.uploadFilePreview}
                                                onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                                            />
                                        ) : (
                                            <div className={styles.uploadFilePreview} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e2e8f0', fontSize: '12px' }}>
                                                {file.name.split('.').pop()?.toUpperCase()}
                                            </div>
                                        )}
                                        <span>{file.name}</span>
                                    </div>
                                </UiTarget>
                            ))}
                        </div>
                    )}
                </div>
            </UiModal>
        );
    }

    renderEditModal() {
        const { editingImage, editDescriptionValue, isSavingDescription, isGeneratingDescription, generationTimer } = this.state;
        const { sessionId, version } = this.props;

        if (!editingImage) return null;

        const isBusy = isSavingDescription || isGeneratingDescription;

        const actions = (
            <>
                {!editingImage.isUsed && (
                    <div style={{ marginRight: 'auto' }}>
                        <UiButton
                            variant={ButtonVariant.DANGER} // Assuming danger variant exists or will fallback
                            onClick={this.handleDeleteClick}
                            disabled={isBusy}
                            className={styles.deleteButton}
                        >
                            Delete
                        </UiButton>
                    </div>
                )}
                <UiButton variant={ButtonVariant.SECONDARY} onClick={this.closeEditModal} disabled={isBusy}>
                    Cancel
                </UiButton>
                <UiButton variant={ButtonVariant.PRIMARY} onClick={this.handleSaveDescription} disabled={isBusy}>
                    {isSavingDescription ? 'Saving...' : 'Save'}
                </UiButton>
            </>
        );

        return (
            <UiModal
                isOpen={!!editingImage}
                title={editingImage.filename}
                onClose={() => !isBusy && this.closeEditModal()}
                actions={actions}
                style={{ maxWidth: '600px' }}
            >
                <div className={styles.editModalContent}>
                    <div className={styles.editImageContainer}>
                        {editingImage.mimetype?.startsWith('video/') ? (
                            <video
                                src={`${import.meta.env.BASE_URL}api/sessions/${sessionId}/${version}/files/${editingImage.filename}`}
                                className={styles.editImagePreview}
                                controls
                            />
                        ) : editingImage.mimetype?.startsWith('image/') || !editingImage.mimetype ? (
                            <img
                                src={`${import.meta.env.BASE_URL}api/sessions/${sessionId}/${version}/files/${editingImage.filename}`}
                                alt={editingImage.filename}
                                className={styles.editImagePreview}
                            />
                        ) : (
                            <ThumbnailImage
                                src={`${import.meta.env.BASE_URL}api/sessions/${sessionId}/${version}/resources/${editingImage.filename}/thumbnail`}
                                alt={editingImage.filename}
                                className={styles.editImagePreview}
                            />
                        )}
                    </div>
                    <div className={styles.editFormGroup}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <UiLabel style={{ marginBottom: 0 }}>
                                Description
                            </UiLabel>
                            {isGeneratingDescription ? (
                                <span style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                                    Generating... ({generationTimer}s)
                                </span>
                            ) : (
                                <UiButton
                                    variant={ButtonVariant.SECONDARY}
                                    size={ButtonSize.SMALL}
                                    onClick={this.handleGenerateDescription}
                                    disabled={isBusy}
                                >
                                    Generate description
                                </UiButton>
                            )}
                        </div>
                        <UiTextarea
                            value={editDescriptionValue}
                            onChange={this.handleDescriptionChange}
                            placeholder="Enter image description..."
                            disabled={isBusy}
                            style={{ minHeight: '120px' }}
                        />
                    </div>
                </div>
            </UiModal>
        );
    }

    render() {
        const { sessionId, version, active } = this.props;
        const { loading, resources, showUnusedOnly, filterType } = this.state;

        const visibleImages = resources.filter(img => {
            if (showUnusedOnly && img.isUsed) return false;
            if (filterType !== 'all') {
                if (filterType === 'images' && img.mimetype && !img.mimetype.startsWith('image/')) return false;
                if (filterType === 'videos' && (!img.mimetype || !img.mimetype.startsWith('video/'))) return false;
                if (filterType === 'fonts' && (!img.mimetype || !img.mimetype.startsWith('font/'))) return false;
            }
            return true;
        });

        const filterOptions = [
            { value: 'all', label: 'All Types' },
            { value: 'images', label: 'Images' },
            { value: 'videos', label: 'Videos' },
            { value: 'fonts', label: 'Fonts' }
        ];

        return (
            <div className={styles.previewContainer} style={{ display: active ? 'flex' : 'none' }}>
                <Toolbar
                    left={
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <UiCheckbox
                                checked={showUnusedOnly}
                                onChange={this.toggleShowUnusedOnly}
                                label="Unused only"
                            />
                            <UiDropdown
                                value={filterType}
                                options={filterOptions}
                                onChange={this.handleFilterTypeChange}
                                variant={DropdownVariant.STANDARD}
                            />
                        </div>
                    }
                    right={
                        <UiButton
                            variant={ButtonVariant.SECONDARY}
                            size={ButtonSize.ICON}
                            onClick={this.openUploadModal}
                            title="Upload resources"
                        >
                            <UploadIcon size={14} />
                        </UiButton>
                    }
                />
                <div className={styles.imagesPanel}>
                    {loading ? (
                        <div className={styles.loading}>Loading resources...</div>
                    ) : visibleImages.length === 0 ? (
                        <div className={styles.noImages}>
                            No resources found for this version
                        </div>
                    ) : (
                        <div className={styles.imageGrid}>
                            {visibleImages.map((img) => (
                                <div
                                    key={img.filename}
                                    className={classNames(styles.imageTile, {
                                        [styles.imageTileSelected]: this.props.selectedResource === img.filename
                                    })}
                                    onClick={() => this.handleImageClick(img)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    {this.props.onSelectResource && (
                                        <button
                                            className={styles.resourceActionBtn}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (this.props.selectedResource === img.filename) {
                                                    this.props.onSelectResource!(null);
                                                } else {
                                                    this.props.onSelectResource!(img.filename);
                                                }
                                            }}
                                            title={this.props.selectedResource === img.filename ? "Cancel selection" : "Select resource"}
                                        >
                                            {this.props.selectedResource === img.filename ? <XIcon size={16} /> : <ResourceIcon size={16} />}
                                        </button>
                                    )}
                                    <div className={styles.imageThumbContainer}>
                                        {img.mimetype?.startsWith('image/') || !img.mimetype ? (
                                            <img
                                                src={`${import.meta.env.BASE_URL}api/sessions/${sessionId}/${version}/files/${img.filename}`}
                                                alt={img.description}
                                                className={styles.imageThumb}
                                            />
                                        ) : (
                                            <ThumbnailImage
                                                src={`${import.meta.env.BASE_URL}api/sessions/${sessionId}/${version}/resources/${img.filename}/thumbnail`}
                                                alt={img.description}
                                                className={styles.imageThumb}
                                            />
                                        )}
                                    </div>
                                    <div className={styles.imageDesc}>
                                        <div className={styles.imageMeta}>
                                            {img.fontFamily ? (
                                                <span className={styles.resolutionBadge}>
                                                    {img.fontFamily}
                                                </span>
                                            ) : (img.width && img.height) || img.duration ? (
                                                <span className={styles.resolutionBadge}>
                                                    {img.width && img.height ? `${img.width}x${img.height}` : ''}
                                                    {img.width && img.height && img.duration ? ' • ' : ''}
                                                    {img.duration ? formatDuration(img.duration) : ''}
                                                </span>
                                            ) : null}
                                            {img.isUsed !== undefined && (
                                                <span
                                                    className={classNames(styles.usageBadge, {
                                                        [styles.usageBadgeUsed]: img.isUsed,
                                                        [styles.usageBadgeUnused]: !img.isUsed,
                                                    })}
                                                >
                                                    {img.isUsed ? 'Used' : 'Unused'}
                                                </span>
                                            )}
                                            {(!img.description || img.description.trim() === '') && (
                                                <span className={styles.badgeNoDescription}>
                                                    No description
                                                </span>
                                            )}
                                        </div>
                                        <div className={styles.imageDescText}>
                                            {img.description}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                {this.renderUploadModal()}
                {this.renderEditModal()}

                <ConfirmationModal
                    isOpen={this.state.isConfirmingDelete}
                    title="Delete Resource"
                    message="Are you sure you want to delete this resource? This action cannot be undone."
                    onConfirm={this.handleDeleteConfirm}
                    onCancel={this.handleDeleteCancel}
                />
            </div>
        );
    }
}
