# Protect the live application while migrating

The original aaa repository continues deploying the live MdwNfr.
This bootstrap only imports source and tests it; it does not deploy.
Before cutover, configure new-repository Cloudflare secrets, verify
WebKit and offline PWA acceptance, disable original deployment and
perform a controlled one-owner deploy to the SAME existing URL.
