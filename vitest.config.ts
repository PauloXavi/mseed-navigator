import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts on purpose: the Lovable config adds TanStack Start, Nitro and
// dev-server plugins that the unit tests do not need (and must not be edited by hand).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
