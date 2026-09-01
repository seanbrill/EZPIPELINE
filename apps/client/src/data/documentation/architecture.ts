import type { DocSection } from './index';
import { Layers, Database, Lock, Zap } from 'lucide-react';

export const architectureDocs: DocSection[] = [
   {
      id: 'overview',
      title: 'System Overview',
      category: 'architecture',
      icon: Layers,
      searchKeywords: ['architecture', 'system', 'overview', 'structure', 'design'],
      lastUpdated: '2026-01-11',
      content: `# System Overview

EZPIPELINE follows a monorepo architecture with clear separation between frontend and backend.

## Technology Stack

**Frontend**:
- React 19 with TypeScript
- Vite 7 for build tooling
- TailwindCSS 4 for styling
- React Router 7 for navigation
- Socket.IO Client for real-time updates

**Backend**:
- Node.js 18+ with Express 5
- SQLite with better-sqlite3
- Socket.IO for WebSockets
- JWT authentication
- bcrypt for password hashing

## Project Structure

\`\`\`
EZPIPELINE/
├── apps/
│   ├── client/          # React frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── contexts/
│   │   │   └── utils/
│   │   └── package.json
│   └── server/          # Node.js backend
│       ├── src/
│       │   ├── controllers/
│       │   ├── routes/
│       │   ├── services/
│       │   └── middleware/
│       └── package.json
├── docs/                # Documentation
├── scripts/             # Utility scripts
└── package.json         # Monorepo root
\`\`\`

## Architecture Diagram

\`\`\`
┌─────────────────────────────────────┐
│         Client (React)              │
│  Dashboard | Settings | Pipelines   │
└──────────────┬──────────────────────┘
               │ HTTP/WebSocket
               ▼
┌─────────────────────────────────────┐
│       Server (Node.js)              │
│  ┌────────┐  ┌────────┐  ┌────────┐│
│  │ Routes │→ │Services│→ │Database││
│  └────────┘  └────────┘  └────────┘│
└─────────────────────────────────────┘
\`\`\`

## Key Components

1. **Client**: React SPA with real-time updates
2. **Server**: Express API with WebSocket support
3. **Database**: SQLite for persistence
4. **Services**: Business logic layer
5. **Controllers**: Pipeline execution engine
`
   },
   {
      id: 'data-flow',
      title: 'Data Flow',
      category: 'architecture',
      icon: Database,
      searchKeywords: ['data', 'flow', 'pipeline', 'execution', 'process'],
      lastUpdated: '2026-01-11',
      content: `# Data Flow

Understanding how data flows through EZPIPELINE.

## Pipeline Execution Flow

\`\`\`
1. User clicks "Run Pipeline"
   ↓
2. Client → POST /api/run-pipeline
   ↓
3. Server validates permissions
   ↓
4. Create build record in database
   ↓
5. Emit 'build:start' via WebSocket
   ↓
6. Execute pipeline steps sequentially
   ↓
7. Stream logs via WebSocket
   ↓
8. Create version archive (Docker/Zip)
   ↓
9. Emit 'build:complete' via WebSocket
\`\`\`

## Real-Time Communication

**WebSocket Events**:
- \`build:start\` - Build initiated
- \`build:log\` - Log message
- \`build:progress\` - Step progress
- \`build:complete\` - Build finished
- \`build:error\` - Build failed

## State Management

**Client State**:
- React hooks (useState, useEffect)
- Context API for global state
- Local storage for preferences

**Server State**:
- SQLite database
- In-memory build tracking
- Session management
`
   },
   {
      id: 'security',
      title: 'Security Model',
      category: 'architecture',
      icon: Lock,
      searchKeywords: ['security', 'authentication', 'authorization', 'permissions'],
      lastUpdated: '2026-01-11',
      content: `# Security Model

EZPIPELINE implements multiple layers of security.

## Authentication

**JWT Tokens**:
- HS256 algorithm
- 24-hour expiry
- Stored in localStorage
- Included in Authorization header

**Password Security**:
- bcrypt hashing (10 rounds)
- Minimum 6 characters
- No plaintext storage

## Authorization

**Permission Levels**:
- \`canView\`: View pipelines and logs
- \`canRun\`: Execute pipelines
- \`canEditYaml\`: Modify pipeline config
- \`canEditEnv\`: Change environment variables
- \`canUseClaude\`: Access AI assistant
- \`canUseTerminal\`: Server terminal access

**Permission Hierarchy**:
- Admins have all permissions
- Per-pipeline granular control
- Wildcard (\`*\`) for global access

## Environment Variable Security

**Redaction**:
- All env values redacted from logs
- System variables excluded
- Secure storage in .env files

## Session Management

- JWT validation on each request
- Automatic token refresh
- Logout clears all sessions
`
   },
   {
      id: 'real-time',
      title: 'Real-Time Communication',
      category: 'architecture',
      icon: Zap,
      searchKeywords: ['websocket', 'socket.io', 'real-time', 'live', 'streaming'],
      lastUpdated: '2026-01-11',
      content: `# Real-Time Communication

EZPIPELINE uses Socket.IO for bidirectional real-time communication.

## Connection Setup

**Client**:
\`\`\`typescript
import { io } from 'socket.io-client';

const socket = io(API_URL, {
  auth: { token: jwtToken },
  reconnection: true
});
\`\`\`

**Server**:
\`\`\`typescript
import { Server } from 'socket.io';

const io = new Server(httpServer, {
  cors: { origin: '*' }
});

io.on('connection', (socket) => {
  // Handle connections
});
\`\`\`

## Event System

**Build Events**:
- Real-time log streaming
- Progress updates
- Status changes
- Error notifications

**Terminal Events**:
- \`terminal-output\`: Command output
- \`terminal-exit\`: Session ended
- \`terminal-error\`: Execution error

## Reconnection

- Automatic reconnection on disconnect
- Exponential backoff
- State restoration after reconnect

## Performance

- Event-driven architecture
- Minimal latency
- Efficient binary data transfer
- Room-based broadcasting
`
   }
];
