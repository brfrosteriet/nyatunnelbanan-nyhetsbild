# Nyhetsbild: nya tunnelbanan i Liljeholmen

This repository produces **one image** that shows the four latest construction news
items for Liljeholmen from Region Stockholm's metro project, so the BRF website can
display them with nothing but an `<img>` tag.

The image is rebuilt automatically once a day and published to GitHub Pages. Nothing
else is needed: no server, no plugin, no accounts, no passwords. Everything runs on
GitHub's free tier.

**Live image:** https://brfrosteriet.github.io/nyatunnelbanan-nyhetsbild/nyheter.svg

**Debug page** (the same headlines as normal, clickable text, useful for checking that
the data is correct): https://brfrosteriet.github.io/nyatunnelbanan-nyhetsbild/

---

## Embed snippet for the CMS

Paste this where the news should appear. The whole image is one link to the source page.

```html
<a href="https://nyatunnelbanan.se/gul-linje/arbeten/liljeholmen/">
  <img src="https://brfrosteriet.github.io/nyatunnelbanan-nyhetsbild/nyheter.svg"
       alt="Senaste nyheterna om nya tunnelbanans arbeten i Liljeholmen. Klicka för att läsa mer på nyatunnelbanan.se."
       style="max-width:100%;height:auto">
</a>
```

---

## How it works

1. A scheduled GitHub Actions job runs `node build.mjs` once a day.
2. That script asks nyatunnelbanan.se for the latest news in the category
   **Aktuellt Liljeholmen** using their public API. No key or login is involved.
3. It draws those headlines and dates into an SVG image, `dist/nyheter.svg`, and also
   writes `dist/index.html` as a plain readable version.
4. GitHub Pages publishes both files at the URLs above.

Generated files are never committed to this repository. They are built fresh each run
and handed straight to GitHub Pages, which is why you will not find a `dist` folder here.

### Data source

The script reads exactly one address, defined as `API_URL` at the top of `build.mjs`:

```
https://nyatunnelbanan.se/wp-json/wp/v2/posts?categories=249&per_page=4&orderby=date&order=desc&_fields=date,title,link
```

`categories=249` is the taxonomy term **"Aktuellt Liljeholmen"** (a WordPress
*category*, not a tag). Verified against the "Aktuellt" list on
https://nyatunnelbanan.se/gul-linje/arbeten/liljeholmen/ : the API returns the same
headlines, in the same order.

---

## Everyday maintenance

### Trigger a rebuild by hand

You do not have to wait for the daily run.

1. Go to the **Actions** tab of this repository.
2. Pick **Build news image** in the left sidebar.
3. Click **Run workflow**, then the green **Run workflow** button.
4. Wait about a minute. A green check means the image has been updated.

### Change how many headlines are shown

In `build.mjs`, change `per_page=4` inside `API_URL` **and** the `MAX_ITEMS` constant
just below it to the same number. The image height adjusts itself.

### Change which news category is shown

If Region Stockholm reorganises their site, or the BRF wants news for a different
station, edit the number in `categories=249` inside `API_URL` in `build.mjs`.

To find the right number, open this address in a browser, replacing `249`:

```
https://nyatunnelbanan.se/wp-json/wp/v2/categories/249?_fields=id,name,slug,count
```

It should answer with the readable name of that category. If the answer is an error
such as `rest_no_route`, the number does not exist as a category. Try the same number
as a *tag* instead:

```
https://nyatunnelbanan.se/wp-json/wp/v2/tags/249?_fields=id,name,slug,count
```

If it is a tag, also change `categories=` to `tags=` in `API_URL`.

After editing, commit the change to the `main` branch. That alone triggers a rebuild.

### The heading, colours and size

All of it sits in clearly named constants at the top of `build.mjs`: `HEADING`,
`WIDTH`, `PAD`, the font sizes, and the `COLORS` block. The colours are taken from the
BRF website's own theme so the image does not look pasted in. The one exception is the
yellow bar down the left edge, which is the metro's yellow line colour (`#f5c700`).

---

## When something looks wrong

**The image is not updating.** First open the debug page:
https://brfrosteriet.github.io/nyatunnelbanan-nyhetsbild/
If the headlines there are current but the website still shows old ones, the CMS has
made its own copy of the image. See the first known limitation below.

**There is a red X on the Actions tab.** That is the intended alarm. It means
nyatunnelbanan.se could not be reached, or answered with nothing. The job stops
*before* publishing, so the website keeps showing the last image that worked. Slightly
old news is much better than an error message on a public website. Click the failed run
to read the reason. In most cases the next daily run fixes itself.

**Scheduled runs stop after 60 days.** GitHub disables scheduled jobs in public
repositories after 60 days without any repository activity, and sends an email before
doing so. To re-enable, open the Actions tab and press the button GitHub offers, or run
the workflow by hand as described above. Worth checking a few times a year.

---

## Known limitations

Please read these before relying on this.

- **The CMS may copy the image on save.** Many page builders download an external
  `<img src>` once and then serve their own copy, which never updates again. This must
  be verified in practice: embed the image, then change something visible and re-run
  the workflow by hand, and reload the page. If the image is frozen, this approach
  cannot work in that CMS.
- **If the CMS insists on a `.png` or `.jpg` file, this will not work.** GitHub Pages
  serves files according to their real extension and will not pretend an SVG is a PNG.
  Producing a real PNG needs image software that cannot run under a GitHub-only setup.
- **The text in the image is not real text.** It cannot be selected, searched or read
  by a screen reader beyond the `alt` text, and the individual headlines are not
  separately clickable. That is why the whole image is wrapped in one link to the
  source page.
- **Updates are delayed by up to about a day.** The job runs once daily, and GitHub
  Pages' own caching adds roughly ten minutes on top, which cannot be configured. Do
  not use this for urgent notices such as tomorrow's blasting times.
- **Fonts differ between operating systems.** The line breaks are calculated from an
  estimate of character widths, because SVG cannot break lines by itself. The result
  has been checked against real Helvetica/Arial metrics with a good margin to spare,
  but after changing the heading, the width or a font size, look at the image on both
  macOS and Windows.

---

## For a developer

No dependencies, no `package.json`, one script.

```sh
node build.mjs      # writes dist/nyheter.svg and dist/index.html
```

Requires Node with built-in `fetch` and full ICU (for Swedish month names). CI uses
Node 26. Note that Node 26 becomes an LTS release in October 2026; until then it is
the "Current" line. Bumping `node-version` in
[.github/workflows/build.yml](.github/workflows/build.yml) is safe.

If you would rather not install Node locally, this repository has a dev container
([.devcontainer/devcontainer.json](.devcontainer/devcontainer.json)). Open the folder
in VS Code and choose "Reopen in Container", or run the build in Docker directly:

```sh
docker run --rm -v "$PWD":/workspace -w /workspace -e TZ=Europe/Stockholm \
  mcr.microsoft.com/devcontainers/javascript-node:26-bookworm node build.mjs
```

Deployment uses the GitHub Pages artifact flow, configured under
**Settings > Pages > Source: GitHub Actions**. The workflow needs no secrets; its
`permissions:` block grants the Pages access it uses.
