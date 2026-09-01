
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as fs from 'fs';
import path from 'path';
import { DOCS_DIR } from '../config/index.js';
import { ConfigController } from "../controllers/ConfigController.js";
import EZPipelineController from "../controllers/EZPipelineController.js";
import Logger from "../controllers/Logger.js";
import { assertConfigFile } from "../config/pipelinePaths.js";

export class InternalMCPServer {
    private server: Server;
    private configController: ConfigController;
    private pipelineController: EZPipelineController;

    constructor() {
        this.configController = ConfigController.getInstance();
        this.pipelineController = EZPipelineController.instance;

        // Initialize MCP Server
        this.server = new Server(
            {
                name: "ezpipeline-mcp",
                version: "1.0.0",
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupHandlers();
    }

    private setupHandlers() {
        // List Tools Handler
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "list_pipelines",
                        description: "List all pipelines, their groups, and current status.",
                        inputSchema: {
                            type: "object",
                            properties: {},
                        },
                    },
                    {
                        name: "read_yaml_config",
                        description: "Read the content of a YAML configuration file.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: "Relative path to the YAML file. NOTE: Cannot read .env files.",
                                },
                            },
                            required: ["path"],
                        },
                    },
                    {
                        name: "update_yaml_config",
                        description: "Update a YAML configuration file. Validates syntax before saving.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: "Relative path to the YAML file.",
                                },
                                content: {
                                    type: "string",
                                    description: "The full YAML content to write.",
                                },
                            },
                            required: ["path", "content"],
                        },
                    },
                    {
                        name: "get_env_keys",
                        description: "Get the list of keys (variable names) from an .env file. Values are redacted.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: { type: "string", description: "Path to the .env file" }
                            },
                            required: ["path"]
                        }
                    },
                    {
                        name: "set_env_variable",
                        description: "Safely set or update an environment variable in an .env file.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                path: { type: "string", description: "Path to the .env file" },
                                key: { type: "string", description: "Variable Name (KEY)" },
                                value: { type: "string", description: "Variable Value" }
                            },
                            required: ["path", "key", "value"]
                        }
                    },
                    {
                        name: "move_pipeline",
                        description: "Move a pipeline configuration file to a different folder/group.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                currentPath: {
                                    type: "string",
                                    description: "Current relative path of the file.",
                                },
                                newPath: {
                                    type: "string",
                                    description: "New relative path (e.g., 'NewGroup/pipeline.yaml').",
                                },
                            },
                            required: ["currentPath", "newPath"],
                        },
                    },
                    {
                        name: "list_documentation",
                        description: "List available project documentation files.",
                        inputSchema: { type: "object", properties: {} }
                    },
                    {
                        name: "read_documentation",
                        description: "Read a specific documentation file.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                filename: {
                                    type: "string",
                                    description: "The name of the documentation file to read (e.g., 'architecture.md')."
                                }
                            },
                            required: ["filename"]
                        }
                    },
                    {
                        name: "get_global_env_keys",
                        description: "Get the list of global environment variable keys. Values are redacted for security. Global env vars are available to all pipelines.",
                        inputSchema: {
                            type: "object",
                            properties: {}
                        }
                    },
                    {
                        name: "set_global_env_variable",
                        description: "Set or update a global environment variable. Global vars are available to all pipelines.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                key: { type: "string", description: "Variable name (KEY)" },
                                value: { type: "string", description: "Variable value" }
                            },
                            required: ["key", "value"]
                        }
                    },
                    {
                        name: "delete_global_env_variable",
                        description: "Delete a global environment variable.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                key: { type: "string", description: "Variable name to delete" }
                            },
                            required: ["key"]
                        }
                    },
                    {
                        name: "get_build_history",
                        description: "Get the build history, covering all recent builds. Can be filtered by group.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                group: {
                                    type: "string",
                                    description: "Optional group name to filter builds."
                                }
                            }
                        }
                    },
                    {
                        name: "generate_rollback_plan",
                        description: "Intelligently generates a rollback pipeline YAML by filtering out build steps from the original pipeline.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                targetName: { type: "string", description: "Name of the pipeline target" }
                            },
                            required: ["targetName"]
                        }
                    },
                    {
                        name: "execute_rollback",
                        description: "Execute a rollback/restore for a pipeline version.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                targetName: { type: "string", description: "Name of the pipeline target" },
                                version: { type: "string", description: "Version string to rollback to (e.g., '1.0.5')" },
                                smartRollbackYaml: { type: "string", description: "Optional custom YAML to use for the rollback process." }
                            },
                            required: ["targetName", "version"]
                        }
                    },
                    {
                        name: "get_global_resources",
                        description: "List all global resources available to pipelines.",
                        inputSchema: { type: "object", properties: {} }
                    },
                    {
                        name: "delete_global_resource",
                        description: "Delete a global resource file.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                filename: { type: "string", description: "Name of the file to delete (e.g. 'my-script.sh')" }
                            },
                            required: ["filename"]
                        }
                    }
                ],
            };
        });

        // Call Tool Handler
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            Logger.getInstance().info(`[MCP] Tool Called: ${name}`);

            try {
                switch (name) {
                    case "list_pipelines": {
                        const targets = this.pipelineController.targets.map(t => ({
                            name: t.appName, // Changed from t.targetName to t.appName based on instruction
                            app: t.appName,
                            group: t.group || 'General',
                            filePath: t.filePath,
                            // Add status if available from builds
                        }));
                        return { content: [{ type: "text", text: JSON.stringify(targets, null, 2) }] };
                    }

                    case "read_yaml_config": {
                        const { path } = args as { path: string };
                        // Was `path.endsWith('.env')` and nothing else, so
                        // ".env.production" read clean and so did any SSH key,
                        // .pem or credentials.json inside the pipelines tree.
                        // Shared with AnthropicAssistant so there is one rule.
                        assertConfigFile(path);
                        const content = this.configController.getFileContent("yaml", path);
                        return { content: [{ type: "text", text: content }] };
                    }

                    case "update_yaml_config": {
                        const { path, content } = args as { path: string, content: string };
                        // A tool named update_yaml_config could overwrite a
                        // shell script in the pipelines tree, which is the same
                        // hole as the read side and worse in its consequences.
                        assertConfigFile(path);
                        this.configController.saveFileContent("yaml", path, content);
                        return { content: [{ type: "text", text: `Successfully updated ${path}` }] };
                    }

                    case "get_env_keys": {
                        const { path } = args as { path: string };
                        const keys = this.configController.getEnvKeys(path);
                        return { content: [{ type: "text", text: JSON.stringify(keys, null, 2) }] };
                    }

                    case "set_env_variable": {
                        const { path, key, value } = args as { path: string, key: string, value: string };
                        // 1. Read existing (raw) - Handle missing file gracefully
                        let raw = "";
                        try {
                            raw = this.configController.getFileContent("env", path);
                        } catch (e: any) {
                            if (e.message === "File not found") {
                                Logger.getInstance().info(`[MCP] Creating new env file: ${path}`);
                            } else {
                                throw e;
                            }
                        }

                        // 2. Parse and Update
                        const lines = raw.split('\n');
                        let found = false;
                        const newLines = lines.map(line => {
                            if (line.trim().startsWith(`${key}=`) || line.trim().startsWith(`export ${key}=`)) {
                                found = true;
                                return `${key}=${value}`;
                            }
                            return line;
                        });

                        if (!found) {
                            newLines.push(`${key}=${value}`);
                        }

                        // 3. Save
                        this.configController.saveFileContent("env", path, newLines.join('\n'));
                        return { content: [{ type: "text", text: `Successfully set ${key} in ${path}` }] };
                    }

                    case "move_pipeline": {
                        const { currentPath, newPath } = args as { currentPath: string, newPath: string };
                        this.configController.moveFile("yaml", currentPath, newPath);
                        this.pipelineController.refreshTargets(); // Refresh pipeline list after move
                        return { content: [{ type: "text", text: `Successfully moved ${currentPath} to ${newPath}. Pipeline list refreshed.` }] };
                    }

                    case "list_documentation": {
                        if (!fs.existsSync(DOCS_DIR)) return { content: [{ type: "text", text: "Documentation directory not found." }] };
                        const files = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.md'));
                        return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
                    }

                    case "read_documentation": {
                        const { filename } = args as { filename: string };
                        // Sanitize
                        if (filename.includes('..') || filename.includes('/')) throw new Error("Invalid filename");

                        const filePath = path.join(DOCS_DIR, filename);
                        if (!fs.existsSync(filePath)) throw new Error("File not found");

                        const content = fs.readFileSync(filePath, 'utf-8');
                        return { content: [{ type: "text", text: content }] };
                    }

                    case "get_global_env_keys": {
                        const keys = this.configController.getGlobalEnvKeys();
                        return { content: [{ type: "text", text: JSON.stringify(keys, null, 2) }] };
                    }

                    case "set_global_env_variable": {
                        const { key, value } = args as { key: string, value: string };
                        this.configController.setGlobalEnvVariable(key, value);
                        return { content: [{ type: "text", text: `Successfully set global env variable ${key}` }] };
                    }

                    case "delete_global_env_variable": {
                        const { key } = args as { key: string };
                        this.configController.deleteGlobalEnvVariable(key);
                        return { content: [{ type: "text", text: `Successfully deleted global env variable ${key}` }] };
                    }

                    case "get_global_resources": {
                        const resources = this.configController.getGlobalResources();
                        return { content: [{ type: "text", text: JSON.stringify(resources, null, 2) }] };
                    }

                    case "delete_global_resource": {
                        const { filename } = args as { filename: string };
                        this.configController.deleteGlobalResource(filename);
                        return { content: [{ type: "text", text: `Successfully deleted global resource ${filename}` }] };
                    }

                    case "get_build_history": {
                        const { group } = args as { group?: string };
                        const history = this.pipelineController.getBuildHistory(group);
                        return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
                    }

                    case "generate_rollback_plan": {
                        const { targetName } = args as { targetName: string };
                        const rollbackPipeline = this.pipelineController.generateRollbackPlan(targetName);
                        return { content: [{ type: "text", text: JSON.stringify(rollbackPipeline, null, 2) }] };
                    }

                    case "execute_rollback": {
                        const { targetName, version, smartRollbackYaml } = args as { targetName: string, version: string, smartRollbackYaml?: string };
                        await this.pipelineController.rollback(targetName, version, smartRollbackYaml);
                        return { content: [{ type: "text", text: `Rollback/Restore initiated for ${targetName} v${version}` }] };
                    }

                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            } catch (error: any) {
                Logger.getInstance().error(`[MCP] Error executing ${name}`, error);
                return {
                    content: [{ type: "text", text: `Error: ${error.message}` }],
                    isError: true,
                };
            }
        });
    }

    public async start() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        Logger.getInstance().info("Internal MCP Server started on Stdio");
    }
}
