/**
 * Smithery build configuration.
 *
 * Marks native Node.js addons as external so esbuild doesn't attempt
 * to bundle them (they must be resolved at runtime).
 */
export default {
  external: ['better-sqlite3'],
};
