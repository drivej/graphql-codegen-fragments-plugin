import { GraphQLList, GraphQLNonNull, GraphQLSchema, isEnumType, isScalarType } from 'graphql';

type Unarray<T> = T extends (infer U)[] ? U : T;
type NonNullish<T> = T extends null | undefined ? never : T;
type Dec<N extends number> = N extends 0 ? never : N extends 1 ? 0 : N extends 2 ? 1 : N extends 3 ? 2 : N extends 4 ? 3 : 3;
type IsFn<T> = T extends (...args: any[]) => any ? true : false;
type ChildMap<T, D extends number> = IsFn<T> extends true ? never : Unarray<NonNullish<T>> extends object ? GQLMap<Unarray<NonNullish<T>>, Dec<D>> : never;

export type GQLMap<T, D extends number = 3> = Array<
  | Extract<keyof T, string>
  | {
      [K in keyof Partial<T> & string]?: D extends 0 ? never : ChildMap<T[K], D>;
    }
>;

//
//
// Schema analysis functions
//
//

function unwrapType(type: any): any {
  let t = type;
  while (t instanceof GraphQLNonNull || t instanceof GraphQLList) t = t.ofType;
  return t;
}

/**
 * Analyzes the schema to identify fields that should be treated as flags.
 * Flags are typically custom scalars or specific types that should be rendered without quotes.
 * You can customize this logic based on your schema conventions.
 */
export function analyzeSchemaFlags(schema: GraphQLSchema, customFlagTypes: string[] = []): string[] {
  const flags = new Set<string>();

  // Add custom flag types provided by user
  customFlagTypes.forEach(type => flags.add(type));

  // Common flag field names (you can customize this list)
  const commonFlagNames = ['flags', 'type', 'status', 'mode', 'kind'];
  commonFlagNames.forEach(name => flags.add(name));

  // Analyze Query and Mutation arguments to find potential flag fields
  const queryType = schema.getQueryType();
  const mutationType = schema.getMutationType();

  [queryType, mutationType].filter(Boolean).forEach(rootType => {
    const fields = rootType!.getFields();
    Object.values(fields).forEach(field => {
      field.args.forEach(arg => {
        const argType = unwrapType(arg.type);
        // If it's a custom scalar that's not a standard GraphQL scalar, consider it a potential flag
        if (isScalarType(argType) && !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(argType.name)) {
          flags.add(arg.name);
        }
      });
    });
  });

  return Array.from(flags);
}

/**
 * Analyzes the schema to identify fields that should be treated as enums.
 * These are GraphQL enum types that should be passed through as-is.
 */
export function analyzeSchemaEnums(schema: GraphQLSchema): string[] {
  const enums = new Set<string>();

  // Get all enum types from the schema
  const typeMap = schema.getTypeMap();
  Object.values(typeMap).forEach(type => {
    if (isEnumType(type) && !type.name.startsWith('__')) {
      // Add the enum type name
      enums.add(type.name);
    }
  });

  // Analyze Query and Mutation arguments to find enum field names
  const queryType = schema.getQueryType();
  const mutationType = schema.getMutationType();

  [queryType, mutationType].filter(Boolean).forEach(rootType => {
    const fields = rootType!.getFields();
    Object.values(fields).forEach(field => {
      field.args.forEach(arg => {
        const argType = unwrapType(arg.type);
        if (isEnumType(argType)) {
          enums.add(arg.name);
        }
      });
    });
  });

  return Array.from(enums);
}

//
//
// helper functions
//
//

// Default fallback values - will be replaced by schema analysis
let queryFlags = ['flags', 'type'];
let queryEnums = ['sectionType'];

/**
 * Initialize the query flags and enums based on schema analysis.
 * This should be called once when the schema is available.
 */
export function initializeSchemaAnalysis(schema: GraphQLSchema, customFlagTypes: string[] = []) {
  queryFlags = analyzeSchemaFlags(schema, customFlagTypes);
  queryEnums = analyzeSchemaEnums(schema);
}

/**
 * Get the current query flags (for testing or debugging purposes)
 */
export function getQueryFlags(): readonly string[] {
  return queryFlags;
}

/**
 * Get the current query enums (for testing or debugging purposes)
 */
export function getQueryEnums(): readonly string[] {
  return queryEnums;
}

/**
 * Create a schema-aware query renderer function.
 * This is useful when you want to create a renderer with a specific schema configuration.
 */
export function createSchemaAwareRenderer(schema: GraphQLSchema, customFlagTypes: string[] = []) {
  const schemaFlags = analyzeSchemaFlags(schema, customFlagTypes);
  const schemaEnums = analyzeSchemaEnums(schema);

  return function renderGqlQueryWithSchema<TParams extends Record<string, unknown> | undefined>(params: TParams): string {
    if (!params) return '';
    const keys = Object.keys(params) as (keyof NonNullable<TParams> & string)[];
    if (keys.length === 0) return '';
    const parts = keys.reduce<string[]>((acc, key) => {
      const v = (params as Record<string, unknown>)[key];
      if (v === undefined) return acc;
      const name = key as string;
      // flags: emit without quotes; enums: pass through; everything else JSON
      const val = (schemaFlags as readonly string[]).includes(name)
        ? renderQueryFlags(v as any)
        : (schemaEnums as readonly string[]).includes(name)
        ? String(v) // enums pass-through
        : JSON.stringify(v);
      if (val) acc.push(`${name}:${val}`);
      return acc;
    }, []);
    return parts.length ? `(${parts.join(' ')})` : '';
  };
}

function isSelectionObject(x: unknown): x is { [key: string]: SelectionNode[] } {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const keys = Object.keys(x);
  if (keys.length !== 1) return false;
  const v = (x as Record<string, unknown>)[keys[0]];
  return Array.isArray(v);
}

const renderGqlBody = (e: unknown): string => {
  if (isSelectionObject(e)) {
    const k = Object.keys(e)[0] as keyof typeof e;
    const children = (e as Record<string, SelectionNode[]>)[k as string];
    const parts = (children ?? []).map((child) => (isSelectionObject(child) ? renderGqlBody(child) : (child as string)));
    return `${String(k)} { ${parts.join(' ')} }`;
  }
  // string leaf
  return String(e ?? '');
};

function renderQueryFlags(flags: string | string[]) {
  if (Array.isArray(flags)) {
    return '[' + flags.join(',') + ']';
  }
  return flags;
}

function renderGqlQuery<TParams extends Record<string, unknown> | undefined>(params: TParams): string {
  if (!params) return '';
  const keys = Object.keys(params) as (keyof NonNullable<TParams> & string)[];
  if (keys.length === 0) return '';
  const parts = keys.reduce<string[]>((acc, key) => {
    const v = (params as Record<string, unknown>)[key];
    if (v === undefined) return acc;
    const name = key as string;
    // flags: emit without quotes; enums: pass through; everything else JSON
    const val = (queryFlags as readonly string[]).includes(name)
      ? renderQueryFlags(v as any)
      : (queryEnums as readonly string[]).includes(name)
      ? String(v) // enums pass-through
      : JSON.stringify(v);
    if (val) acc.push(`${name}:${val}`);
    return acc;
  }, []);
  return parts.length ? `(${parts.join(' ')})` : '';
}

export type SelectionNode = string | { [key: string]: SelectionNode[] };

export type GglCommand = {
  cmd: string;
  body: SelectionNode[] | { [key: string]: SelectionNode[] }; // your GQLMap shape
  key?: string;
};

export type GglCommands = Record<string, GglCommand>;

const CMD_PLACEHOLDER = '__CMD__';

export function renderGqlFrom<C extends GglCommands, Q extends Record<string, unknown> | undefined>(commands: C, cmd: keyof C & string, query?: Q): string {
  const bodyWrapped = renderGqlBody({ [CMD_PLACEHOLDER]: commands[cmd].body });
  const replaced = bodyWrapped.replace(CMD_PLACEHOLDER, `${commands[cmd].cmd}${renderGqlQuery(query)}`);
  return `{${replaced}}`;
}

export function renderGql<D, Q extends Record<string, unknown> | undefined>(cmd: string, body: GQLMap<D>, query?: Q): string {
  let res = renderGqlBody({ [CMD_PLACEHOLDER]: body });
  res = res.replace(CMD_PLACEHOLDER, `${cmd}${renderGqlQuery(query)}`);
  return `{${res}}`;
}

export type VarSpec = Record<string, string>;

export function renderOpGeneric(root: string, body: unknown, vars: Record<string, unknown>, varSpec: VarSpec, operationName?: string) {
  const selection = renderGqlBody({ [root]: body }).slice(renderGqlBody({ [root]: body }).indexOf('{'));
  const varDefs = Object.entries(varSpec)
    .map(([k, t]) => `$${k}: ${t}`)
    .join(', ');
  const callArgs = Object.keys(vars)
    .map((k) => `${k}: $${k}`)
    .join(', ');
  const opName = operationName ?? root;
  const query = `query ${opName}` + (varDefs ? `(${varDefs})` : '') + ` { ${root}` + (callArgs ? `(${callArgs})` : '') + ` ${selection} }`;
  return { query, variables: vars };
}
