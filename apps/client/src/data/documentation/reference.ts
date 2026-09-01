import type { DocSection } from './index';
import { Settings, Terminal as TerminalIcon, Keyboard, FileText } from 'lucide-react';

export const referenceDocs: DocSection[] = [
    {
        id: 'configuration',
        title: 'Configuration Reference',
        category: 'reference',
        icon: Settings,
        searchKeywords: ['config', 'configuration', 'settings', 'options'],
        lastUpdated: '2026-01-11',
        content: `# Configuration Reference

Complete configuration options for EZPIPELINE.

## ezpipeline.config.json

\`\`\`json
{
  "ports": {
    "client": 5173,    // Vite dev server port
    "server": 5001     // Express server port
  },
  "paths": {
    "data": "apps/server/data",
    "logs": "apps/server/logs",
    "sandbox": "apps/server/ai_sandbox"
  }
}
\`\`\`

## Environment Variables

### Server (.env)

\`\`\`bash
# Server Configuration
NODE_ENV=development|production
PORT=5001

# Security
JWT_SECRET=your-secret-key-min-32-characters

# Database
DB_PATH=./data/app.db

# Logging
LOG_LEVEL=debug|info|warn|error
LOG_FILE=./logs/app.log

# Features
FEATURE_AI=true|false
FEATURE_TERMINAL=true|false
\`\`\`

### Pipeline (.env)

Per-pipeline environment variables:
\`\`\`bash
API_KEY=your-api-key
DATABASE_URL=postgresql://localhost/db
NODE_ENV=production
\`\`\`

## Database Schema

### users
- \`id\`: INTEGER PRIMARY KEY
- \`username\`: TEXT UNIQUE
- \`password_hash\`: TEXT
- \`is_admin\`: BOOLEAN
- \`can_manage_users\`: BOOLEAN
- \`created_at\`: DATETIME

### permissions
- \`id\`: INTEGER PRIMARY KEY
- \`user_id\`: INTEGER
- \`target\`: TEXT
- \`can_view\`: BOOLEAN
- \`can_run\`: BOOLEAN
- \`can_edit_yaml\`: BOOLEAN
- \`can_edit_env\`: BOOLEAN
- \`can_use_claude\`: BOOLEAN
- \`can_use_terminal\`: BOOLEAN

### builds
- \`id\`: TEXT PRIMARY KEY
- \`pipeline_name\`: TEXT
- \`status\`: TEXT
- \`started_at\`: DATETIME
- \`completed_at\`: DATETIME
- \`user_id\`: INTEGER
`
    },
    {
        id: 'cli-commands',
        title: 'CLI Commands',
        category: 'reference',
        icon: TerminalIcon,
        searchKeywords: ['cli', 'command', 'npm', 'scripts'],
        lastUpdated: '2026-01-11',
        content: `# CLI Commands Reference

Available npm scripts and commands.

## Development

\`\`\`bash
# Start dev servers (client + server)
npm start

# Start server only
npm run dev:server

# Start client only
npm run dev:client
\`\`\`

## Building

\`\`\`bash
# Build all workspaces
npm run build

# Build client only
npm run build:client

# Build server only
npm run build:server
\`\`\`

## Testing

\`\`\`bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
\`\`\`

## Database

\`\`\`bash
# Reset database (WARNING: deletes all data)
npm run reset

# Run migrations
npm run db:migrate
\`\`\`

## Deployment

\`\`\`bash
# Build Docker image
npm run package

# Start production server
npm run start
\`\`\`

## Utilities

\`\`\`bash
# Install dependencies
npm run init

# Clean build artifacts
npm run clean

# Lint code
npm run lint

# Format code
npm run format
\`\`\`
`
    },
    {
        id: 'keyboard-shortcuts',
        title: 'Keyboard Shortcuts',
        category: 'reference',
        icon: Keyboard,
        searchKeywords: ['keyboard', 'shortcuts', 'hotkeys', 'keys'],
        lastUpdated: '2026-01-11',
        content: `# Keyboard Shortcuts

Keyboard shortcuts for faster navigation.

## Global

- \`Ctrl+K\`: Open command palette (planned)
- \`Ctrl+/\`: Focus search (planned)
- \`Esc\`: Close modals

## Dashboard

- \`Space\`: Run selected pipeline (planned)
- \`R\`: Refresh build history (planned)
- \`N\`: New pipeline (planned)

## Terminal

- \`Enter\`: Execute command
- \`Ctrl+C\`: Interrupt process (planned)
- \`Ctrl+L\`: Clear terminal (planned)

## Logs Panel

- \`Ctrl+F\`: Focus log filter
- \`Ctrl+Shift+C\`: Clear logs

## Navigation

- \`Alt+1\`: Dashboard
- \`Alt+2\`: Settings (planned)
- \`Alt+3\`: Documentation (planned)

*Note: Some shortcuts are planned for future releases*
`
    },
    {
        id: 'changelog',
        title: 'Changelog',
        category: 'reference',
        icon: FileText,
        searchKeywords: ['changelog', 'version', 'history', 'updates', 'releases'],
        lastUpdated: '2026-01-11',
        content: `# Changelog

Version history and updates.

## v1.0.0 (2026-01-11)

### Added
- ✨ Documentation page with searchable content
- ✨ Terminal tab in logs panel
- ✨ Granular permission system
- ✨ Environment tag customization
- ✨ AI Assistant integration
- ✨ Real-time log streaming
- ✨ Pipeline versioning and rollback
- ✨ User management
- ✨ Dark theme support

### Changed
- 🎨 Improved mobile responsiveness
- 🎨 Enhanced UI/UX throughout
- ⚡ Performance optimizations

### Fixed
- 🐛 Progress bar alignment
- 🐛 Environment variable handling
- 🐛 WebSocket reconnection

## v0.9.0 (2026-01-08)

### Added
- ✨ Claude AI integration
- ✨ Scheduler service
- ✨ Plugin system

### Changed
- 🔒 Enhanced security model
- 📝 Improved documentation

## v0.8.0 (2026-01-05)

### Added
- ✨ Initial release
- ✨ Basic pipeline execution
- ✨ User authentication
- ✨ Build history

---

[View full changelog on GitHub](https://github.com/yourusername/EZPIPELINE/releases)
`
    }
];
