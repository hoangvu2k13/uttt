import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { initSocketServer } from './src/lib/server/socket.js';
import { enhancedImages } from '@sveltejs/enhanced-img';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    plugins: [
      enhancedImages(),
      sveltekit(),
      {
        name: 'uttt-socket-io',
        configureServer(server) {
          if (server.httpServer) initSocketServer(server.httpServer);
        }
      }
    ],
    build: {
      target: 'esnext',
      minify: 'esbuild',
      sourcemap: false,
    }
  };
});
