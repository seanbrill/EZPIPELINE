import type { DocSection } from './index';
import { Rocket, Settings, Play, BookOpen } from 'lucide-react';

export const gettingStartedDocs: DocSection[] = [
  {
    id: 'quick-start',
    title: 'Quick Start',
    category: 'getting-started',
    icon: Rocket,
    searchKeywords: ['install', 'setup', 'start', 'begin', 'first', 'quick'],
    lastUpdated: '2026-01-11',
    content: `# Quick Start

Get EZPIPELINE up and running in minutes.

## Prerequisites

- **Node.js** 18+ and npm
- **Git** for cloning the repository

## Installation

\`\`\`bash
# Clone the repository
git clone https://github.com/yourusername/EZPIPELINE.git
cd EZPIPELINE

# Install dependencies
npm run init

# Start development server
npm start
\`\`\`

The application will be available at:
- **Client**: http://localhost:5173
- **Server**: http://localhost:5001

## First Time Setup

1. Navigate to http://localhost:5173
2. You'll be redirected to the setup page
3. Create your admin account:
   - Choose a username
   - Set a secure password (min 6 characters)
4. Click "Create Admin Account"

## Create Your First Pipeline

1. Click "New Pipeline" in the dashboard
2. Configure your pipeline:
   - **App Name**: Display name for your pipeline
   - **Target Name**: Unique identifier (lowercase, no spaces)
   - **Group**: Optional organization folder
3. Upload or create a \`pipeline.yaml\` file
4. Click "Run Pipeline" to execute

## Next Steps

- [Pipeline Configuration](guides/pipeline-configuration) - Learn YAML syntax
- [Environment Variables](guides/environment-variables) - Manage secrets
- [Deployment](guides/deployment) - Deploy to production
`
  },
  {
    id: 'installation',
    title: 'Installation',
    category: 'getting-started',
    icon: Settings,
    searchKeywords: ['install', 'setup', 'dependencies', 'npm', 'docker'],
    lastUpdated: '2026-01-11',
    content: `# Installation

Detailed installation instructions for different environments.

## Development Installation

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- Git

### Steps

\`\`\`bash
# 1. Clone the repository
git clone https://github.com/yourusername/EZPIPELINE.git
cd EZPIPELINE

# 2. Install dependencies (monorepo + workspaces)
npm run init

# 3. Start development servers
npm start
\`\`\`

This will start:
- **Vite dev server** on port 5173 (client with HMR)
- **Express server** on port 5001 (API and WebSocket)

## Production Installation

### Option 1: Docker (Recommended)

\`\`\`bash
# Build Docker image
npm run package

# Run container
docker run -p 5001:5001 -v ./data:/app/apps/server/data ezpipeline
\`\`\`

### Option 2: Manual Build

\`\`\`bash
# 1. Build client and server
npm run build

# 2. Start production server
cd apps/server
npm start
\`\`\`

The application will be available at http://localhost:5001

## Environment Variables

Create \`.env\` file in \`apps/server/\`:

\`\`\`bash
# Server Configuration
PORT=5001
NODE_ENV=production

# Security
JWT_SECRET=your-secret-key-min-32-characters

# Database
DB_PATH=./data/app.db

# Logging
LOG_LEVEL=info
\`\`\`

## Verification

Test your installation:

\`\`\`bash
# Check server health
curl http://localhost:5001/api/health

# Expected response:
# {"status":"ok","version":"1.0.0"}
\`\`\`

## Troubleshooting

**Port already in use:**
\`\`\`bash
# Change port in ezpipeline.config.json
{
  "ports": {
    "server": 8080  // Change from 5001
  }
}
\`\`\`

**Build errors:**
\`\`\`bash
# Clean and reinstall
npm run clean:all
npm run init
\`\`\`
`
  },
  {
    id: 'first-pipeline',
    title: 'Your First Pipeline',
    category: 'getting-started',
    icon: Play,
    searchKeywords: ['pipeline', 'yaml', 'first', 'tutorial', 'example'],
    lastUpdated: '2026-01-11',
    content: `# Your First Pipeline

Create and run your first pipeline in EZPIPELINE.

## What is a Pipeline?

A pipeline is a series of automated steps defined in a YAML file. Each step can:
- Run shell commands
- Build applications
- Deploy to servers
- Send notifications

## Creating a Pipeline

### 1. Create Pipeline YAML

Create \`pipeline.yaml\`:

\`\`\`yaml
name: My First Pipeline
description: A simple hello world pipeline

steps:
  - name: Say Hello
    run: echo "Hello from EZPIPELINE!"
    
  - name: Show Date
    run: date
    
  - name: List Files
    run: ls -la
\`\`\`

### 2. Add to EZPIPELINE

1. Click **"New Pipeline"** in the dashboard
2. Fill in details:
   - **App Name**: My First Pipeline
   - **Target Name**: my-first-pipeline
3. Upload your \`pipeline.yaml\`
4. Click **"Create"**

### 3. Run the Pipeline

1. Find your pipeline in the dashboard
2. Click the **Play** button
3. Watch the logs in real-time
4. See the results of each step

## Example Output

\`\`\`
[Step 1/3] Say Hello
Hello from EZPIPELINE!
✓ Completed in 0.1s

[Step 2/3] Show Date
Sat Jan 11 2026 11:45:00 GMT-0500
✓ Completed in 0.1s

[Step 3/3] List Files
total 24
drwxr-xr-x  5 user  staff   160 Jan 11 11:45 .
drwxr-xr-x  3 user  staff    96 Jan 11 11:40 ..
-rw-r--r--  1 user  staff   123 Jan 11 11:45 pipeline.yaml
✓ Completed in 0.2s

Pipeline completed successfully in 0.4s
\`\`\`

## Next Steps

- [Pipeline Configuration](guides/pipeline-configuration) - Learn advanced YAML
- [Environment Variables](guides/environment-variables) - Add secrets
- [Deployment Example](guides/deployment) - Deploy a real app
`
  },
  {
    id: 'basic-concepts',
    title: 'Basic Concepts',
    category: 'getting-started',
    icon: BookOpen,
    searchKeywords: ['concepts', 'basics', 'fundamentals', 'learn', 'understand'],
    lastUpdated: '2026-01-11',
    content: `# Basic Concepts

Understand the core concepts of EZPIPELINE.

## Pipelines

A **pipeline** is an automated workflow defined in YAML. It consists of:
- **Steps**: Individual tasks executed sequentially
- **Environment**: Variables and secrets
- **Triggers**: Manual or scheduled execution

## Steps

Each **step** in a pipeline:
- Has a unique name
- Runs a shell command or script
- Can depend on previous steps
- Reports success or failure

Example:
\`\`\`yaml
steps:
  - name: Build
    run: npm run build
    
  - name: Test
    run: npm test
\`\`\`

## Targets

A **target** is a unique identifier for your pipeline:
- Must be lowercase
- No spaces (use hyphens)
- Used in URLs and file paths

Example: \`my-app-production\`

## Groups

**Groups** organize pipelines into folders:
- Optional categorization
- Hierarchical structure
- Example: \`frontend/production\`

## Environment Variables

**Environment variables** store configuration and secrets:
- Defined per pipeline
- Stored in \`.env\` files
- Automatically loaded during execution
- Redacted from logs for security

Example:
\`\`\`bash
API_KEY=secret-key-123
DATABASE_URL=postgresql://localhost/mydb
\`\`\`

## Permissions

**Permissions** control user access:
- **View**: See pipeline and logs
- **Run**: Execute pipeline
- **Edit YAML**: Modify pipeline configuration
- **Edit ENV**: Change environment variables
- **Use Claude**: Access AI assistant
- **Use Terminal**: Access server terminal

## Builds

A **build** is a single execution of a pipeline:
- Tracked in build history
- Stores logs and output
- Can succeed, fail, or be aborted
- Versioned for rollback

## Versioning

**Versioning** enables rollback:
- Automatic archiving after successful builds
- Docker images or ZIP archives
- Configurable retention (10 versions or 1GB)
- One-click rollback to previous versions

## Real-time Updates

EZPIPELINE uses **WebSockets** for:
- Live log streaming
- Build status updates
- Progress notifications
- No page refresh needed

## Security

**Security features**:
- JWT authentication
- Bcrypt password hashing
- Granular permissions
- Environment variable redaction
- Session management
`
  }
];
