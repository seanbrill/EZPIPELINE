
import { InternalMCPServer } from "./services/MCPServer.js";
import EZPipelineController from "./controllers/EZPipelineController.js";
import { DatabaseService } from "./services/Database.js";

// Initialize necessary controllers as this is running in a separate process context if spawned?
// Actually, if we spawn this script, it has its own memory. 
// However, EZPipelineController reads from disk.
// BUT, DatabaseService might need initialization.
// If this script is spawned by `claude` (outside of our main server process), 
// it MUST be able to access the same DB/files.
// SQLite is file-based, so it's fine as long as we don't have locking issues.
// `better-sqlite3` supports multiple connections usually, but concurrent writes might be locked.
// The main server is running. This MCP server will be a child process of `claude`?
// Wait, `claude` CLI connects to MCP servers.
// If we configure `claude` to run `node mcp-entry.js`, it runs a NEW node process.
// We need to ensure it initializes what it needs.

EZPipelineController.initialize();
DatabaseService.getInstance(); // Initialize DB

const mcpServer = new InternalMCPServer();
mcpServer.start().catch(err => {
    console.error("Failed to start MCP Server:", err);
    process.exit(1);
});
