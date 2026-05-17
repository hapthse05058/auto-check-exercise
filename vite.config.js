import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./extension/manifest.json";

export default defineConfig({
  root: "extension", // <-- This tells Vite that your extension source code is inside the 'extension' folder
  plugins: [crx({ manifest })],
  build: {
    outDir: "../dist", // <-- This ensures your build output goes back to the project root directory
    emptyOutDir: true,
  },
});
