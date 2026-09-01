import type { LucideIcon } from 'lucide-react';
import { BookOpen, Layers, Code, BookMarked, FileText } from 'lucide-react';

export interface DocSection {
    id: string;
    title: string;
    category: 'getting-started' | 'architecture' | 'api' | 'guides' | 'reference';
    icon: LucideIcon;
    content: string; // Markdown content
    searchKeywords: string[];
    lastUpdated: string;
}

export interface DocCategory {
    id: string;
    title: string;
    icon: LucideIcon;
    description: string;
    sections: DocSection[];
}

// Import documentation content
import { gettingStartedDocs } from './getting-started';
import { architectureDocs } from './architecture';
import { apiReferenceDocs } from './api-reference';
import { guidesDocs } from './guides';
import { referenceDocs } from './reference';

export const documentationCategories: DocCategory[] = [
    {
        id: 'getting-started',
        title: 'Getting Started',
        icon: BookOpen,
        description: 'Quick start guides and basic concepts',
        sections: gettingStartedDocs
    },
    {
        id: 'architecture',
        title: 'Architecture',
        icon: Layers,
        description: 'System design and data flow',
        sections: architectureDocs
    },
    {
        id: 'api',
        title: 'API Reference',
        icon: Code,
        description: 'REST endpoints and WebSocket events',
        sections: apiReferenceDocs
    },
    {
        id: 'guides',
        title: 'Guides',
        icon: BookMarked,
        description: 'Step-by-step tutorials and how-tos',
        sections: guidesDocs
    },
    {
        id: 'reference',
        title: 'Reference',
        icon: FileText,
        description: 'Configuration and CLI reference',
        sections: referenceDocs
    }
];

// Flatten all sections for search
export const allDocSections: DocSection[] = documentationCategories.flatMap(
    category => category.sections
);
