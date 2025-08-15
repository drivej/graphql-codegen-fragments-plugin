# @drivej/graphql-codegen-fragments-plugin

A GraphQL Codegen plugin that generates:
- `export const <TypeName>Map: GQLMap<T.<TypeName>, number>` for **every object type** (depth-agnostic)
- `export const <rootField>: GQLMap<T.<ReturnType>, D>` for Query/Mutation fields, **referencing** submodel maps
Uses topological ordering to avoid TDZ for submodel references.

## Install
```bash
npm i -D @your-scope/graphql-codegen-fragments-plugin change-case
```

## Configure (codegen.yml)
```typescript
generates: {
    'src/generated/graphql-fragments.ts': {
        plugins: [
            {
                '@drivej/graphql-codegen-fragments-plugin': {
                    depth: 15,
                    subModelDepth: 15,
                    namingConvention: 'change-case-all#pascalCase', // <- match TS
                    skipTypes: ['Upload'],
                    skipFields: { User: ['password', 'token'] },
                    customFlagTypes: ['customFlag', 'specialType'] // <- NEW: custom flag types
                }
            }
        ]
    }
}
```

## Dynamic Schema Analysis

This plugin now automatically analyzes your GraphQL schema to identify:

- **Flags**: Fields that should be rendered without quotes (custom scalars, common flag names like 'flags', 'type', 'status', etc.)
- **Enums**: GraphQL enum types that should be passed through as-is

### Configuration Options

- `customFlagTypes`: Array of additional field names or types that should be treated as flags
- The plugin automatically detects:
  - Common flag field names: `flags`, `type`, `status`, `mode`, `kind`
  - Custom scalar types (non-standard GraphQL scalars)
  - All GraphQL enum types and their usage in query/mutation arguments

### Before vs After

**Before (hardcoded):**
```typescript
const queryFlags = ['flags', 'type'];
const queryEnums = ['sectionType'];
```

**After (dynamic):**
```typescript
// Automatically detected from your schema:
// - Flags: ['flags', 'type', 'status', 'mode', 'customFlag', ...]
// - Enums: ['SectionType', 'Status', 'sectionType', 'status', ...]
```

### Migration Guide

**Existing users**: This is a **backward-compatible** change. Your existing code will continue to work without any modifications. The plugin now automatically detects the types that were previously hardcoded, plus many more from your actual schema.

**New features available**:
- Add `customFlagTypes` to your config to specify additional flag types
- Use `getQueryFlags()` and `getQueryEnums()` for debugging
- Use `createSchemaAwareRenderer()` for custom rendering with specific schemas
## Example Usage
```typescript
import { getSwellcast, loadSwellById } from '../generated/graphql-fragments';
import { useGraphQLQuery } from './useGraphQLQuery';

export const useSwellcast = (args: Partial<QueryGetSwellcastArgs>) => {
  const queryName = 'getSwellcast';
  const defaultArgs: QueryGetSwellcastArgs = {
    alias: '',
    limit: 24,
    offset: 0
  };

  return useGraphQLQuery<OpenApiSwellcastResponse, QueryGetSwellcastArgs, typeof queryName>(queryName, getSwellcast, args, defaultArgs, {
    queryKey: [queryName, args.alias],
    enabled: !!args.alias
  });
};
```

## Notes
- Submodel maps are typed with `number` depth to be reusable at any child depth.
- If your schema has true cycles, topo order still emits a valid order, but both sides may reference each other. This is fine at runtime because everything is constants after evaluation; if your bundler complains, file an issue and we can switch cyclic pairs to `let` + assignment.
