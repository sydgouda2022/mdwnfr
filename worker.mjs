// All editor logic executes locally in the browser via the verified Python/WASM bundle.
// Cloudflare serves the static PWA only, never receives or stores user documents.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
