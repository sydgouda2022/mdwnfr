# MdwNfr Cloudflare production ownership

Cutover completed on October 30, 2026.

- The authoritative application source is `sydgouda2022/mdwnfr`, branch `main`.
- The verified `main` release commit `26b82a9d` was published by the
  `MdwNfr CI and pinned Hieroglyphic Keyboard verification` workflow to
  `https://mdwnfr.sydgouda.workers.dev/`.
- GitHub Actions deploys only when explicitly enabled by the repository
  `CUTOVER_ENABLED` variable, manual `deploy_now` dispatch, or a
  `[deploy-cloudflare]` token in a push commit message. A normal merge does
  not deploy.
- The legacy `sydgouda2022/aaa` auto-deployment path for MdwNfr was
  disabled in commit `c1a95460`; its manual dispatch remains available
  for emergency recovery only.
- The installed offline PWA may retain cached files after a release. Always
  distinguish a successful deploy from a device's installed service-worker
  version; a fresh browser session and the read-only live audit can help.

Do not enable two automatic publishers for the same Cloudflare worker.
