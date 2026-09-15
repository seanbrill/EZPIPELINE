import React, { useState, useMemo, useEffect } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Trash2, FolderPlus, Edit2, Box, Search, Settings } from 'lucide-react';
import { usePreferences } from '../../contexts/PreferencesContext';
import { TAG_COLORS } from '../../constants/tagColors';
import { EnvTag } from '../Shared/EnvTag';
import { readJSON, writeJSON } from '../../helpers/persistedState';

/** Which folders were open, per browser. A view preference, not data. */
const EXPANDED_KEY = 'ezpipeline.sidebar.expanded';

interface FileTreeNode {
    name: string;
    path: string;
    type: 'directory' | 'file' | 'pipeline';
    children?: FileTreeNode[];
    environment?: string;
}

interface FileTreeSidebarProps {
    fileTree: FileTreeNode[];
    selectedGroup: string;
    onSelectGroup: (group: string) => void;
    onSelectPipeline: (path: string) => void;
    /** Open the settings editor for a pipeline, from the tree. */
    onOpenPipeline?: (path: string) => void;
    onCreateGroup: (parent?: string) => void;
    onDeleteGroup: (group: string) => void;
    onRenameGroup: (group: string) => void;
    onDropPipeline: (e: React.DragEvent, group: string) => void;
    onMovePipeline: (sourcePath: string, targetFolder: string) => void;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    className?: string;
}

const FileTreeSidebar: React.FC<FileTreeSidebarProps> = ({
    fileTree,
    selectedGroup,
    onSelectGroup,
    onSelectPipeline,
    onOpenPipeline,
    onCreateGroup,
    onDeleteGroup,
    onRenameGroup,
    onDropPipeline,
    onMovePipeline,
    collapsed = false,
    onToggleCollapse,
    className
}) => {
    const { envTagColors, envTagLabels } = usePreferences();
    // The tree used to collapse on every refresh, so checking on a build meant
    // re-opening the same two folders each time. A Set does not survive JSON,
    // so it is stored as an array and rebuilt here.
    const [expanded, setExpanded] = useState<Set<string>>(
        () => new Set(readJSON<string[]>(EXPANDED_KEY, []))
    );
    const [searchQuery, setSearchQuery] = useState('');
    const [filterEnv, setFilterEnv] = useState<string>('all');

    useEffect(() => {
        writeJSON(EXPANDED_KEY, Array.from(expanded));
    }, [expanded]);

    // FORGET FOLDERS THAT ARE GONE, so the store does not grow for the life of
    // the browser as groups are renamed. A stale entry is harmless on its own -
    // nothing renders a path that is not in the tree - which is exactly why it
    // would otherwise never be noticed or cleaned up.
    //
    // Only when the tree has actually arrived. Pruning against the empty array
    // of the first render would wipe the very state just restored, which is
    // the bug this whole change exists to fix.
    useEffect(() => {
        if (fileTree.length === 0) return;
        const live = new Set<string>();
        const walk = (nodes: FileTreeNode[]) => nodes.forEach(n => {
            live.add(n.path);
            if (n.children) walk(n.children);
        });
        walk(fileTree);
        setExpanded(previous => {
            const kept = Array.from(previous).filter(p => live.has(p));
            return kept.length === previous.size ? previous : new Set(kept);
        });
    }, [fileTree]);

    // Get all unique environments derived from preferences or existing nodes
    const environmentOptions = useMemo(() => {
        const envMap = new Map<string, Set<string>>(); // Label -> Set<keys>

        // Helper to get label
        const getLabel = (key: string) => envTagLabels?.[key] || key;

        // Scan preferences
        Object.keys(envTagColors).forEach(key => {
            const label = getLabel(key);
            if (!envMap.has(label)) envMap.set(label, new Set());
            envMap.get(label)?.add(key.toLowerCase());
        });

        // Convert to array options
        return Array.from(envMap.entries()).map(([label, keys]) => ({
            label,
            value: label, // We filter by Label now
            keys: Array.from(keys)
        })).sort((a, b) => a.label.localeCompare(b.label));
    }, [envTagColors, envTagLabels]);

    const toggleExpand = (path: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newExpanded = new Set(expanded);
        if (newExpanded.has(path)) {
            newExpanded.delete(path);
        } else {
            newExpanded.add(path);
        }
        setExpanded(newExpanded);
    };

    // Recursive filter function
    const filterNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
        return nodes.reduce((acc: FileTreeNode[], node) => {
            const matchesSearch = node.name.toLowerCase().includes(searchQuery.toLowerCase());

            // For directories, always check children first
            if (node.type === 'directory') {
                const filteredChildren = node.children ? filterNodes(node.children) : [];

                if (filteredChildren.length > 0 || (matchesSearch && filterEnv === 'all')) {
                    acc.push({ ...node, children: filteredChildren });
                }
            } else if (node.type === 'pipeline') {
                // Check Environment filter
                const nodeEnv = (node.environment || '').toLowerCase();

                let matchesEnv = false;
                if (filterEnv === 'all') {
                    matchesEnv = true;
                } else if (!nodeEnv) {
                    matchesEnv = false;
                } else {
                    // Find the option corresponding to current filterEnv (which is a label)
                    const option = environmentOptions.find(opt => opt.value === filterEnv);
                    if (option) {
                        // Check if nodeEnv matches any of the keys for this label (substring match)
                        // e.g. 'Development' contains 'dev', so it matches
                        matchesEnv = option.keys.some(key => nodeEnv.includes(key));
                    } else {
                        // Fallback?
                        matchesEnv = false;
                    }
                }

                if (matchesSearch && matchesEnv) {
                    acc.push(node);
                }
            }
            return acc;
        }, []);
    };

    const filteredTree = useMemo(() => {
        if (!searchQuery && filterEnv === 'all') return fileTree;
        return filterNodes(fileTree);
    }, [fileTree, searchQuery, filterEnv, environmentOptions]);


    const renderNode = (node: FileTreeNode, depth: number) => {
        const isDirectory = node.type === 'directory';
        const isPipeline = node.type === 'pipeline';

        // Skip files that are not pipelines
        if (node.type === 'file') return null;

        const hasChildren = isDirectory && node.children && node.children.length > 0;
        // Auto-expand if searching/filtering and node has visible children logic could be here
        // forcing expanded state if filtered would require controlled expansion mapping updates

        const isSelected = selectedGroup === node.path;
        const isExpanded = expanded.has(node.path) || (searchQuery.length > 0 && hasChildren); // Auto-expand on search

        return (
            <div key={node.path}>
                <div
                    className={`
                        group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer transition-colors mb-0.5
                        ${isSelected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-[var(--color-text)] hover:bg-[var(--color-text-muted)]/10 border border-transparent'}
                    `}
                    style={{ paddingLeft: `${depth * 12 + 8}px` }}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (isDirectory) onSelectGroup(node.path);
                        if (isPipeline) onSelectPipeline(node.path);
                    }}
                    draggable={isPipeline}
                    onDragStart={(e) => {
                        if (isPipeline) {
                            e.dataTransfer.setData('pipeline-node', JSON.stringify({
                                path: node.path,
                                name: node.name,
                                type: 'pipeline'
                            }));
                            e.dataTransfer.effectAllowed = 'move';
                        }
                    }}
                    onDragOver={(e) => {
                        if (!isDirectory) return;
                        e.preventDefault();
                        e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)';
                    }}
                    onDragLeave={(e) => {
                        if (!isDirectory) return;
                        e.currentTarget.style.background = '';
                    }}
                    onDrop={(e) => {
                        if (!isDirectory) return;
                        e.currentTarget.style.background = '';

                        // Check if dropping a pipeline node from sidebar
                        const pipelineNodeData = e.dataTransfer.getData('pipeline-node');
                        if (pipelineNodeData) {
                            const data = JSON.parse(pipelineNodeData);
                            onMovePipeline(data.path, node.path);
                            return;
                        }

                        // Otherwise handle pipeline object from main view
                        onDropPipeline(e, node.path);
                    }}
                >
                    <div className="flex items-center gap-2 truncate">
                        {hasChildren ? (
                            <button onClick={(e) => toggleExpand(node.path, e)} className="hover:text-white">
                                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            </button>
                        ) : (
                            <span className="w-3 h-3" /> // Spacer
                        )}

                        {isPipeline || (isDirectory && node.environment) ? (
                            <div className="relative">
                                {(() => {
                                    const tag = (node.environment || '').toLowerCase();
                                    const colorName = envTagColors[tag];
                                    const style = (colorName && TAG_COLORS[colorName]) ? TAG_COLORS[colorName] : TAG_COLORS['emerald'];

                                    return <Box className={`w-4 h-4 ${style.text}`} />;
                                })()}
                            </div>
                        ) : (
                            (isSelected || isExpanded) ? <FolderOpen className="w-4 h-4 text-emerald-500" /> : <Folder className="w-4 h-4" />
                        )}

                        <span className="text-sm font-medium truncate">{node.name}</span>

                        {/* One definition, shared with the Quick Run picker and the
                            build cards - see components/Shared/EnvTag. */}
                        <EnvTag environment={node.environment} className="ml-1" />
                    </div>

                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isDirectory && (
                            <>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onCreateGroup(node.path); }}
                                    className="p-1 hover:text-emerald-400 transition-colors"
                                    title="New Subfolder"
                                >
                                    <FolderPlus className="w-3 h-3" />
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onRenameGroup(node.path); }}
                                    className="p-1 hover:text-blue-400 transition-colors"
                                    title="Rename Folder"
                                >
                                    <Edit2 className="w-3 h-3" />
                                </button>
                            </>
                        )}
                        {isPipeline && onOpenPipeline && (
                            // Straight to the editor from the tree. Clicking the row
                            // itself arms the pipeline for Quick Run rather than opening
                            // this, which is the common intent - but "edit it" should not
                            // then require going via a build that may not exist.
                            <button
                                onClick={(e) => { e.stopPropagation(); onOpenPipeline(node.path); }}
                                className="p-1 hover:text-emerald-400 transition-colors"
                                title="Pipeline settings"
                            >
                                <Settings className="w-3 h-3" />
                            </button>
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); onDeleteGroup(node.path); }}
                            className="p-1 hover:text-red-400 transition-colors"
                            title="Delete"
                        >
                            <Trash2 className="w-3 h-3" />
                        </button>
                    </div>
                </div>

                {isExpanded && isDirectory && node.children && (
                    <div>
                        {node.children
                            .sort((a, b) => {
                                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                                return a.name.localeCompare(b.name);
                            })
                            .map(child => renderNode(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={`flex flex-col h-full bg-[var(--color-surface)] ${className}`}>
            {/* Header Area */}
            {!collapsed && (
                <div className="flex flex-col px-4 pt-4 pb-2 mb-0">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 cursor-pointer group" onClick={onToggleCollapse}>
                            <span className="font-bold text-[var(--color-text)] uppercase tracking-wider text-sm">Pipelines</span>
                            <ChevronRight className="w-5 h-5 text-emerald-500 rotate-180 transition-transform group-hover:-translate-x-1" />
                        </div>
                    </div>

                    <button
                        onClick={(e) => { e.stopPropagation(); onCreateGroup(); }}
                        className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-text-muted)]/10 rounded transition-colors -ml-2 mb-2"
                        title="Create New Folder"
                    >
                        <FolderPlus className="w-4 h-4" />
                        <span>New Folder</span>
                    </button>

                    {/* Filter Controls - Always Visible */}
                    <div className="animate-in fade-in slide-in-from-top-2 duration-200 space-y-2">
                        <div className="relative">
                            <Search className="w-3 h-3 absolute left-2 top-2 text-slate-500" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search pipelines..."
                                className="w-full bg-slate-900/50 border border-slate-700/50 rounded pl-7 pr-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/50 placeholder:text-slate-600"
                            />
                        </div>
                        <select
                            value={filterEnv}
                            onChange={(e) => setFilterEnv(e.target.value)}
                            className="w-full bg-slate-900/50 border border-slate-700/50 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/50"
                        >
                            <option value="all">All Environments</option>
                            {environmentOptions.map(opt => (
                                <option key={opt.label} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {!collapsed && (
                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar bg-[var(--color-bg)] m-2 mt-0 rounded-lg shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)]">
                    {(() => {
                        const sorted = filteredTree.sort((a, b) => {
                            // Sort logic: directories first, then pipelines
                            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                            return a.name.localeCompare(b.name);
                        });

                        const finalNodes: FileTreeNode[] = [];
                        sorted.forEach(node => {
                            if (node.name === 'General' && node.type === 'directory') {
                                if (node.children) {
                                    finalNodes.push(...node.children);
                                }
                            } else {
                                finalNodes.push(node);
                            }
                        });

                        finalNodes.sort((a, b) => {
                            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                            return a.name.localeCompare(b.name);
                        });

                        return finalNodes.length > 0 ? (
                            finalNodes.map(node => renderNode(node, 0))
                        ) : (
                            <div className="p-4 text-center text-xs text-slate-500 italic">No matches found</div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
};

export default FileTreeSidebar;
