import { defineConfig, loadEnv } from "vite";

// Worktrees run side by side: VITE_PORT in .env picks the dev port, VITE_WS_URL the game server.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    server: { port: Number(env.VITE_PORT || 5173), strictPort: true, host: "127.0.0.1" },
    build: { target: "es2022" },
  };
});
