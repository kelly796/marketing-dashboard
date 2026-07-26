# Netlify support ticket — modern Functions still hitting AWS Lambda's 4KB env-var limit

**Site:** monumental-syrniki-3b33aa (site id `1e5c7118-8333-4598-ab2d-f52506df749a`)
**Plan:** nf_team_pro

## Summary

Per your docs (https://docs.netlify.com/build/functions/lambda-compatibility/),
functions on the modern runtime should have "no 4KB limit" on total
environment variables, and should get automatic Netlify Blobs context. After
fully migrating every function in this site off the deprecated Lambda
compatibility mode, both of these still fail exactly as before.

## What we migrated

- Converted all 27 functions from CommonJS (`exports.handler`,
  `require(...)`, `module.exports`) to ES modules (`export const handler`,
  `import`). Added `"type": "module"` to `package.json`.
- Per your docs' explicit recommendation for functions that need to keep the
  AWS Lambda handler signature, wrapped every function's handler with
  `@netlify/aws-lambda-compat`'s `withLambda()` — each file exports both a
  plain named `handler` (for internal cross-file calls) and a
  `withLambda(handler)`-wrapped default export (what your runtime actually
  dispatches to).
- Verified locally before deploying: every file passes `node --check`, every
  file's imports resolve via real `import()` (including multi-file import
  chains), `netlify build` bundles all 27 functions cleanly, and a full local
  invocation of the main aggregator function with real credentials still
  returns correct live data.
- Deployed successfully (commits `49b3a5f` then `a994e21`), confirmed the
  live site still serves correct data afterward.

## Problem 1 — 4KB env var limit still enforced at function creation

With exactly 24 environment variables (our working baseline — combined
payload ~3657 bytes, `GOOGLE_PRIVATE_KEY`'s 1624-byte PEM key is most of it),
every deploy succeeds. Adding **any single additional environment variable**
— tested with a real API key, a harmless dummy value, different variable
names, `--context production` vs default all-contexts scoping, and both
`netlify api createSiteBuild` and a genuine `git push` deploy — fails
identically every time.

The real deploy log (only visible via the dashboard UI — the API's
`log_access_attributes` field and both `/api/v1/deploys/{id}/log` and
`/api/v1/builds/{id}` returned nothing usable for a finished deploy, tried
with a real extracted CLI auth token) shows the actual cause:

```
27 new function(s) to upload
Failed to create function: invalid parameter for function creation: Your environment variables exceed the 4KB limit imposed by AWS Lambda.
[... repeated for every one of the 27 functions ...]
Failed during stage 'building site': Build script returned non-zero exit code: 2
```

This is happening at the **function upload/creation step**, calling the real
AWS Lambda `CreateFunction` API — not during code bundling. Ruled out as
contributing factors: Secrets Scanning (tested `SECRETS_SCAN_ENABLED=false`
and `SECRETS_SCAN_SMART_DETECTION_ENABLED=false`, both still fail
identically), which specific variable, and deploy trigger method.

## Problem 2 — Netlify Blobs still reports "not configured" post-migration

Same error before and after the full migration:

```
The environment has not been configured to use Netlify Blobs. To use it
manually, supply the following properties when creating a store: siteID,
token
```

Live function logs after the migration deployed still show the function
invoked via `Runtime.handler` (the classic AWS Lambda Node.js runtime's own
internal wrapper name), suggesting the function is still fundamentally
provisioned as a plain Lambda regardless of the `export`/`withLambda()`
change.

## Question for support

What additional step (a site-level flag, a different functions-directory
convention, an account-side migration you need to run) is required to
actually move this site's functions onto the runtime that lifts the 4KB
limit and enables Blobs auto-context — given the code-level migration
your own docs describe didn't achieve either?
