# Deploying the A380 figure

The figure is a static site: a folder of files with no server code, no build step on the host and no requests to
anything outside it. `a380/tools/build-site.mjs` writes it to `a380/dist/` (ignored by git); copy that folder to any
static host. Nothing in this repository deploys it.

## Build the folder

From the repository root (Node 26; nothing to install):

```sh
node a380/tools/build-site.mjs --url https://example.com/a380/            # from the shipping pages a380/a380*.html
node a380/tools/build-site.mjs --rebuild --url https://example.com/a380/  # rebuild both pages from the working tree first
```

- `--url` is the address the folder will be served from, with its subpath and a trailing slash. It makes the link
  preview tags absolute (`og:image`, `og:url`, `twitter:image`: Facebook, LinkedIn and others need absolute image
  URLs), and adds a canonical link, `sitemap.xml` and a `Sitemap:` line in `robots.txt`. Without it every link is
  relative and the folder works from any path, but link previews may show no image.
- The card images (`og-a380-dark` and `og-a380-light`, 1200 × 630, the take-off in each theme) and the PNG icons are
  captured in headless Chrome the first time a pair of pages is built, and kept in `a380/tmp/site-shots/`. Look at them
  before you publish.
- The build prints every file's raw, gzip and brotli size.

What is in the folder:

| File | What it is |
|---|---|
| `index.html` | Picks the theme (the visitor's stored choice, else `prefers-color-scheme`) and replaces itself with that page, keeping the rest of the query and the hash. `?theme=dark` or `?theme=light` forces and stores one. Without JavaScript it shows both links and a still. |
| `a380.html`, `a380-light.html` | The figure, dark (night) and light (day). Each is one self-contained file. A bar under the figure and its caption switches theme (and remembers it, and keeps the query, e.g. `?quality=full`) and links to the credits. |
| `credits.html` | Not affiliated with Airbus; trademarks; the Anatomy kit's MIT licence; the sources. |
| `404.html` | The not-found page (Cloudflare Pages, Netlify and GitHub Pages serve it by name). |
| `assets/` | Icons, the web manifest and the card images. Names carry a content hash, so they can be cached for a year. |
| `robots.txt`, `sitemap.xml` | Crawlers (the sitemap only with `--url`). |
| `_headers` | Cache and security headers for Cloudflare Pages and Netlify. |
| `vercel.json` | The same headers for Vercel. |
| `.nojekyll` | Tells GitHub Pages to serve the folder as it is. |

## Headers to set

| Path | Header | Why |
|---|---|---|
| `/assets/*` | `Cache-Control: public, max-age=31536000, immutable` | the names change when the content changes |
| `*.html`, `/` | `Cache-Control: public, max-age=0, must-revalidate` | a new build shows at once; unchanged pages answer 304 |
| everything | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` | hygiene |
| text files | `Content-Encoding: br` (or `gzip`) | the pages shrink to about 46% (brotli) or 49% (gzip) |

**Compression matters most.** Each figure page is about 1.8 MB raw and about 0.83 MB with brotli. Every host below
compresses HTML on its own; check that a response for `a380.html` carries `content-encoding: br` or `gzip`
(`curl -sI -H 'Accept-Encoding: br, gzip' https://example.com/a380/a380.html`). Do not minify or re-encode the pages:
they carry their data as base64 inside the HTML and their own source stamp.

**Under a subpath** the `_headers` and `vercel.json` patterns are relative to the deployed folder's root when the folder
is the site's root. If the folder is served from a subpath of a larger site, prefix the patterns (`/a380/assets/*`).

## Cloudflare Pages

1. Dashboard: Workers & Pages → Create → Pages → Upload assets; name the project and upload `a380/dist`. Or with
   Wrangler: `npx wrangler pages deploy a380/dist --project-name a380`.
2. `_headers` and `404.html` are read automatically. Cloudflare compresses with brotli or gzip for browsers that ask.
3. Custom domain: the project → Custom domains → Set up a domain.

## Netlify

1. Drag `a380/dist` onto app.netlify.com/drop, or `npx netlify-cli deploy --dir a380/dist --prod`.
2. `_headers` and `404.html` are read automatically; Netlify serves brotli and gzip.
3. Custom domain: Site configuration → Domain management.

## Vercel

1. `cd a380/dist && npx vercel --prod` (framework preset: Other; no build command; output directory: `.`).
2. `vercel.json` sets the headers; Vercel compresses with brotli or gzip and serves `404.html` for missing paths.
3. Custom domain: the project → Settings → Domains.

## GitHub Pages

1. Put the contents of `a380/dist` (with `.nojekyll`) on a `gh-pages` branch, or upload it with the
   `actions/upload-pages-artifact` and `actions/deploy-pages` actions; Settings → Pages → Source.
2. GitHub Pages serves gzip but ignores `_headers`: it sends `Cache-Control: max-age=600` for everything, which is
   acceptable (the hashed assets just revalidate more often). Put Cloudflare in front for custom headers and brotli.
3. A project site lives under `https://<user>.github.io/<repo>/`: build with that as `--url`.

## Any other server

Serve the folder as static files with brotli or gzip for text, the headers above, and `404.html` for missing paths. To
try the folder locally the way a host serves it (subpath, compression, `_headers`, 404), on a port of your own:

```sh
node a380/tools/serve-site.mjs --port 8741 --base /a380/     # http://127.0.0.1:8741/a380/
node a380/tools/site-check.mjs --timing http://127.0.0.1:8741/a380/a380.html   # cold-load times, desktop and phone
node a380/tools/site-check.mjs --nojs http://127.0.0.1:8741/a380/              # the pages with JavaScript off
node a380/tools/site-check.mjs --layout http://127.0.0.1:8741/a380/            # the site bar on screen at 320 to 1440 px, 44 px
                                                                               # touch links, the card not moved by the site layer
```

## Before you publish

- Build with `--url` set to the real address (build-site prints a WARNING when the link-preview image URLs are relative:
  Facebook, Slack, X and LinkedIn need them absolute), and look at the two card images and at the pages in both themes.
- Run `site-check.mjs --layout` and `--nojs` on the folder served by `serve-site.mjs`; both end `site-check: passed`.
- The figure needs JavaScript (a message and a still show without it) and runs without WebGL (the lights are drawn more
  simply; a note says so). It needs `DecompressionStream`: Chrome or Edge 80+, Firefox 113+, Safari 16.4+; older
  browsers get a "could not start" note and the still.
- The pages ask nothing of the network. If you set a Content-Security-Policy, allow their inline scripts and styles:
  `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:`
  (they use no `eval`, workers or remote origins).
- The credits page says the figure is not affiliated with Airbus. The figure's own licence (as opposed to the kit's) is
  for the owner to state.
