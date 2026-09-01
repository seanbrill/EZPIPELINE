import type { DocSection } from './index';
import { FileCode, Server, Wrench, Terminal } from 'lucide-react';

export const guidesDocs: DocSection[] = [
    {
        id: 'pipeline-configuration',
        title: 'Pipeline Configuration',
        category: 'guides',
        icon: FileCode,
        searchKeywords: ['pipeline', 'yaml', 'configuration', 'steps', 'guide'],
        lastUpdated: '2026-01-11',
        content: `# Pipeline Configuration Guide

Learn how to configure pipelines using YAML.

## Basic Structure

\`\`\`yaml
name: My Pipeline
description: Pipeline description

steps:
  - name: Step Name
    run: command to execute
    cwd: ./working-directory  # optional
\`\`\`

## Advanced Features

### Environment Variables
\`\`\`yaml
steps:
  - name: Use Env Vars
    run: echo $API_KEY
\`\`\`

### Multi-line Commands
\`\`\`yaml
steps:
  - name: Multi-line
    run: |
      npm install
      npm run build
      npm test
\`\`\`

### Working Directory
\`\`\`yaml
steps:
  - name: Build App
    run: npm run build
    cwd: ./my-app
\`\`\`

## Best Practices

1. **Clear Names**: Use descriptive step names
2. **Error Handling**: Check exit codes
3. **Logging**: Add echo statements for visibility
4. **Idempotency**: Make steps repeatable
`
    },
    {
        id: 'deployment',
        title: 'Deployment Guide',
        category: 'guides',
        icon: Server,
        searchKeywords: ['deploy', 'deployment', 'production', 'docker'],
        lastUpdated: '2026-01-11',
        content: `# Deployment Guide

Deploy EZPIPELINE to production.

## Docker Deployment

\`\`\`bash
# Build image
npm run package

# Run container
docker run -d \\
  -p 5001:5001 \\
  -v ./data:/app/apps/server/data \\
  --name ezpipeline \\
  ezpipeline
\`\`\`

## Manual Deployment

\`\`\`bash
# Build
npm run build

# Start with PM2
cd apps/server
pm2 start npm --name ezpipeline -- start
\`\`\`

## Environment Setup

Create \`.env\` in \`apps/server/\`:
\`\`\`bash
NODE_ENV=production
PORT=5001
JWT_SECRET=your-secret-key-min-32-chars
DB_PATH=./data/app.db
LOG_LEVEL=info
\`\`\`

## Nginx Reverse Proxy

\`\`\`nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://localhost:5001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
  }
}
\`\`\`
`
    },
    {
        id: 'troubleshooting',
        title: 'Troubleshooting',
        category: 'guides',
        icon: Wrench,
        searchKeywords: ['troubleshoot', 'debug', 'fix', 'error', 'problem'],
        lastUpdated: '2026-01-11',
        content: `# Troubleshooting Guide

Common issues and solutions.

## Build Failures

**Symptom**: Pipeline fails to build

**Solutions**:
1. Check logs for error messages
2. Verify YAML syntax
3. Ensure dependencies are installed
4. Check environment variables

## Permission Errors

**Symptom**: "Insufficient permissions" error

**Solutions**:
1. Verify user has required permissions
2. Check admin status
3. Review permission settings

## Connection Issues

**Symptom**: WebSocket disconnects

**Solutions**:
1. Check network connectivity
2. Verify firewall settings
3. Review proxy configuration

## Database Errors

**Symptom**: Database locked or corrupted

**Solutions**:
\`\`\`bash
# Backup and reset
cp apps/server/data/app.db apps/server/data/app.db.backup
npm run reset
\`\`\`

## Port Conflicts

**Symptom**: Port already in use

**Solutions**:
\`\`\`bash
# Kill process on port
lsof -ti:5001 | xargs kill -9

# Or change port in config
\`\`\`
`
    },
    {
        id: 'terminal-access',
        title: 'Terminal Access',
        category: 'guides',
        icon: Terminal,
        searchKeywords: ['terminal', 'shell', 'command', 'access'],
        lastUpdated: '2026-01-11',
        content: `# Terminal Access Guide

Use the built-in terminal feature.

## Overview

The Terminal tab provides direct shell access to the server running EZPIPELINE.

## Enabling Access

1. Go to **Settings** → **Users**
2. Click permissions icon for user
3. Enable **Terminal Access** permission
4. Save changes

## Using the Terminal

1. Navigate to **Dashboard**
2. Expand the logs panel (bottom)
3. Click **Terminal** tab
4. Click **Start Terminal Session**
5. Type commands and press Enter

## Security

- **Permission-based**: Only authorized users
- **Session isolation**: Each user gets own session
- **Audit logging**: All commands logged
- **Auto-cleanup**: Sessions end on disconnect

## Example Commands

\`\`\`bash
# Check directory
pwd

# List files
ls -la

# View logs
tail -f apps/server/logs/app.log

# Check processes
ps aux | grep node
\`\`\`

## Best Practices

1. **Use sparingly**: For debugging only
2. **Be careful**: Commands execute with server permissions
3. **Avoid long-running**: Use pipelines instead
4. **Monitor usage**: Review audit logs regularly
`
    }
];
