import { ConfigController } from "../controllers/ConfigController.js";
import EZPipelineController from "../controllers/EZPipelineController.js";
import Logger from "../controllers/Logger.js";
import path from "path";
import fs from "fs";

// Define the shape of a Tool
interface Tool {
    name: string;
    description: string;
    input_schema: any;
    execute: (args: any) => Promise<any>;
}

export class AIService {
    private static instance: AIService;
    private configController = ConfigController.getInstance();
    private pipelineController = EZPipelineController.instance;
    private sandboxDir: string;

    private tools: Tool[] = [
        {
            name: "list_pipelines",
            description: "List all available pipelines and their status.",
            input_schema: { type: "object", properties: {} },
            execute: async () => {
                return this.pipelineController.targets.map(t => {
                    const builds = this.pipelineController.builds.filter(b => b.target === t.id);
                    // Sort by started date desc if needed, but array push order implies last is latest ?
                    // Let's assume last is latest for simplicity or sort.
                    const lastBuild = builds[builds.length - 1];

                    let status = 'idle';
                    if (lastBuild) {
                        if (!lastBuild.ended) status = 'running';
                        else if (lastBuild.error) status = 'error';
                        else status = 'completed';
                    }

                    return {
                        name: t.id,
                        app: t.appName,
                        status: status,
                        lastRun: lastBuild ? lastBuild.started : null
                    };
                });
            }
        },
        {
            name: "read_config",
            description: "Read the YAML configuration for a specific pipeline or file path.",
            input_schema: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Relative path to the YAML file (e.g. 'pipeline.yaml')" }
                },
                required: ["path"]
            },
            execute: async ({ path }) => {
                try {
                    return this.configController.getFileContent("yaml", path);
                } catch (e: any) {
                    return { error: e.message };
                }
            }
        },
        {
            name: "save_config",
            description: "Update the YAML configuration for a file.",
            input_schema: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Relative path to the YAML file" },
                    content: { type: "string", description: "The new YAML content" }
                },
                required: ["path", "content"]
            },
            execute: async ({ path, content }) => {
                try {
                    this.configController.saveFileContent("yaml", path, content);
                    return { success: true, message: "File saved" };
                } catch (e: any) {
                    return { error: e.message };
                }
            }
        },
        {
            name: "run_pipeline",
            description: "Trigger a run for a specific pipeline.",
            input_schema: {
                type: "object",
                properties: {
                    target: { type: "string", description: "The ID of the pipeline to run" }
                },
                required: ["target"]
            },
            execute: async ({ target }) => {
                const pipeline = this.pipelineController.targets.find(t => t.id === target);
                if (!pipeline) return { error: "Pipeline not found" };

                const build = this.pipelineController.start_build(pipeline);
                // Run async
                setImmediate(() => this.pipelineController.run(target, build));

                return { success: true, buildId: build.id, message: "Pipeline started" };
            }
        }
    ];

    private constructor() {
        this.sandboxDir = path.resolve(process.cwd(), "ai_sandbox");
        if (!fs.existsSync(this.sandboxDir)) {
            fs.mkdirSync(this.sandboxDir, { recursive: true });
        }
    }

    public static getInstance(): AIService {
        if (!AIService.instance) {
            AIService.instance = new AIService();
        }
        return AIService.instance;
    }

    public async processChat(message: string, history: any[], apiKey?: string): Promise<{ reply: string, tool_calls?: any[] }> {
        Logger.getInstance().info(`AI Chat Request: ${message} (Sandbox: ${this.sandboxDir})`);

        // If no API Key, return mock response or "Configuration Needed" message
        if (!apiKey) {
            // For demo purposes, we can have a simple regex-based mock if user hasn't provided key
            // Or just say "Please provide an API Key in settings".
            // Let's implement a very basic "Keyword" responder for testing without spending money/keys

            const lower = message.toLowerCase();
            if (lower.includes("list")) {
                const pipelines = await this.tools.find(t => t.name === "list_pipelines")!.execute({});
                return { reply: `Here are your pipelines: ${JSON.stringify(pipelines, null, 2)}` };
            }
            if (lower.includes("read") && lower.includes("yaml")) {
                return { reply: "I can read config. Which file? (Mock response: try 'list')" };
            }

            return {
                reply: "I am the EZPipeline Assistant. To use my full intelligence, please provide an Anthropic API Key in settings. For now, I can only respond to basic commands like 'list pipelines' in this mock mode."
            };
        }

        // Real integration with Anthropic would go here.
        // We would construct the system prompt with tool definitions.
        // process.chdir(this.sandboxDir); // Ensure CWD is sandbox for any executed code (though we only use tools)

        // Mocking sophisticated tool usage
        return { reply: "AI Integration Logic Placeholder. (API Key received but not connected to real Claude API yet)" };
    }
}
