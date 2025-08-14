// # @your-scope/graphql-codegen-fragments-plugin
//
// A GraphQL Codegen plugin that generates:
// - `export const <TypeName>Map: GQLMap<T.<TypeName>, number>` for **every object type** (depth-agnostic)
// - `export const <rootField>: GQLMap<T.<ReturnType>, D>` for Query/Mutation fields, **referencing** submodel maps
// Uses topological ordering to avoid TDZ for submodel references.
//
// ## Install
// ```bash
// npm i -D @your-scope/graphql-codegen-fragments-plugin change-case
// ```
//
// ## Configure (codegen.yml)
// ```yml
// generates:
//   src/graphql/gql.fragments.ts:
//     plugins:
//       - '@your-scope/graphql-codegen-fragments-plugin'
//     config:
//       depth: 4                 # parent/root depth
//       subModelDepth: 2         # submodel expansion before referencing other maps
//       helpersImport: '../lib/gql.helpers'
//       typesImport: './graphql'
//       namingConvention: 'change-case-all#pascalCase' # or 'keep'
// ```
//
// ## Notes
// - Submodel maps are typed with `number` depth to be reusable at any child depth.
// - If your schema has true cycles, topo order still emits a valid order, but both sides may reference each other. This is fine at runtime because everything is constants after evaluation; if your bundler complains, file an issue and we can switch cyclic pairs to `let` + assignment.
