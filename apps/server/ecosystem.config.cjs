module.exports = {
  apps: [
    {
      name: "EZPIPELINE",
      script: "compile/src/server.js",
      watch: ["compile", "yaml", "env"],
      // Delay between restart
      watch_delay: 2000,
      ignore_watch: ["pipeline_workspace/PIPELINE_OUTPUT", "node_modules"],
    },
  ],
};
