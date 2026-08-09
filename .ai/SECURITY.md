# Security baseline

Current source must be inspected before relying on any claim below.

## Verified or integrated in this checkpoint

- Android backend device credentials are now isolated to the configured backend origin through `BackendCredentialInterceptor`.
- The shared Mistral/OSRM OkHttp client should remain credential-free.
- Backend credential redirects are disabled for the derived backend client.

## Known critical gaps from current source

- Generic sync and legacy mobile routes still need a complete authorization/response-minimization audit.
- Driver and stop photo upload routes still need authenticated ownership boundaries.
- Android still embeds a Mistral API key into client BuildConfig when provided.
- NDP runtime events may miss commit SHA correlation.

## Agent rules

- Do not weaken auth, CSRF, device auth, read-only authorization, or secret scanning to satisfy tests.
- Do not expose tokens, cookies, raw API keys, device tokens, or production credentials.
- Treat Android/client secrets as exposed once shipped.
