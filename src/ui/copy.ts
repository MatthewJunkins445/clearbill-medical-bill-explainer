// Single accessor for design/copy.json, the read-only source of every UI string.
// Imported through the bare `@design` alias (vite.config.ts, tsconfig.json) so the
// src/ui import-boundary lint rule does not see a relative path out of src/ui.
import copy from '@design/copy.json';

export type CopyVars = Record<string, string | number>;

function lookup(key: string): string {
  let node: unknown = copy;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, part)) {
      throw new Error(`Missing copy key: ${key}`);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') throw new Error(`Missing copy key: ${key}`);
  return node;
}

function fill(template: string, vars: CopyVars | undefined): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}

/** Returns the string at a dotted key, filling `{name}` placeholders from `vars`. */
export function t(key: string, vars?: CopyVars): string {
  return fill(lookup(key), vars);
}

/** Returns a list of strings (for example `consent.staysItems`), filling `{name}` placeholders from `vars`. */
export function tList(key: string, vars?: CopyVars): string[] {
  let node: unknown = copy;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, part)) {
      throw new Error(`Missing copy key: ${key}`);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (!Array.isArray(node) || !node.every((item): item is string => typeof item === 'string')) {
    throw new Error(`Missing copy key: ${key}`);
  }
  return node.map((item) => fill(item, vars));
}

/** Picks `${key}_one` when count is 1, else `${key}_other`, and fills `{count}`. */
export function tn(key: string, count: number, vars?: CopyVars): string {
  const suffix = count === 1 ? 'one' : 'other';
  return fill(lookup(`${key}_${suffix}`), { ...vars, count });
}
