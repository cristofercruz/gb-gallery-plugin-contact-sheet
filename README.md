# Contact Sheet — a GB‑Printer Web plugin

Arranges a selection of images into a single **contact sheet** (a grid of numbered
thumbnails) and lets you download it as **PNG / JPG / WebP**.

Built for [gb-printer-web](https://github.com/HerrZatacke/gb-printer-web) using the
[plugin API](https://github.com/HerrZatacke/gb-printer-web-plugins).

![example contact sheet](./example-contact-sheet.png)

Each thumbnail is rendered through the app's own pipeline, so it keeps each
image's palette and rotation and follows your global **handle export frame**
setting (keep / crop / square). Smaller/rotated images are
centred (letterboxed) so every cell lines up, and any image that fails to decode
gets a placeholder cell instead of breaking the whole sheet.

---

## Install (no build required)

The app loads plugins from a URL, so the single `contact-sheet.js` file is all you
need.

1. Host `contact-sheet.js` somewhere reachable over HTTPS. Any static host works —
   a GitHub Pages repo, a Gist served via `raw.githubusercontent.com`, an S3
   bucket, your own server, etc.
2. In the app, open **Settings → Plugins**
   (e.g. `https://herrzatacke.github.io/gb-printer-web/#/settings/plugins`).
3. Add the plugin by pasting its URL.
4. Optionally set the config values (see the table below).

> The file is a plain browser script (no imports/exports). You can also just drop
> it next to the app and point the URL at it locally.

## Usage

1. Select several images in the gallery (the plugin runs on a **selection**, not a
   single image).
2. Run **Contact Sheet** from the selection / batch menu.
3. A dialog appears with a **live preview** at the top and **every option below
   it**, pre‑filled with your current settings. Adjust anything (columns, scale,
   spacing, labels, header, colour, file type, …) and the preview updates as you
   go. Click **Ok** to download, or **Cancel** to dismiss.

Running it on a single image just shows a reminder to select several first.

### Options in the export dialog (and how they're saved)

Every setting from the plugin's settings panel is also exposed in the export
dialog, pre‑populated with its current value. When you click **Ok**, the values
you chose are **written back to the plugin's config**, so they become the new
defaults next time — both in the dialog and on the **Settings → Plugins** panel.

This works because the app stores each plugin's `config` object and persists it to
the browser's **IndexedDB**. After the plugin is registered, the store holds the
*same* config object the plugin instance uses, so the plugin updates it in place
(via `setConfig`, which does `Object.assign(this.config, …)`); the app then saves
that object to IndexedDB and hands it back on the next run. Edits therefore survive
reloads. (**Cancel** changes nothing.)

A few details worth knowing:

* **Numeric fields are text inputs.** The dialog's dedicated number control can't
  be pre‑filled with an existing value (it always starts at `0`), so the numeric
  options (`columns`, `scaleFactor`, `gutter`, `margin`) are shown as
  text fields holding your current number. They're validated/clamped on save.
* **The preview reflects every option**, including the **scale factor**: thumbnails
  are pre‑rendered once at load, so they don't re‑render at higher resolution in the
  preview, but the layout *proportions* update — with **scale gap & margin** off, the
  gap/margin are fixed output pixels, so they shrink relative to the
  thumbnails as the scale factor grows (exactly as they will in the exported file).
  With **scale gap & margin** on, the gap and margin scale together with the
  thumbnails, so those proportions stay constant. On **Ok** the sheet is fully
  re‑rendered at the chosen scale for the exported file.
* Values are stored clean: the saved config always holds normalised, in‑range
  numbers, so the Settings panel stays tidy.

### Scale gap & margin

When the `scaleGapMargin` setting is `1` (the default — a blank/unset value is
treated as `1`), the `gutter` and `margin` values are treated as **source pixels**
and multiplied by the `scaleFactor`, so the spacing scales together with the
thumbnails (e.g. a 4‑px gutter at 2× becomes 8 px). Set it to `0` to use `gutter`
and `margin` as literal output pixels instead.

---

## Configuration

All options are optional. They appear as editable fields **both** on the plugin's
settings panel **and** in the export dialog (pre‑filled, see above), and edits made
in either place are saved. The **Default** column is the value used when a field is
left blank.

| Option        | Type   | Default     | Description |
|---------------|--------|-------------|-------------|
| `columns`     | number | `5`         | Thumbnails per row. |
| `scaleFactor` | number | `1`         | Per‑thumbnail render scale, **integer only** (`1` = native GB size, `2` = 2×, …). Higher = sharper and larger file. |
| `gutter`      | number | `0`         | Spacing *between* thumbnails. Output pixels, or source pixels if **Scale gap & margin** is on (see below). |
| `margin`      | number | `0`         | Outer margin around the whole sheet, independent of the gutter. Output pixels, or source pixels if **Scale gap & margin** is on. |
| `background`  | string | `#1e1e1e`   | Sheet background colour (`#rgb` or `#rrggbb`). Label colour auto‑switches for light vs dark. |
| `labels`      | string | `none`      | What to print under each image: `number`, `title`, `created`, `number+title`, or `none`. |
| `sortBy`      | string | `selection` | Cell order: `selection` (as picked), `title`, or `created`. |
| `headerText`  | string | *(empty)*   | Optional title drawn across the top of the sheet. |
| `fileType`    | string | `png`       | Output format: `png`, `jpg`, or `webp`. PNG stays crisp; JPG/WebP are smaller but add compression noise on the busy dither. |
| `scaleGapMargin` | string | `1`      | `1` (or blank) = treat `gutter`/`margin` as source pixels and scale them by `scaleFactor`; `0` = use them as output pixels. In the export dialog this appears as a **Yes/No** dropdown (stored as `1`/`0`). |

The downloaded file is named `contact-sheet-<timestamp>.<ext>`.

### Example configurations

Closest to a classic contact sheet (the image above):

```json
{ "columns": 5, "scaleFactor": 2, "labels": "number", "background": "#0e0e12", "gutter": 16 }
```

With a header and image titles:

```json
{ "columns": 5, "labels": "number+title", "headerText": "CONTACT SHEET — gbcam" }
```

![example with header and titles](./example-with-header-and-titles.png)

---

## Developing / bundling in the plugins repo

If you'd rather build it alongside the other plugins in
[gb-printer-web-plugins](https://github.com/HerrZatacke/gb-printer-web-plugins),
the file is already written in that repo's style and passes its ESLint config
(airbnb) with no errors or warnings.

1. Copy the file into the repo:

   ```
   src/javascript/contact-sheet/index.js
   ```

2. Register it as a webpack entry in `scripts/webpack.common.js`, inside the
   `gbpWebPlugins` object:

   ```js
   const gbpWebPlugins = {
     // ...existing entries...
     contactSheet: path.join(process.cwd(), 'src', 'javascript', 'contact-sheet', 'index.js'),
   };
   ```

3. Build (`npm run build`) or run the dev server (`npm start`). The compiled file
   lands in `dist/contactSheet.js`, and the generated index page gets an "install"
   link for it.

Because the plugin uses no asset imports, the source file and the bundled output
are functionally identical — bundling just adds Babel transpilation for older
browsers.

> **Note on the IIFE wrapper.** When hosted directly (unbundled), the whole file
> is wrapped in an IIFE on purpose. The app installs a plugin by injecting a
> `<script>` tag, and it may inject the same script more than once (on reload,
> re-validation, or returning to the gallery). Top‑level `const`/`class`
> declarations in a classic script share the page's global scope, so a second
> injection would throw *"Can't create duplicate variable"*. The IIFE keeps every
> declaration function‑scoped, so the script is safe to load any number of times.
> When webpack bundles it, the wrapper is simply an extra (harmless) closure.

---

## How it works (brief)

* `withSelection(images)` loads each image's metadata (`getMeta`) and a rendered
  canvas (`getCanvas({ scaleFactor })`) in parallel, reporting
  progress as each resolves. It deliberately doesn't pass a frame mode, so each
  thumbnail follows the app's global **handle export frame** setting (keep / crop
  / square).
* It measures the largest thumbnail and lays out a uniform grid, centring each
  canvas in its cell and drawing labels beneath.
* **Pixel‑perfect rendering.** Game Boy Camera photos are pixel art, so image
  smoothing is disabled and thumbnails are only ever scaled by integer factors:
  they're drawn 1:1 in the sheet (the app already renders them at the integer
  `scaleFactor`), and the preview only ever
  downscales by an integer divisor with smoothing off. Nothing is anti‑aliased
  except the label/header text.
* The composed sheet is shown in a preview dialog (`functions.setDialog`) as an
  `image` question, with every option exposed as additional `text`/`select`
  questions pre‑filled from the current config. The preview is reactive (recomposed
  from the dialog values, memoised so identical states aren't redrawn).
* On **Ok** the chosen values are persisted with `setConfig` — which mutates the
  config object the app keeps in its store, so the app saves it to IndexedDB — and
  then the sheet is exported via `canvas.toBlob` to `saveAs` (re‑rendering the
  thumbnails first if the scale factor changed).
* Failures are isolated per image (placeholder cell) and surfaced via `setError`
  only if the whole operation fails.

## License

MIT
