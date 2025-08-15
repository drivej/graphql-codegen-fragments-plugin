# @drivej/graphql-codegen-fragments-plugin

A GraphQL Codegen plugin that generates:
- types for building graphql queries
- types for submodel

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
                    typesImport: './graphql', // <- where to import GraphQL types from
                    customFlagTypes: ['customFlag', 'specialType'] // <- NEW: custom flag types
                }
            }
        ]
    }
}
```

### Configuration Options

- `customFlagTypes`: Array of additional field names or types that should be treated as flags
- The plugin automatically detects:
  - Common flag field names: `flags`, `type`, `status`, `mode`, `kind`
  - Custom scalar types (non-standard GraphQL scalars)
  - All GraphQL enum types and their usage in query/mutation arguments

## Example Usage
```typescript

import { renderGql } from '@drivej/graphql-codegen-fragments-plugin';
import { OpenApiSwellcastResponse, OpenApiSwellResponse, QueryGetSwellcastArgs, QueryLoadSwellByIdArgs } from '../generated/graphql';
import { getSwellcast, loadSwellById } from '../generated/graphql-fragments';

const gql_full = renderGql<OpenApiSwellResponse, QueryLoadSwellByIdArgs>('loadSwellById', loadSwellById, { id: '' });

const gql_partial = renderGql<OpenApiSwellResponse, QueryLoadSwellByIdArgs>('loadSwellById', ['id', { audio: ['url'] }], { id: '' });

```

## Notes
- Submodel maps are typed with `number` depth to be reusable at any child depth.
- If your schema has true cycles, topo order still emits a valid order, but both sides may reference each other. This is fine at runtime because everything is constants after evaluation; if your bundler complains, file an issue and we can switch cyclic pairs to `let` + assignment.
