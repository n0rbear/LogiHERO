# Private preview: `logihero.norbapp.com`

LogiHERO is a pre-release application. It must be reachable at a friendly hostname without
appearing in search results.

**Nothing in this document has been applied.** No Render setting, DNS record or deployment was
changed as part of the work that introduced it.

## How exclusion is enforced

The primary mechanism is the HTTP response header, applied by `searchExclusionMiddleware` to
every response the application produces:

```
X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex
```

Server-rendered HTML additionally carries the equivalent markup in `<head>`:

```html
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex">
```

The meta tag is a secondary signal only. It cannot appear in a JSON API response, a CSV export or
an uploaded file, which is exactly why the header is the mechanism that is relied upon.

### Why `robots.txt` does not disallow anything

`/robots.txt` deliberately serves a permissive policy:

```
User-agent: *
Disallow:
```

A crawler has to be able to *fetch* a URL in order to see its `noindex` directive. `Disallow: /`
would block that fetch, so a URL discovered some other way — a shared link, a referrer, a
certificate transparency log — could still be listed as a bare result, with the `noindex` never
observed. Blocking the crawl would therefore make indexing *more* likely, not less.

The permissive file is served explicitly rather than left absent so the intent is visible in the
repository and the reflexive "just disallow everything" edit does not get made later.

### Host coverage

The header is applied to every request rather than being conditional on `Host`. This process only
ever answers for LogiHERO, so that covers `logihero.norbapp.com`, the Render `*.onrender.com`
hostname, and any future preview hostname, with no way for an unlisted host to leak into an index.
It cannot affect other NorbApp services, because their responses do not pass through this
middleware.

Exclusion is on by default and lifted by configuration, not by a code change:

```
SEARCH_INDEXING=allow    # only when the product is ready to be public
```

### API compatibility

`X-Robots-Tag` is a passive response header. It does not add authentication, alter status codes,
change response bodies, redirect anything, or touch CORS or authorization. Android clients and
device authentication are unaffected. No authentication gateway is introduced here; if one is ever
wanted in front of the preview, that is a separate decision.

## Deployment steps (not performed)

1. **Render → the LogiHERO service → Settings → Custom Domains**: add `logihero.norbapp.com`.
   Render will show the exact target hostname to point DNS at. **Take that value from Render —
   do not guess it.**
2. **Cloudflare DNS for `norbapp.com`**: create

   ```
   Type:   CNAME
   Name:   logihero
   Target: <the hostname Render displayed in step 1>
   TTL:    Auto
   ```

   Use the Render-provided target verbatim. Proxy mode is a separate decision; if the record is
   proxied, re-run the verification below through Cloudflare, since a proxy can alter headers.
3. **Verify the custom domain in Render** and wait for it to report verified.
4. **Verify HTTPS** — the certificate should be issued for `logihero.norbapp.com` and the site
   should load over TLS without warnings.
5. **Verify the header:**

   ```bash
   curl -I https://logihero.norbapp.com/admin
   curl -I https://logihero.norbapp.com/version
   ```

   Both must show `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex`.
   Check the Render hostname the same way.
6. **Verify the HTML directive:**

   ```bash
   curl -s -L https://logihero.norbapp.com/admin | grep -o 'name="robots" content="[^"]*"'
   curl -s https://logihero.norbapp.com/robots.txt
   ```

   The first must print the robots meta content; the second must not contain `Disallow: /`.
7. **Only then share the URL.** Until steps 5 and 6 pass against the live hostname, treat the
   address as unpublished.

## If the site was ever indexed

Removing a URL from an index needs the page to stay fetchable so the crawler can re-read the
`noindex`. Keep `robots.txt` permissive and use Search Console removals if it needs to be faster.
