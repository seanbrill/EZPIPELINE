import type { DocSection } from './index';
import { Code, Webhook, Key, AlertCircle } from 'lucide-react';

export const apiReferenceDocs: DocSection[] = [
  {
    id: 'rest-api',
    title: 'REST API',
    category: 'api',
    icon: Code,
    searchKeywords: ['api', 'rest', 'endpoints', 'http', 'requests'],
    lastUpdated: '2026-01-11',
    content: `# REST API Reference

Base URL: \`http://localhost:5001/api\`

## Authentication

Include JWT token in headers:
\`\`\`
Authorization: Bearer <your-token>
\`\`\`

## Core Endpoints

### Authentication
- \`POST /api/login\` - User login
- \`POST /api/setup\` - Initial setup
- \`GET /api/check-auth\` - Verify token

### Pipelines
- \`GET /api/targets\` - List all pipelines
- \`POST /api/run-pipeline\` - Execute pipeline
- \`POST /api/abort-pipeline\` - Stop running pipeline
- \`DELETE /api/pipelines/:id\` - Delete pipeline

### Builds
- \`GET /api/builds\` - Active builds
- \`GET /api/history/:pipeline\` - Build history
- \`GET /api/builds/:id/logs\` - Build logs

### Users
- \`GET /api/users\` - List users (admin)
- \`POST /api/users\` - Create user
- \`PATCH /api/users/:id\` - Update user
- \`DELETE /api/users/:id\` - Delete user

### Permissions
- \`GET /api/users/:id/permissions\` - Get permissions
- \`POST /api/users/:id/permissions\` - Set permissions

### Files
- \`POST /api/upload-yaml\` - Upload pipeline YAML
- \`POST /api/upload-env\` - Upload environment file
- \`GET /api/env/:targetName\` - Get env variables
- \`POST /api/env/:targetName\` - Update env variables

## Example Request

\`\`\`bash
curl -X POST http://localhost:5001/api/run-pipeline \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"target": "production"}'
\`\`\`

## Response Format

Success:
\`\`\`json
{
  "message": "Pipeline started",
  "buildId": "build-123456"
}
\`\`\`

Error:
\`\`\`json
{
  "error": "Unauthorized"
}
\`\`\`

## Status Codes

- \`200\`: Success
- \`201\`: Created
- \`400\`: Bad Request
- \`401\`: Unauthorized
- \`403\`: Forbidden
- \`404\`: Not Found
- \`500\`: Server Error
`
  },
  {
    id: 'websocket-api',
    title: 'WebSocket API',
    category: 'api',
    icon: Webhook,
    searchKeywords: ['websocket', 'socket.io', 'events', 'real-time'],
    lastUpdated: '2026-01-11',
    content: `# WebSocket API Reference

Connect via Socket.IO for real-time updates.

## Connection

\`\`\`typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:5001', {
  auth: { token: 'your-jwt-token' }
});
\`\`\`

## Server → Client Events

### \`build:start\`
Build execution started.
\`\`\`json
{
  "buildId": "build-123",
  "target": "production",
  "status": "running"
}
\`\`\`

### \`build:log\`
Log message from build.
\`\`\`json
{
  "buildId": "build-123",
  "message": "Running step: Build"
}
\`\`\`

### \`build:progress\`
Step progress update.
\`\`\`json
{
  "buildId": "build-123",
  "step": "Build",
  "progress": 50
}
\`\`\`

### \`build:complete\`
Build finished successfully.
\`\`\`json
{
  "buildId": "build-123",
  "status": "success",
  "duration": 30000
}
\`\`\`

### \`build:error\`
Build failed.
\`\`\`json
{
  "buildId": "build-123",
  "status": "failed",
  "error": "Build failed: npm ERR!"
}
\`\`\`

### \`terminal-output\`
Terminal command output.
\`\`\`json
{
  "sessionId": "term-456",
  "data": "Hello World\\n"
}
\`\`\`

## Client → Server Events

### \`authenticate\`
Send authentication token.
\`\`\`json
{
  "token": "your-jwt-token"
}
\`\`\`

### \`subscribe:build\`
Subscribe to build updates.
\`\`\`json
{
  "buildId": "build-123"
}
\`\`\`

## Example Usage

\`\`\`typescript
// Listen for build logs
socket.on('build:log', (data) => {
  console.log(data.message);
});

// Subscribe to specific build
socket.emit('subscribe:build', {
  buildId: 'build-123'
});
\`\`\`
`
  },
  {
    id: 'authentication-api',
    title: 'Authentication',
    category: 'api',
    icon: Key,
    searchKeywords: ['auth', 'login', 'token', 'jwt', 'password'],
    lastUpdated: '2026-01-11',
    content: `# Authentication API

Manage user authentication and sessions.

## Login

\`POST /api/login\`

**Request**:
\`\`\`json
{
  "username": "admin",
  "password": "your-password"
}
\`\`\`

**Response**:
\`\`\`json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "username": "admin",
  "isAdmin": true
}
\`\`\`

## Initial Setup

\`POST /api/setup\`

Create first admin user (only works when no users exist).

**Request**:
\`\`\`json
{
  "username": "admin",
  "password": "secure-password"
}
\`\`\`

**Response**:
\`\`\`json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "username": "admin",
  "isAdmin": true
}
\`\`\`

## Verify Authentication

\`GET /api/check-auth\`

**Headers**: \`Authorization: Bearer <token>\`

**Response**:
\`\`\`json
{
  "status": "ok",
  "user": {
    "id": 1,
    "username": "admin",
    "isAdmin": true
  }
}
\`\`\`

## Change Password

\`POST /api/change-password\`

**Headers**: \`Authorization: Bearer <token>\`

**Request**:
\`\`\`json
{
  "currentPassword": "old-password",
  "newPassword": "new-password"
}
\`\`\`

**Response**:
\`\`\`json
{
  "message": "Password updated"
}
\`\`\`

## Token Details

- **Algorithm**: HS256
- **Expiry**: 24 hours
- **Storage**: localStorage (client)
- **Header**: \`Authorization: Bearer <token>\`
`
  },
  {
    id: 'error-codes',
    title: 'Error Codes',
    category: 'api',
    icon: AlertCircle,
    searchKeywords: ['error', 'codes', 'status', 'http', 'troubleshoot'],
    lastUpdated: '2026-01-11',
    content: `# Error Codes

Standard HTTP status codes and error responses.

## Status Codes

### 2xx Success
- \`200 OK\`: Request succeeded
- \`201 Created\`: Resource created

### 4xx Client Errors
- \`400 Bad Request\`: Invalid input
- \`401 Unauthorized\`: Missing/invalid token
- \`403 Forbidden\`: Insufficient permissions
- \`404 Not Found\`: Resource doesn't exist

### 5xx Server Errors
- \`500 Internal Server Error\`: Server error

## Error Response Format

All errors return JSON:
\`\`\`json
{
  "error": "Error message description"
}
\`\`\`

## Common Errors

### Authentication Errors

**Invalid Credentials**:
\`\`\`json
{
  "error": "Invalid username or password"
}
\`\`\`

**Token Expired**:
\`\`\`json
{
  "error": "Token expired"
}
\`\`\`

**Missing Token**:
\`\`\`json
{
  "error": "No token provided"
}
\`\`\`

### Permission Errors

**Insufficient Permissions**:
\`\`\`json
{
  "error": "Insufficient permissions"
}
\`\`\`

**Admin Only**:
\`\`\`json
{
  "error": "Admin access required"
}
\`\`\`

### Pipeline Errors

**Pipeline Not Found**:
\`\`\`json
{
  "error": "Pipeline not found"
}
\`\`\`

**Pipeline Running**:
\`\`\`json
{
  "error": "Pipeline already running"
}
\`\`\`

**Invalid YAML**:
\`\`\`json
{
  "error": "Invalid YAML syntax"
}
\`\`\`

## Debugging

Enable detailed error logging:
\`\`\`bash
# In apps/server/.env
LOG_LEVEL=debug
\`\`\`

Check server logs:
\`\`\`bash
tail -f apps/server/logs/app.log
\`\`\`
`
  }
];
