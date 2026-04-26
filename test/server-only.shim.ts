// Vitest shim for the `server-only` Next.js sentinel package. Real Next.js
// runtime aliases `server-only` to a module that throws when imported in
// a client bundle; under Vitest there's no client/server split so this
// is a no-op. See vitest.config.mts for the alias.
export {};
