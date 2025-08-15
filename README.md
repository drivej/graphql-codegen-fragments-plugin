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
                    skipFields: { User: ['password', 'token'] }
                }
            }
        ]
    }
}
```
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
