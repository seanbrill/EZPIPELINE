import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Search, Book, Menu, X } from 'lucide-react';
import { documentationCategories, allDocSections } from '../../data/documentation';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import Fuse from 'fuse.js';

const DocsPage: React.FC = () => {
    const { sectionId } = useParams<{ sectionId?: string }>();
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState('');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    // Fuzzy search setup
    const fuse = useMemo(
        () =>
            new Fuse(allDocSections, {
                keys: ['title', 'content', 'searchKeywords'],
                threshold: 0.3,
                includeMatches: true
            }),
        []
    );

    // Get current section
    const currentSection = allDocSections.find(s => s.id === sectionId) || allDocSections[0];

    // Search results
    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        return fuse.search(searchQuery).map(result => result.item);
    }, [searchQuery, fuse]);

    // Handle section click
    const handleSectionClick = (id: string) => {
        navigate(`/docs/${id}`);
        setIsMobileMenuOpen(false);
    };

    return (
        <div className="h-full flex flex-col bg-[var(--color-bg)]">
            {/* Header */}
            <div className="flex-none border-b border-slate-700 bg-[var(--color-surface)] p-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <Book className="w-6 h-6 text-emerald-500" />
                        <h1 className="text-xl font-bold text-white">Documentation</h1>
                    </div>

                    {/* Mobile menu toggle */}
                    <button
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        className="md:hidden p-2 hover:bg-slate-800 rounded text-slate-400"
                    >
                        {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>

                    {/* Search */}
                    <div className="hidden md:flex flex-1 max-w-md relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search documentation..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 outline-none"
                        />
                    </div>
                </div>

                {/* Mobile search */}
                <div className="md:hidden mt-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search documentation..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 outline-none"
                        />
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <aside
                    className={`
            fixed md:relative inset-y-0 left-0 w-64 bg-slate-900 border-r border-slate-700
            transform transition-transform duration-200 ease-in-out z-50
            ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
            overflow-y-auto
          `}
                >
                    <div className="p-4 space-y-6">
                        {documentationCategories.map(category => (
                            <div key={category.id}>
                                <div className="flex items-center gap-2 mb-3">
                                    <category.icon className="w-4 h-4 text-emerald-500" />
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                        {category.title}
                                    </h3>
                                </div>
                                <div className="space-y-1">
                                    {category.sections.map(section => (
                                        <button
                                            key={section.id}
                                            onClick={() => handleSectionClick(section.id)}
                                            className={`
                        w-full text-left px-3 py-2 rounded text-sm transition-colors
                        ${section.id === currentSection.id
                                                    ? 'bg-emerald-500/20 text-emerald-400 font-medium'
                                                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                                }
                      `}
                                        >
                                            {section.title}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </aside>

                {/* Main content */}
                <main className="flex-1 overflow-y-auto">
                    {searchQuery && searchResults.length > 0 ? (
                        // Search results
                        <div className="p-6 max-w-4xl mx-auto">
                            <h2 className="text-lg font-semibold text-white mb-4">
                                Search Results ({searchResults.length})
                            </h2>
                            <div className="space-y-4">
                                {searchResults.map(section => (
                                    <button
                                        key={section.id}
                                        onClick={() => {
                                            handleSectionClick(section.id);
                                            setSearchQuery('');
                                        }}
                                        className="w-full text-left p-4 bg-slate-900/50 border border-slate-700 rounded-lg hover:border-emerald-500 transition-colors"
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <section.icon className="w-4 h-4 text-emerald-500" />
                                            <h3 className="font-semibold text-white">{section.title}</h3>
                                        </div>
                                        <p className="text-sm text-slate-400 line-clamp-2">
                                            {section.content.substring(0, 150)}...
                                        </p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : searchQuery ? (
                        // No results
                        <div className="p-6 max-w-4xl mx-auto text-center text-slate-500">
                            No results found for "{searchQuery}"
                        </div>
                    ) : (
                        // Documentation content
                        <div className="p-6 max-w-4xl mx-auto">
                            <div className="prose prose-invert prose-emerald max-w-none">
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        h1: ({ node, ...props }) => <h1 className="text-3xl font-bold text-white mb-6 pb-2 border-b border-slate-700" {...props} />,
                                        h2: ({ node, ...props }) => <h2 className="text-2xl font-bold text-emerald-400 mt-8 mb-4 flex items-center gap-2" {...props} />,
                                        h3: ({ node, ...props }) => <h3 className="text-xl font-semibold text-white mt-6 mb-3" {...props} />,
                                        p: ({ node, ...props }) => <p className="text-slate-300 leading-7 mb-4" {...props} />,
                                        ul: ({ node, ...props }) => <ul className="list-disc list-outside ml-6 mb-4 space-y-2 text-slate-300" {...props} />,
                                        ol: ({ node, ...props }) => <ol className="list-decimal list-outside ml-6 mb-4 space-y-2 text-slate-300" {...props} />,
                                        li: ({ node, ...props }) => <li className="pl-1" {...props} />,
                                        a: ({ node, ...props }) => <a className="text-emerald-400 hover:text-emerald-300 underline underline-offset-4" {...props} />,
                                        blockquote: ({ node, ...props }) => <blockquote className="border-l-4 border-emerald-500 pl-4 py-2 my-6 bg-slate-800/50 rounded-r italic text-slate-400" {...props} />,
                                        hr: ({ node, ...props }) => <hr className="my-8 border-slate-700" {...props} />,

                                        code({ className, children, ...props }: any) {
                                            const match = /language-(\w+)/.exec(className || '');
                                            const inline = !className;
                                            return !inline && match ? (
                                                <div className="my-6 rounded-lg overflow-hidden border border-slate-700 shadow-xl">
                                                    <div className="bg-slate-800 px-4 py-2 text-xs text-slate-400 font-mono border-b border-slate-700 flex items-center justify-between">
                                                        <span>{match[1].toUpperCase()}</span>
                                                    </div>
                                                    <SyntaxHighlighter
                                                        style={vscDarkPlus as any}
                                                        language={match[1]}
                                                        PreTag="div"
                                                        customStyle={{ margin: 0, padding: '1.5rem', background: '#0f172a' }}
                                                        {...props}
                                                    >
                                                        {String(children).replace(/\n$/, '')}
                                                    </SyntaxHighlighter>
                                                </div>
                                            ) : (
                                                <code className="bg-slate-800 text-emerald-300 px-1.5 py-0.5 rounded text-sm font-mono border border-slate-700" {...props}>
                                                    {children}
                                                </code>
                                            );
                                        }
                                    }}
                                >
                                    {currentSection.content}
                                </ReactMarkdown>
                            </div>

                            {/* Last updated */}
                            <div className="mt-8 pt-4 border-t border-slate-700 text-sm text-slate-500">
                                Last updated: {currentSection.lastUpdated}
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {/* Mobile overlay */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}
        </div>
    );
};

export default DocsPage;
