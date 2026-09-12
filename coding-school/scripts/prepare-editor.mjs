import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Serve the installed Monaco build locally; no third-party editor CDN is needed.
cpSync(fileURLToPath(new URL("../node_modules/monaco-editor/min/vs", import.meta.url)), fileURLToPath(new URL("../public/monaco/vs", import.meta.url)), { recursive: true });
