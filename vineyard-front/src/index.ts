import { serve } from "bun";
import index from "./index.html";

// Stand-in for the register's auth service so the forms can be exercised end to end.
// It accepts any well-formed request; swap these routes for the real backend.
const MOCK_LATENCY_MS = 600;

const pause = () => new Promise(resolve => setTimeout(resolve, MOCK_LATENCY_MS));

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/auth/sign-in": {
      async POST() {
        await pause();
        return Response.json({ ok: true });
      },
    },

    "/api/auth/sign-up": {
      async POST() {
        await pause();
        return Response.json({ ok: true }, { status: 201 });
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
