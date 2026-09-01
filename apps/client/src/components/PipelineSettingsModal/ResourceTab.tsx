import React, { useState, useEffect } from 'react';
import { RefreshCw, Upload, Loader2, File, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
import API_URL from '../../config/api';

interface ResourceTabProps {
    pipelinePath?: string;
}

interface ResourceFile {
    name: string;
    path: string;
    size: number;
    type: string;
}

const ResourceTab: React.FC<ResourceTabProps> = ({ pipelinePath }) => {
    const { token } = useAuth();
    const { confirm } = useConfirm();

    const [files, setFiles] = useState<ResourceFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const currentDir = pipelinePath ? (() => {
        let cleanPath = pipelinePath;
        // Strip backend absolute path prefix to work with relative paths on server
        if (cleanPath.includes('/data/pipelines/')) {
            cleanPath = cleanPath.split('/data/pipelines/')[1];
        } else if (cleanPath.includes('\\data\\pipelines\\')) {
            cleanPath = cleanPath.split('\\data\\pipelines\\')[1];
        }

        // cleanPath is now e.g. "Test/pipeline.yaml" or "pipeline.yaml"
        const lastSlash = cleanPath.lastIndexOf('/');
        if (lastSlash !== -1) {
            return `${cleanPath.substring(0, lastSlash)}/resources`;
        }
        // If no slash, it's at root (e.g. pipeline.yaml)
        return 'resources';
    })() : '';

    const fetchFiles = async () => {
        if (!currentDir) return;
        setLoading(true);
        setError(null);
        try {
            // Fetch resources in the current directory
            const res = await fetch(`${API_URL}/api/config/resources?path=${encodeURIComponent(currentDir)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            setFiles(data.files || []);
        } catch (e: any) {
            console.error(e);
            setError("Failed to fetch resources");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchFiles();
    }, [currentDir]);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentDir) return;

        setUploading(true);
        setError(null);

        const formData = new FormData();
        formData.append('path', currentDir);
        formData.append('file', file);

        try {
            const res = await fetch(`${API_URL}/api/config/upload`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }, // Fetch handles multipart boundary
                body: formData
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Upload failed');
            }

            fetchFiles();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setUploading(false);
            if (e.target) e.target.value = '';
        }
    };

    const handleDelete = async (file: ResourceFile) => {
        if (!await confirm({
            title: `Delete ${file.name}?`,
            message: `Are you sure you want to delete this resource?`,
            confirmText: "Delete",
            isDangerous: true
        })) return;

        try {
            const res = await fetch(`${API_URL}/api/config/resources`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    type: 'yaml',
                    path: file.path
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Delete failed');
            }
            fetchFiles();
        } catch (e: any) {
            setError(e.message);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    return (
        <div className="space-y-4 h-full flex flex-col">
            <div className="flex justify-between items-center">
                <h3 className="font-bold text-lg text-white">Resources</h3>
                <div className="flex gap-2">
                    <button onClick={fetchFiles} className="p-2 text-slate-400 hover:text-white rounded hover:bg-slate-700 transition-colors">
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <label className={`
                        flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs cursor-pointer transition-colors
                        ${uploading ? 'opacity-50 cursor-not-allowed' : ''}
                    `}>
                        {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                        Upload File
                        <input
                            type="file"
                            className="hidden"
                            onChange={handleUpload}
                            disabled={uploading}
                        />
                    </label>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
                    {error}
                </div>
            )}

            <div className="flex-1 bg-black/20 border border-slate-700 rounded-lg overflow-hidden flex flex-col">
                <div className="grid grid-cols-12 gap-4 p-2 border-b border-slate-700 bg-slate-900/50 text-xs font-bold theme-text-muted uppercase tracking-wider">
                    <div className="col-span-6">Name</div>
                    <div className="col-span-3 text-right">Size</div>
                    <div className="col-span-3 text-right">Actions</div>
                </div>

                <div className="overflow-y-auto flex-1 p-2 space-y-1 custom-scrollbar">
                    {files.length === 0 && !loading && (
                        <div className="text-center theme-text-muted py-8 text-sm">
                            No resources found in this folder.
                        </div>
                    )}

                    {files.map((file) => (
                        <div key={file.path} className="grid grid-cols-12 gap-4 items-center p-2 hover:bg-slate-800/50 rounded-lg transition-colors group">
                            <div className="col-span-6 flex items-center gap-3 overflow-hidden">
                                <File className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                                <span className="text-sm theme-text truncate">{file.name}</span>
                            </div>
                            <div className="col-span-3 text-right text-xs theme-text-muted font-mono">
                                {formatSize(file.size)}
                            </div>
                            <div className="col-span-3 flex justify-end">
                                <button
                                    onClick={() => handleDelete(file)}
                                    className="p-1.5 theme-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                                    title="Delete"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <p className="text-xs theme-text-muted">
                Files uploaded here are stored in: <span className="font-mono theme-text">{currentDir || '(root)'}</span>
            </p>
        </div>
    );
};

export default ResourceTab;
