// Lecture du frontmatter des fichiers d'agents (formats Claude Code et GitHub Copilot).
// Sous-ensemble YAML volontairement limité : scalaires, chaînes quotées, listes inline
// `[a, b]`, listes en bloc `- a` et scalaires multilignes `|` / `>`.

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(text: string): Frontmatter {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) return { data: {}, body: text };
  return { data: parseYamlSubset(match[1]), body: match[2] };
}

function parseYamlSubset(source: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const lines = source.split(/\r?\n/);
  let listKey: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as unknown[]).push(parseScalar(item[1]));
      continue;
    }

    const entry = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!entry) continue;
    const [, key, value] = entry;
    listKey = undefined;

    if (value === '') {
      data[key] = [];
      listKey = key;
    } else if (/^[|>][-+]?$/.test(value.trim())) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
      data[key] = value.trim().startsWith('>') ? block.join(' ').trim() : block.join('\n').trim();
    } else {
      data[key] = parseValue(value);
    }
  }
  return data;
}

function parseValue(value: string): unknown {
  const v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) return splitInline(v.slice(1, -1)).map(parseScalar);
  return parseScalar(v);
}

function splitInline(source: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (const char of source) {
    if (quote) {
      if (char === quote) quote = undefined;
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ',') {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseScalar(value: string): unknown {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** Valeur de frontmatter en liste de chaînes (accepte `[a, b]`, `- a` ou `"a, b"`). */
export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
