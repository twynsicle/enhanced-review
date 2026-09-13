/**
 * Where Monaco comes from, and which Monaco.
 *
 * `@monaco-editor/react` fetches the editor from a CDN rather than bundling
 * it. Left to itself it uses a URL baked into `@monaco-editor/loader`, naming
 * whatever version that package was published against — which is not the
 * `monaco-editor` this repo declares, and that is where the reader's `editor`
 * types come from. Unpinned, the typechecker holds the code to an API that is
 * not the one running, and a bump to either package moves one half alone. So
 * the declared version is authoritative and the URL is spelled here; the
 * `monaco-version` guardrail fails when the two drift apart, because nothing
 * else will notice.
 *
 * This must set `paths`, never `loader.config({ monaco })`. Handing over the
 * npm package bundles all 24 MB of `min/vs` into a report that is meant to
 * stay small enough to email, which is the trade this codebase has already
 * refused. Fetching Monaco is therefore deliberate, and the report needs the
 * network to show a diff.
 */
export const MONACO_VERSION = '0.56.0';

export const MONACO_VS_URL = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;
