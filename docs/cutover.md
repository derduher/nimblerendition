# Cutting the domain over to subpaths

Everything in the repos is done. This is the part that needs an AWS console or
a shell with credentials — there were none on the machine where the repo
changes were made, so none of it has been run.

Before: `blaster` and `finproc` both synced to the bucket root with `--delete`,
so whichever deployed last erased the other.

After:

| Path           | Repo                        | Deploys to             |
| -------------- | --------------------------- | ---------------------- |
| `/`            | `derduher/nimblerendition`  | bucket root, no delete |
| `/blaster/`    | `derduher/blaster`          | `blaster/`             |
| `/threadwell/` | `derduher/finproc`          | `threadwell/`          |
| `/hugos/`      | `derduher/hugos`            | `hugos/`               |

## 1. Confirm what is actually there

`finproc` invalidates a CloudFront distribution; `blaster` writes straight to
`s3://aws-website-blaster-2d3g4`. Confirm those are the same bucket and find the
distribution:

```bash
aws cloudfront list-distributions --query "DistributionList.Items[].{Id:Id,Aliases:Aliases.Items,Origin:Origins.Items[0].DomainName,Root:DefaultRootObject}" --output table
```

The `Origin` column decides the next step:

- ends in `s3-website-<region>.amazonaws.com` — **website endpoint**. S3 resolves
  `/blaster/` to `/blaster/index.html` on its own; skip step 2.
- ends in `s3.amazonaws.com` or `s3.<region>.amazonaws.com` — **REST endpoint**
  (the usual OAC setup). It has no notion of an index document in a prefix, so
  `/blaster/` returns an error until you do step 2.

Also note `DefaultRootObject`. It should be `index.html`; it only ever applies to
`/`, never to `/blaster/`.

## 2. Subdirectory indexes (REST origin only)

Attach a CloudFront **viewer request** function to the default behavior:

The function lives in [infra/subdir-index.js](../infra/subdir-index.js):
`/blaster/` becomes `/blaster/index.html`, and `/hugos/stats` becomes
`/hugos/stats/index.html`, which is the shape the Next export produces
(`trailingSlash: true`). Requests that already name a file are left alone.

```bash
ETAG=$(aws cloudfront create-function --name subdir-index \
  --function-config Comment="append index.html to directory URIs",Runtime=cloudfront-js-2.0 \
  --function-code fileb://infra/subdir-index.js \
  --query 'ETag' --output text)

aws cloudfront publish-function --name subdir-index --if-match "$ETAG"
```

Then associate the published function with the default cache behavior as
**viewer request** — in the console under **Behaviors › Function associations**,
which is less error-prone than rewriting the whole distribution config by hand.

## 3. Let the two new repos assume the deploy role

`finproc` already deploys over OIDC. `hugos` and `nimblerendition` use the same
role, so its trust policy has to name them too. Find it:

```bash
gh variable list --repo derduher/finproc   # AWS_ROLE_ARN, S3_BUCKET, CLOUDFRONT_DISTRIBUTION_ID
aws iam get-role --role-name <role> --query 'AssumeRolePolicyDocument'
```

Add the two repos to the `token.actions.githubusercontent.com:sub` condition.
**GitHub issues two different spellings of that claim**, and which one a repo
gets depends on when it was created:

```
repo:derduher/finproc:environment:Production                       # older repos
repo:derduher@1011092/hugos@1337966646:environment:Production      # newer repos
```

The second form embeds the immutable owner and repository IDs, so it survives a
rename and cannot be claimed by a recreated repo of the same name. A trust
policy written only against the plain form fails with `Not authorized to
perform sts:AssumeRoleWithWebIdentity` and no hint as to why — the claim the
run actually presented is visible in CloudTrail:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --max-results 3 --region us-east-1 --query 'Events[].CloudTrailEvent' --output text
```

The role now lists both spellings for all three repos. Get a new repo's IDs with
`gh api users/<owner> --jq .id` and `gh api repos/<owner>/<repo> --jq .id`, and
note that a job with `environment: Production` presents the `:environment:` form,
not the `:ref:` one.

If the role's permission policy scopes `s3:PutObject` to a prefix, widen it to
the whole bucket (or add `hugos/*` and the root objects). Check it before the
first deploy of either new repo:

```bash
aws iam list-role-policies --role-name <role>
aws iam get-role-policy --role-name <role> --policy-name <policy>
```

`blaster` still deploys with the old access-key user and its own hardcoded
bucket name, so it needs nothing here.

## 4. Set the Actions variables on the new repos

Both new workflows read `AWS_ROLE_ARN`, `S3_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`
and optionally `AWS_REGION` from a `Production` environment, matching `finproc`:

```bash
for repo in derduher/hugos derduher/nimblerendition; do
  gh api -X PUT "repos/$repo/environments/Production" >/dev/null
  gh variable set AWS_ROLE_ARN --repo "$repo" --env Production --body "<role arn>"
  gh variable set S3_BUCKET --repo "$repo" --env Production --body "aws-website-blaster-2d3g4"
  gh variable set CLOUDFRONT_DISTRIBUTION_ID --repo "$repo" --env Production --body "<distribution id>"
done
```

## 5. Deploy, in this order

1. **blaster** — merge to `master`. Publishes `/blaster/`; the root is untouched
   and still serves whatever is there now.
2. **finproc** — merge to `main`. Publishes `/threadwell/`. Note its
   invalidation is now scoped to `/threadwell/*`.
3. **hugos** — push the repo and merge. Publishes `/hugos/`.
4. **nimblerendition** — push. Overwrites the root `index.html` with the landing
   page and the root `sw.js` with the tombstone worker.

Check each one before moving on. Until step 4 the root is still whatever the
last old deploy left, which is expected.

## 6. Delete the old root objects

Steps 1–4 leave the previous root deploy's files lying around — an `assets/`
directory both apps wrote into, blaster's icons and manifest, and its Workbox
runtime. Look first:

```bash
aws s3 ls "s3://aws-website-blaster-2d3g4/"
aws s3 ls "s3://aws-website-blaster-2d3g4/assets/"
```

Expected to keep at the root: `index.html`, `sw.js`, `favicon.svg`, and the four
prefixes. Everything else at the root is stale. Delete it deliberately, one
thing at a time — **never** `aws s3 rm --recursive` at the root, which would take
the apps with it:

```bash
aws s3 rm "s3://aws-website-blaster-2d3g4/assets/" --recursive   # old shared asset dir
aws s3 rm "s3://aws-website-blaster-2d3g4/icon-192.png"
aws s3 rm "s3://aws-website-blaster-2d3g4/icon-512.png"
aws s3 rm "s3://aws-website-blaster-2d3g4/manifest.json"
aws s3 rm "s3://aws-website-blaster-2d3g4/workbox-<hash>.js"    # name from the ls above
```

Leave the root `sw.js` in place — it is the tombstone now, and deleting it would
strand every browser still holding the old root worker.

Then invalidate everything once:

```bash
aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
```

## 7. Also check CodeBuild

`blaster/buildspec.yml` is still wired to an AWS CodeBuild project. If that
project's artifact destination is this bucket's root, it will keep re-littering
the root after every build. Point it at the `blaster/` prefix or disable it —
GitHub Actions already deploys the game.

## 8. Verify

```bash
for path in / /blaster/ /threadwell/ /hugos/ /hugos/stats/; do
  echo "$path -> $(curl -s -o /dev/null -w '%{http_code}' "https://nimblerendition.com$path")"
done
```

All five should be `200`. Then, in a browser:

- The root shows the landing page and all three links work.
- DevTools › Application › Service Workers on `https://nimblerendition.com/`
  shows no worker registered for scope `/` after a reload (the tombstone
  unregisters itself on activation, so the first load may still show it briefly).
- `/blaster/` shows one worker, scope `/blaster/`.
- A browser that played blaster before the cutover lands on the landing page,
  not the game. This is the case worth testing on a real device that has played
  it — the tombstone exists only for that browser.

## Rolling back

Every app's files stay in its own prefix, so a rollback is just re-pointing the
root: put the old `index.html` back at the bucket root and invalidate. Do not
roll back `site/sw.js` — once a browser has picked up the tombstone the old
worker is gone, and re-publishing the old one would install a root-scoped worker
all over again.
