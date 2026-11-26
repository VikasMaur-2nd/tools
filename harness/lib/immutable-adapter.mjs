// A Next.js build adapter for the harness's `immutable` variants (harness/lib/build.mjs): it only turns on
// supportsImmutableAssets, as Vercel's adapter does in production. Content-hashed files are then emitted under
// /_next/static/immutable/ (chunks/, media/), and chunks name each other as "static/immutable/chunks/…".
// Loaded through NEXT_ADAPTER_PATH; next.config.ts is unchanged.
const adapter = {
  name: 'harness-immutable-assets',
  modifyConfig(config) {
    config.supportsImmutableAssets = true;
    return config;
  },
};
export default adapter;
