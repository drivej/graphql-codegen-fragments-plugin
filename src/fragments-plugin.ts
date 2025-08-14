import type { PluginFunction } from '@graphql-codegen/plugin-helpers';
import { pascalCase } from 'change-case';
import { GraphQLList, GraphQLNonNull, isEnumType, isObjectType, isScalarType, type GraphQLObjectType, type GraphQLSchema } from 'graphql';
import path from 'path';

// -----------------------------
// Config
// -----------------------------
export type FragmentsPluginConfig = {
  depth?: number;
  subModelDepth?: number;
  namingConvention?: 'keep' | 'change-case-all#pascalCase';
  rename?: Record<string, string>;
  /** Where the generated file will import helpers (e.g. '../lib/gql.helpers' or '@/lib/gql.helpers') */
  helpersImport?: string;
  /** Where the generated file will import TS GraphQL types (e.g. './graphql' or '@/generated/graphql') */
  typesImport?: string;
  /** Project root used to resolve relative module specifiers; defaults to process.cwd() */
  baseDir?: string;
};

// -----------------------------
// Utilities
// -----------------------------
function unwrap(type: any): any {
  let t = type;
  while (t instanceof GraphQLNonNull || t instanceof GraphQLList) t = t.ofType;
  return t;
}
const isLeaf = (t: any) => isScalarType(t) || isEnumType(t);

function toTsName(name: string, cfg?: FragmentsPluginConfig): string {
  if (cfg?.rename && Object.prototype.hasOwnProperty.call(cfg.rename, name)) {
    return cfg.rename[name]!;
  }
  const conv = cfg?.namingConvention;
  if (conv === 'keep') return name;
  if (conv === 'change-case-all#pascalCase') return pascalCase(name);
  // default
  return pascalCase(name);
}

// print helpers
type Ref = { __ref: string };
function ref(name: string): Ref {
  return { __ref: name };
}
function printMap(node: any, indent = 0): string {
  const pad = (n: number) => '  '.repeat(n);
  if (Array.isArray(node)) {
    const inner = node.map((item) => printMap(item, indent + 1)).join(',\n' + pad(indent + 1));
    return `[\n${pad(indent + 1)}${inner}\n${pad(indent)}]`;
  }
  if (typeof node === 'string') return `'${node}'`;
  if (node && typeof node === 'object') {
    const key = Object.keys(node)[0];
    const val = (node as Record<string, any>)[key];
    if (val && typeof val === 'object' && Object.prototype.hasOwnProperty.call(val, '__ref')) {
      return `{ ${key}: ${(val as Ref).__ref} }`;
    }
    return `{ ${key}: ${printMap(val, indent + 1)} }`;
  }
  return '[]';
}

// Build selection map
type Mode = 'parent' | 'sub';
function buildMapForType(t: GraphQLObjectType, maxDepth: number, cfg: FragmentsPluginConfig | undefined, mode: Mode = 'parent', allowRefs = false): any[] {
  const fields = t.getFields();
  const acc: any[] = [];
  for (const name of Object.keys(fields)) {
    if (name.startsWith('__')) continue;
    const ft = unwrap(fields[name]!.type);

    if (isLeaf(ft)) {
      acc.push(name);
      continue;
    }

    if (isObjectType(ft)) {
      const tsName = toTsName(ft.name, cfg);

      if (mode === 'parent') {
        acc.push({ [name]: ref(`${tsName}Map`) });
        continue;
      }

      if (mode === 'sub') {
        if (allowRefs) {
          acc.push({ [name]: ref(`${tsName}Map`) });
          continue;
        }
        if (maxDepth > 1) {
          acc.push({ [name]: buildMapForType(ft, maxDepth - 1, cfg, 'sub', allowRefs) });
        } else {
          acc.push(name);
        }
        continue;
      }
    }

    acc.push(name);
  }
  return acc;
}

// Dependency graph + topological order (Kahn)
function collectDeps(schema: GraphQLSchema): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>();
  const typeMap = schema.getTypeMap();
  for (const [name, t] of Object.entries(typeMap)) {
    if (!isObjectType(t) || name.startsWith('__')) continue;
    if (!deps.has(name)) deps.set(name, new Set());
    const fields = t.getFields();
    for (const fname of Object.keys(fields)) {
      const ft = unwrap(fields[fname]!.type);
      if (isObjectType(ft)) {
        const dep = ft.name;
        if (!deps.has(dep)) deps.set(dep, new Set());
        deps.get(dep)!.add(name); // dep -> name (dep before name)
      }
    }
  }
  return deps;
}
function topoOrder(deps: Map<string, Set<string>>): string[] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, Set<string>>();

  for (const [n, set] of deps.entries()) {
    if (!inDeg.has(n)) inDeg.set(n, 0);
    if (!adj.has(n)) adj.set(n, new Set());
    for (const m of set) {
      inDeg.set(m, (inDeg.get(m) || 0) + 1);
      adj.get(n)!.add(m);
      if (!inDeg.has(m)) inDeg.set(m, 0);
      if (!adj.has(m)) adj.set(m, new Set());
    }
  }
  const q: string[] = [];
  for (const [n, d] of inDeg.entries()) if (d === 0) q.push(n);
  const out: string[] = [];
  while (q.length) {
    const n = q.shift()!;
    out.push(n);
    for (const m of adj.get(n) || []) {
      inDeg.set(m, (inDeg.get(m) || 0) - 1);
      if (inDeg.get(m) === 0) q.push(m);
    }
  }
  if (out.length < inDeg.size) {
    for (const n of inDeg.keys()) if (!out.includes(n)) out.push(n);
  }
  return out;
}

function asModuleSpecifier(spec: string | undefined, outFile: string, baseDir: string): string {
  if (!spec) return '';
  if (!spec.startsWith('.') && !spec.startsWith('/')) return spec;
  const from = path.dirname(outFile);
  const abs = path.resolve(baseDir, spec);
  let rel = path.relative(from, abs).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel.replace(/\.(ts|js|cjs|mjs)$/i, '');
}

// -----------------------------
// Plugin entry
// -----------------------------
export const plugin: PluginFunction<FragmentsPluginConfig> = (schema, _docs, cfg, info) => {
  const depth = cfg?.depth ?? 2;
  const subDepth = cfg?.subModelDepth ?? 1;
  const baseDir = cfg?.baseDir ?? process.cwd();
  const outFile = info?.outputFile ?? 'gql.fragments.ts';

  const helpersMod = asModuleSpecifier(cfg?.helpersImport ?? '../lib/gql.helpers', outFile, baseDir);
  const typesMod = asModuleSpecifier(cfg?.typesImport ?? './graphql', outFile, baseDir);

  const out: string[] = [];
  out.push('/* AUTO-GENERATED: do not edit by hand */');
  out.push(`import type { GQLMap } from '${helpersMod}'`);
  out.push(`import * as T from '${typesMod}'`);
  out.push('');

  // Submodel maps (topologically ordered) — depth-agnostic typing for ergonomics
  const order = topoOrder(collectDeps(schema));
  for (const name of order) {
    const t = schema.getTypeMap()[name] as GraphQLObjectType | undefined;
    if (!t || !isObjectType(t) || name.startsWith('__')) continue;
    const tsName = toTsName(name, cfg);
    const mapN = buildMapForType(t, subDepth, cfg, 'sub', true);
    out.push(`export const ${tsName}Map: GQLMap<T.${tsName}, number> = ${printMap(mapN)} as any`);
    out.push('');
  }

  // Root field maps (Query/Mutation)
  const roots = [schema.getQueryType(), schema.getMutationType()].filter(Boolean) as GraphQLObjectType[];
  for (const root of roots) {
    const fields = root.getFields();
    for (const key of Object.keys(fields)) {
      const ft = unwrap(fields[key]!.type) as any;
      if (isObjectType(ft)) {
        const tsRet = toTsName(ft.name, cfg);
        const map = buildMapForType(ft, depth, cfg, 'parent', true);
        out.push(`export const ${key}: GQLMap<T.${tsRet}, ${depth}> = ${printMap(map)}`);
        out.push('');
      }
    }
  }

  return out.join('\n');
};

export default { plugin };
