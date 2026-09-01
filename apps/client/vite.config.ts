import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

// Load config
let clientPort = 5173;
let serverPort = 5001;
try {
  const configPath = path.resolve(__dirname, '../../ezpipeline.config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.ports?.client) {
      clientPort = config.ports.client;
    }
    if (config.ports?.server) {
      serverPort = config.ports.server;
    }
  }
} catch (e) {
  console.warn("Could not load ezpipeline.config.json", e);
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: clientPort
  },
  build: {
    outDir: '../../apps/server/public',
    emptyOutDir: true
  },
  define: {
    'import.meta.env.VITE_SERVER_PORT': JSON.stringify(serverPort)
  }
})
