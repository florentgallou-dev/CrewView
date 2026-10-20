import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Crée un projet temporaire à partir d'un dictionnaire chemin → contenu. */
export function makeProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-view-test-'));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

export const COPILOT_ORCHESTRATOR = `---
description: "Point d'entrée : délègue aux autres agents."
name: "Orchestrateur"
tools: [read, search, agent]
agents: ["Explorateur", "Frontend & Builder"]
user-invocable: true
---
Tu es l'orchestrateur.
`;

export const COPILOT_EXPLORER = `---
description: "Analyse de l'existant. Ne modifie jamais rien."
name: "Explorateur"
tools: [read, search]
---
Tu es l'explorateur.
`;

export const COPILOT_FRONT = `---
description: "Implémentation Nuxt."
name: "Frontend & Builder"
tools: [read, search, edit, execute, todo, vscode/askQuestions]
---
Tu implémentes le front.
`;
