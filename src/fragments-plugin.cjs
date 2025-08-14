// codegen/fragments-plugin.cjs
// Generates:
// 1) Submodel maps for every object type (topologically ordered to avoid TDZ)
// 2) Root-level maps for Query/Mutation that reference those submodel maps
// Submodel maps are typed depth-agnostically so you can reuse them in custom maps
// without per-site casts.

const { isObjectType, isScalarType, isEnumType, GraphQLList, GraphQLNonNull } = require('graphql');
const { pascalCase } = require('change-case');

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function unwrap(type) {
  let t = type;
  while (t instanceof GraphQLNonNull || t instanceof GraphQLList) t = t.ofType;
  return t;
}
function isLeaf(t) {
  return isScalarType(t) || isEnumType(t);
}

// Naming alignment with TS generator
function toTsName(name, cfg) {
  if (cfg && cfg.rename && Object.prototype.hasOwnProperty.call(cfg.rename, name)) {
    return cfg.rename[name];
  }
  const conv = cfg && cfg.namingConvention;
  if (conv === 'keep') return name;
  if (conv === 'change-case-all#pascalCase') return pascalCase(name);
  return pascalCase(name);
}

// Marker to print identifier references without quotes
function ref(name) {
  return { __ref: name };
}

// Pretty-printer that emits __ref as bare identifiers
function printMap(node, indent = 0) {
  const pad = (n) => '  '.repeat(n);
  if (Array.isArray(node)) {
    const inner = node.map((item) => printMap(item, indent + 1)).join(',\n' + pad(indent + 1));
    return `[\n${pad(indent + 1)}${inner}\n${pad(indent)}]`;
  }
  if (typeof node === 'string') return `'${node}'`;
  if (node && typeof node === 'object') {
    const key = Object.keys(node)[0];
    const val = node[key];
    if (val && typeof val === 'object' && Object.prototype.hasOwnProperty.call(val, '__ref')) {
      return `{ ${key}: ${val.__ref} }`;
    }
    return `{ ${key}: ${printMap(val, indent + 1)} }`;
  }
  return '[]';
}

// ---------------------------------------------------------------
// Map builder
// ---------------------------------------------------------------
// mode: 'parent' | 'sub'
// allowRefs (sub mode): when true, we reference other <TypeName>Map constants (safe due to topo order)
function buildMapForType(t, maxDepth, cfg, mode = 'parent', allowRefs = false) {
  const fields = t.getFields();
  const acc = [];
  for (const name of Object.keys(fields)) {
    if (name.startsWith('__')) continue;
    const ft = unwrap(fields[name].type);

    // Scalars/enums -> select field name
    if (isLeaf(ft)) {
      acc.push(name);
      continue;
    }

    // Object types
    if (isObjectType(ft)) {
      const tsName = toTsName(ft.name, cfg);

      if (mode === 'parent') {
        // In parent/root maps: always reference the submodel map
        acc.push({ [name]: ref(`${tsName}Map`) });
        continue;
      }

      // In submodel maps
      if (mode === 'sub') {
        if (allowRefs) {
          // reference other submodel maps (safe due to topo ordering)
          acc.push({ [name]: ref(`${tsName}Map`) });
          continue;
        }
        // Otherwise inline up to maxDepth
        if (maxDepth > 1) {
          acc.push({ [name]: buildMapForType(ft, maxDepth - 1, cfg, 'sub', allowRefs) });
        } else {
          acc.push(name);
        }
        continue;
      }
    }

    // Fallback
    acc.push(name);
  }
  return acc;
}

// ---------------------------------------------------------------
// Dependency graph + topological order (Kahn)
// Edge: B -> A if A depends on B (so B is emitted before A)
// ---------------------------------------------------------------
function collectDeps(schema) {
  const deps = new Map();
  const typeMap = schema.getTypeMap();
  for (const [name, t] of Object.entries(typeMap)) {
    if (!isObjectType(t) || name.startsWith('__')) continue;
    if (!deps.has(name)) deps.set(name, new Set());
    const fields = t.getFields();
    for (const fname of Object.keys(fields)) {
      const ft = unwrap(fields[fname].type);
      if (isObjectType(ft)) {
        const dep = ft.name; // A(name) depends on B(dep)
        if (!deps.has(dep)) deps.set(dep, new Set());
        deps.get(dep).add(name); // Edge: dep -> name (B before A)
      }
    }
  }
  return deps;
}
function topoOrder(deps) {
  const inDeg = new Map();
  const adj = new Map();

  for (const [n, set] of deps.entries()) {
    if (!inDeg.has(n)) inDeg.set(n, 0);
    if (!adj.has(n)) adj.set(n, new Set());
    for (const m of set) {
      inDeg.set(m, (inDeg.get(m) || 0) + 1);
      adj.get(n).add(m);
      if (!inDeg.has(m)) inDeg.set(m, 0);
      if (!adj.has(m)) adj.set(m, new Set());
    }
  }

  const q = [];
  for (const [n, d] of inDeg.entries()) if (d === 0) q.push(n);
  const out = [];
  while (q.length) {
    const n = q.shift();
    out.push(n);
    for (const m of adj.get(n) || []) {
      inDeg.set(m, inDeg.get(m) - 1);
      if (inDeg.get(m) === 0) q.push(m);
    }
  }

  if (out.length < inDeg.size) {
    for (const n of inDeg.keys()) if (!out.includes(n)) out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------
// Codegen plugin
// ---------------------------------------------------------------
/** @type {import('@graphql-codegen/plugin-helpers').PluginFunction} */
function plugin(schema, _docs, cfg) {
  const depth = cfg?.depth ?? 2;
  const subDepth = cfg?.subModelDepth ?? 1;

  const out = [];
  out.push('/* AUTO-GENERATED: do not edit by hand */');
  out.push(`import type { GQLMap } from '../../codegen/fragments-plugin-helpers.ts'`);
  out.push(`import * as T from './graphql'`);
  out.push('');

  // 1) Submodel maps (topologically ordered) — depth-agnostic typing for ergonomics
  const order = topoOrder(collectDeps(schema));
  for (const name of order) {
    const t = schema.getTypeMap()[name];
    if (!isObjectType(t) || name.startsWith('__')) continue;
    const tsName = toTsName(name, cfg);
    const mapN = buildMapForType(t, subDepth, cfg, 'sub', true); // allowRefs=true
    out.push(`export const ${tsName}Map: GQLMap<T.${tsName}, number> = ${printMap(mapN)} as any`);
    out.push('');
  }

  // 2) Root field maps (Query/Mutation)
  const roots = [schema.getQueryType(), schema.getMutationType()].filter(Boolean);
  for (const root of roots) {
    const fields = root.getFields();
    for (const key of Object.keys(fields)) {
      const ft = unwrap(fields[key].type);
      if (isObjectType(ft)) {
        const tsRet = toTsName(ft.name, cfg);
        const map = buildMapForType(ft, depth, cfg, 'parent', true);
        out.push(`export const ${key}: GQLMap<T.${tsRet}, ${depth}> = ${printMap(map)}`);
        out.push('');
      }
    }
  }

  return out.join('\n');
}

module.exports = { plugin };
