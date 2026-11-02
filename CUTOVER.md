# MdwNfr Cloudflare production ownership

Cutover completed on October 30, 2026.

- The authoritative application source is `sydgouda2022/mdwnfr`, branch `main`.
- Initial published cutover release: `26b82a9d`. A later verified deployment
  of commit `528ea3ee` succeeded on October 30, 2026. Commit `516ce103` was
  subsequently checked by CI and the read-only live audit, but the audit-only
  commit was **not** itself published.
- The production URL is `https://mdwnfr.sydgouda.workers.dev/`. Check the
  actual installed build metadata after any release; a green CI run alone is
  not proof of deployment.
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
