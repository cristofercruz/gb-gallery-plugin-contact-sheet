/*!
 * Contact Sheet Plugin for the GB-Printer Web App
 * https://github.com/HerrZatacke/gb-printer-web
 *
 * Arranges a selection of images into a single "contact sheet" (a grid of
 * numbered thumbnails) and lets you download it as PNG / JPG / WebP.
 *
 * Install (no build needed): host this file and add its URL under
 *   Settings -> Plugins
 *   e.g. https://herrzatacke.github.io/gb-printer-web/#/settings/plugins
 *
 * Usage: select several images in the gallery, then run "Contact Sheet" from
 * the selection menu. A preview dialog appears; click "Ok" to download.
 *
 * Written as a plain browser script (no imports/exports), so it works both
 * hosted directly and bundled inside the gb-printer-web-plugins repo.
 *
 * @license MIT
 */

(function contactSheetPlugin() {
  const clampInt = (value, fallback, min, max) => {
    let n = parseInt(value, 10);
    if (!isFinite(n)) {
      n = fallback;
    }

    if (typeof min === 'number' && n < min) {
      n = min;
    }

    if (typeof max === 'number' && n > max) {
      n = max;
    }

    return n;
  };

  // Parse a #rgb / #rrggbb string into [r, g, b] (0-255). Falls back to dark.
  const hexToRgb = (hex) => {
    const fallback = [15, 15, 20];
    if (typeof hex !== 'string') {
      return fallback;
    }

    let h = hex.trim().replace(/^#/, '');
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }

    if (!(/^[0-9a-fA-F]{6}$/).test(h)) {
      return fallback;
    }

    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };

  // Relative luminance (0..1), used to pick legible label/placeholder colors.
  const luminance = (rgb) => {
    const srgb = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : (((c + 0.055) / 1.055) ** 2.4);
    });
    return (0.2126 * srgb[0]) + (0.7152 * srgb[1]) + (0.0722 * srgb[2]);
  };

  const pad2 = (n) => String(n).padStart(2, '0');

  // Format an ISO date string into a compact, readable label.
  const formatCreated = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return String(iso || '');
    }

    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  const timestamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

  // Allowed values for the SELECT-style options (also used to build the dialog).
  const LABELS_OPTIONS = ['number', 'title', 'created', 'number+title', 'none'];
  const SORT_OPTIONS = ['selection', 'title', 'created'];
  const FILETYPE_OPTIONS = ['png', 'jpg', 'webp'];

  // Frame handling. These string values are the gb-image-decoder ExportFrameMode
  // values that image.getCanvas({ handleExportFrame }) accepts. 'default' is our
  // own sentinel meaning "omit handleExportFrame", i.e. use the app's global
  // "handle export frame" setting.
  const FRAME_MODES = ['keep', 'crop', 'square_black', 'square_white'];
  const FRAME_MODE_LABELS = {
    keep: 'Keep frame',
    crop: 'Crop frame',
    square_black: 'make image squared (add black)',
    square_white: 'Make image squared (add white)',
  };

  const normalizeFrameMode = (raw) => {
    const v = (raw || '').toString().trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (FRAME_MODES.indexOf(v) !== -1) {
      return v;
    }

    return 'default'; // blank, "default", or anything unknown -> use the app default
  };

  // Read the app's global "handle export frame" setting from its persisted
  // settings (zustand-persist in localStorage). Falls back to the app default.
  const appDefaultFrameMode = () => {
    try {
      const raw = window.localStorage.getItem('gbp-z-web-settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        const mode = parsed && parsed.state && parsed.state.handleExportFrame;
        if (FRAME_MODES.indexOf(mode) !== -1) {
          return mode;
        }
      }
    } catch (error) {
      // ignore parse/storage errors and fall back
    }

    return 'keep'; // gb-printer-web's own default for handleExportFrame
  };

  const fileTypeInfo = (raw) => {
    switch ((raw || '').toString().trim().toLowerCase()) {
      case 'jpg':
      case 'jpeg':
        return { fileType: 'jpg', mimeType: 'image/jpeg', quality: 0.92 };
      case 'webp':
        return { fileType: 'webp', mimeType: 'image/webp', quality: 0.92 };
      default:
        return { fileType: 'png', mimeType: 'image/png', quality: undefined };
    }
  };

  // Used for the "scale gap & margin" flag. Blank/unset is treated as Yes (1);
  // only an explicit no/off/0/false turns it off.
  const flagDefaultYes = (raw) => {
    const v = (raw === undefined || raw === null) ? '' : raw.toString().trim().toLowerCase();
    return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
  };

  // Turn a raw config-values object into a fully-normalised settings object.
  // Used both for the live instance (setConfig) and to render the dialog preview.
  const normalizeConfig = (raw) => {
    const cfg = raw || {};
    const ft = fileTypeInfo(cfg.fileType);
    const labels = ((cfg.labels || '').toString().trim().toLowerCase()) || 'none';
    const sortBy = ((cfg.sortBy || '').toString().trim().toLowerCase()) || 'selection';

    return {
      columns: clampInt(cfg.columns, 5, 1, 100),
      scaleFactor: clampInt(cfg.scaleFactor, 1, 1, 10),
      gutter: clampInt(cfg.gutter, 0, 0, 400),
      margin: clampInt(cfg.margin, 0, 0, 1000),
      background: ((cfg.background || '').toString().trim()) || '#1e1e1e',
      labels: LABELS_OPTIONS.indexOf(labels) === -1 ? 'none' : labels,
      sortBy: SORT_OPTIONS.indexOf(sortBy) === -1 ? 'selection' : sortBy,
      headerText: (cfg.headerText || '').toString(),
      frameMode: normalizeFrameMode(cfg.frameMode),
      scaleGapMargin: flagDefaultYes(cfg.scaleGapMargin),
      fileType: ft.fileType,
      mimeType: ft.mimeType,
      quality: ft.quality,
    };
  };

  // Effective gutter/margin in output pixels for a given settings + scale factor.
  const effectiveSpacing = (settings, scaleFactor) => ({
    gutter: settings.scaleGapMargin ? settings.gutter * scaleFactor : settings.gutter,
    margin: settings.scaleGapMargin ? settings.margin * scaleFactor : settings.margin,
  });

  // Build a (possibly downscaled) data URL for the preview dialog.
  // Any downscale uses an integer divisor with smoothing off, so the preview
  // stays pixel-perfect and is never anti-aliased.
  const previewSrc = (canvas, mimeType, quality) => {
    const maxPreviewW = 1100;
    const toUrl = (cnv) => (
      quality === undefined ? cnv.toDataURL(mimeType) : cnv.toDataURL(mimeType, quality)
    );

    const divisor = Math.max(1, Math.ceil(canvas.width / maxPreviewW));
    if (divisor === 1) {
      return toUrl(canvas);
    }

    const small = document.createElement('canvas');
    small.width = Math.round(canvas.width / divisor);
    small.height = Math.round(canvas.height / divisor);
    const sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    sctx.webkitImageSmoothingEnabled = false;
    sctx.mozImageSmoothingEnabled = false;
    sctx.msImageSmoothingEnabled = false;
    sctx.drawImage(canvas, 0, 0, small.width, small.height);
    return toUrl(small);
  };

  class ContactSheetPlugin {
    constructor(env, config) {
      this.name = 'Contact Sheet';
      this.description = 'Arrange selected images into a printable grid of numbered thumbnails (PNG / JPG / WebP).';

      this.configParams = {
        columns: {
          label: 'Columns (thumbnails per row)',
          type: 'number',
        },
        scaleFactor: {
          label: 'Thumbnail render scale (1x, 2x, ...)',
          type: 'number',
        },
        gutter: {
          label: 'Spacing between thumbnails (px)',
          type: 'number',
        },
        margin: {
          label: 'Outer margin around the whole sheet (px)',
          type: 'number',
        },
        background: {
          label: 'Background color (hex, e.g. #1e1e1e)',
          type: 'string',
        },
        labels: {
          label: 'Labels: "number", "title", "created", "number+title" or "none"',
          type: 'string',
        },
        sortBy: {
          label: 'Order: "selection", "title" or "created"',
          type: 'string',
        },
        headerText: {
          label: 'Optional title drawn across the top',
          type: 'string',
        },
        fileType: {
          label: 'Output file type: "png", "jpg" or "webp"',
          type: 'string',
        },
        frameMode: {
          label: 'Frame handling: "keep", "crop", "square_white" or "square_black" (blank = use the app\u2019s global frame setting)',
          type: 'string',
        },
        scaleGapMargin: {
          label: 'Scale gap & margin with the scale factor: 1/blank = on (treat them as source pixels), 0 = off',
          type: 'string',
        },
      };

      this.config = {};
      this.setConfig(config || {});

      // env wiring (see gb-printer-web /src/types/Plugin.ts)
      this.saveAs = env.saveAs;
      this.progress = env.progress;
      this.setError = env.setError;
      this.setDialog = env.functions.setDialog;
      this.dismissDialog = env.functions.dismissDialog;
      this.alertFn = env.functions.alert;
    }

    alert(text) {
      this.alertFn(this.name, text);
    }

    setConfig(configUpdate) {
      // Object.assign keeps the same this.config object reference. After the app
      // has registered the plugin, the store holds that same object, so mutating
      // it here also updates (and persists) the plugin config in IndexedDB.
      Object.assign(this.config, configUpdate);

      const s = normalizeConfig(this.config);
      this.columns = s.columns;
      this.scaleFactor = s.scaleFactor;
      this.gutter = s.gutter;
      this.margin = s.margin;
      this.background = s.background;
      this.labels = s.labels;
      this.sortBy = s.sortBy;
      this.headerText = s.headerText;
      this.frameMode = s.frameMode;
      this.scaleGapMargin = s.scaleGapMargin;
      this.fileType = s.fileType;
      this.mimeType = s.mimeType;
      this.quality = s.quality;
    }

    // Single-image action: a contact sheet needs a selection.
    withImage() {
      this.alert('Select several images first, then run "Contact Sheet" on the selection.');
    }

    // Load every selected image's rendered canvas + metadata, tolerating failures.
    loadCells(images) {
      let done = 0;
      const total = images.length;

      // Render at the configured scale. The frame mode is applied via
      // handleExportFrame; when it's 'default' we omit it so getCanvas falls back
      // to the app's global "handle export frame" setting.
      const canvasOptions = { scaleFactor: this.scaleFactor };
      if (this.frameMode !== 'default') {
        canvasOptions.handleExportFrame = this.frameMode;
      }

      const tick = () => {
        done += 1;
        // keep progress strictly between 0 and 1 (0/1 would close the overlay)
        this.progress(Math.min(0.99, Math.max(0.01, done / total)));
      };

      return Promise.all(images.map((image, index) => {
        const loadMeta = image.getMeta().catch(() => ({}));
        const loadCanvas = image.getCanvas(canvasOptions).catch(() => null);

        return Promise.all([loadMeta, loadCanvas]).then((res) => {
          tick();
          return { index, meta: res[0] || {}, canvas: res[1] };
        });
      }));
    }

    // Order cells according to the given sort mode.
    sortCells(cells, sortBy) {
      const sorted = cells.slice();
      if (sortBy === 'title') {
        sorted.sort((a, b) => String(a.meta.title || '').localeCompare(String(b.meta.title || '')));
      } else if (sortBy === 'created') {
        sorted.sort((a, b) => String(a.meta.created || '').localeCompare(String(b.meta.created || '')));
      }

      return sorted;
    }

    labelFor(cell, position, labels) {
      const number = String(position + 1);
      const title = String(cell.meta.title || '').trim();
      switch (labels) {
        case 'none':
          return '';
        case 'title':
          return title || number;
        case 'created':
          return formatCreated(cell.meta.created);
        case 'number+title':
          return title ? `${number}  ${title}` : number;
        case 'number':
        default:
          return number;
      }
    }

    // Compose the grid onto a fresh canvas and return it. `settings` is a
    // normalised settings object whose `gutter`/`margin` are already the
    // effective output pixels to use.
    compose(cells, settings) {
      const bgRgb = hexToRgb(settings.background);
      const isDark = luminance(bgRgb) < 0.5;
      const labelColor = isDark ? 'rgba(206,210,222,0.92)' : 'rgba(22,22,30,0.92)';
      const headerColor = isDark ? '#eef0f6' : '#15151c';
      const placeholderColor = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.20)';

      // Uniform cell size = largest thumbnail; smaller ones are centered/letterboxed.
      let maxW = 0;
      let maxH = 0;
      cells.forEach((cell) => {
        const w = cell.canvas ? cell.canvas.width : (160 * settings.scaleFactor);
        const h = cell.canvas ? cell.canvas.height : (144 * settings.scaleFactor);
        if (w > maxW) {
          maxW = w;
        }

        if (h > maxH) {
          maxH = h;
        }
      });
      maxW = maxW || 160;
      maxH = maxH || 144;

      const fontFamily = 'ui-monospace, "DejaVu Sans Mono", "Menlo", "Consolas", monospace';
      const labelFontPx = Math.max(11, Math.round(maxW * 0.058));
      const labelBand = settings.labels === 'none' ? 0 : Math.round(labelFontPx * 1.9);
      const headerFontPx = Math.max(16, Math.round(maxW * 0.10));

      const cellW = maxW;
      const cellH = maxH + labelBand;
      const cols = settings.columns;
      const rows = Math.ceil(cells.length / cols);
      const g = settings.gutter; // spacing between thumbnails (effective output px)
      const m = settings.margin; // outer margin around the whole sheet (effective output px)

      const headerText = settings.headerText.trim();
      const headerHeight = headerText ? Math.round(headerFontPx * 1.4) : 0;
      const contentTop = m + (headerHeight ? (headerHeight + g) : 0);

      const sheetW = (2 * m) + (cols * cellW) + ((cols - 1) * g);
      const sheetH = contentTop + (rows * cellH) + ((rows - 1) * g) + m;

      const canvas = document.createElement('canvas');
      canvas.width = sheetW;
      canvas.height = sheetH;
      const ctx = canvas.getContext('2d');

      // Game Boy Camera photos are pixel art: images must never be smoothed or
      // anti-aliased. imageSmoothingEnabled only affects drawImage scaling (not
      // text or rectangles), so it is safe to leave off for the whole render.
      ctx.imageSmoothingEnabled = false;
      ctx.webkitImageSmoothingEnabled = false;
      ctx.mozImageSmoothingEnabled = false;
      ctx.msImageSmoothingEnabled = false;

      // Background
      ctx.fillStyle = settings.background;
      ctx.fillRect(0, 0, sheetW, sheetH);

      // Header
      if (headerHeight) {
        ctx.fillStyle = headerColor;
        ctx.font = `700 ${headerFontPx}px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(headerText, sheetW / 2, m + (headerHeight / 2));
      }

      cells.forEach((cell, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cellX = m + (col * (cellW + g));
        const cellY = contentTop + (row * (cellH + g));

        if (cell.canvas) {
          const imgX = cellX + Math.round((cellW - cell.canvas.width) / 2);
          const imgY = cellY + Math.round((maxH - cell.canvas.height) / 2);
          ctx.drawImage(cell.canvas, imgX, imgY);
        } else {
          // Placeholder for an image that failed to render.
          ctx.strokeStyle = placeholderColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(cellX + 0.5, cellY + 0.5, cellW - 1, maxH - 1);
          ctx.fillStyle = labelColor;
          ctx.font = `${Math.max(11, Math.round(maxW * 0.07))}px ${fontFamily}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', cellX + (cellW / 2), cellY + (maxH / 2));
        }

        // Label
        const text = this.labelFor(cell, i, settings.labels);
        if (text && labelBand) {
          ctx.fillStyle = labelColor;
          ctx.font = `${labelFontPx}px ${fontFamily}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const maxTextWidth = cellW - 6;
          let label = text;
          // Ellipsize overly long labels so they don't bleed into neighbors.
          if (ctx.measureText(label).width > maxTextWidth) {
            while (label.length > 1 && ctx.measureText(`${label}…`).width > maxTextWidth) {
              label = label.slice(0, -1);
            }

            label += '…';
          }

          ctx.fillText(label, cellX + (cellW / 2), cellY + maxH + (labelBand / 2));
        }
      });

      return canvas;
    }

    saveCanvas(canvas) {
      return new Promise((resolve) => {
        const fileName = `contact-sheet-${timestamp()}.${this.fileType}`;
        const finish = () => {
          this.dismissDialog();
          resolve();
        };

        if (typeof canvas.toBlob === 'function') {
          const onBlob = (blob) => {
            if (blob) {
              this.saveAs(blob, fileName);
            }

            finish();
          };

          if (this.quality === undefined) {
            canvas.toBlob(onBlob, this.mimeType);
          } else {
            canvas.toBlob(onBlob, this.mimeType, this.quality);
          }

          return;
        }

        // Very old fallback: derive a blob from the data URL.
        try {
          const dataUrl = this.quality === undefined ?
            canvas.toDataURL(this.mimeType) :
            canvas.toDataURL(this.mimeType, this.quality);
          const binary = atob(dataUrl.split(',')[1]);
          const array = new Uint8Array(binary.length);
          for (let k = 0; k < binary.length; k += 1) {
            array[k] = binary.charCodeAt(k);
          }

          this.saveAs(new Blob([array], { type: this.mimeType }), fileName);
        } catch (error) {
          this.setError(error);
        }

        finish();
      });
    }

    withSelection(images) {
      if (!images || images.length === 0) {
        this.alert('No images selected.');
        return Promise.resolve();
      }

      this.progress(0.01);

      // Thumbnails are rendered once at the current scale factor and frame mode.
      // Changing either in the dialog re-renders them on confirm (see below).
      const loadedScaleFactor = this.scaleFactor;
      const loadedFrameMode = this.frameMode;
      const initialRaw = { ...this.config };

      return this.loadCells(images)
        .then((cells) => {
          const init = normalizeConfig(this.config);

          // --- option fields, seeded from the current config -----------------
          const numberField = (key, label, value) => ({
            type: 'text', label, key, initialValue: String(value),
          });
          const selectField = (key, label, optionValues, current, labelOf) => ({
            type: 'select',
            label,
            key,
            options: optionValues.map((value) => ({
              name: labelOf ? labelOf(value) : value,
              value,
              selected: value === current,
            })),
          });

          // Frame handling, with an extra "use app default" option at the top
          // whose label spells out the app's current global frame behaviour.
          const appFrame = appDefaultFrameMode();
          const frameOptions = [
            { name: `Use app default setting (${FRAME_MODE_LABELS[appFrame]})`, value: 'default' },
            { name: FRAME_MODE_LABELS.keep, value: 'keep' },
            { name: FRAME_MODE_LABELS.crop, value: 'crop' },
            { name: FRAME_MODE_LABELS.square_white, value: 'square_white' },
            { name: FRAME_MODE_LABELS.square_black, value: 'square_black' },
          ].map((o) => ({ ...o, selected: o.value === init.frameMode }));

          const optionQuestions = [
            numberField('columns', 'Columns', init.columns),
            numberField('scaleFactor', 'Thumbnail scale factor (×)', init.scaleFactor),
            { type: 'select', label: 'Frame', key: 'frameMode', options: frameOptions },
            numberField('gutter', 'Gap between thumbnails (px)', init.gutter),
            numberField('margin', 'Outer margin (px)', init.margin),
            selectField('scaleGapMargin', 'Scale gap & margin by the scale factor',
              ['1', '0'], init.scaleGapMargin ? '1' : '0', (v) => (v === '1' ? 'Yes' : 'No')),
            { type: 'text', label: 'Background colour (hex)', key: 'background', initialValue: init.background },
            selectField('labels', 'Labels', LABELS_OPTIONS, init.labels),
            selectField('sortBy', 'Order', SORT_OPTIONS, init.sortBy),
            { type: 'text', label: 'Header text (optional)', key: 'headerText', initialValue: init.headerText },
            selectField('fileType', 'File type', FILETYPE_OPTIONS, init.fileType, (v) => v.toUpperCase()),
          ];

          // --- live preview, memoised by the values that affect it -----------
          let cacheKey = null;
          let cacheSrc = null;
          const renderPreview = (values) => {
            const s = normalizeConfig({ ...initialRaw, ...values });
            const key = JSON.stringify([
              s.columns, s.gutter, s.margin, s.scaleFactor,
              s.background, s.labels, s.sortBy, s.headerText, s.scaleGapMargin,
            ]);
            if (key === cacheKey) {
              return cacheSrc;
            }

            const ordered = this.sortCells(cells, s.sortBy);
            // Thumbnails are pre-rendered at the loaded scale factor, but the
            // chosen scale factor still changes the layout: gutter/margin are fixed
            // output pixels (unless "scale gap & margin" is on), so they shrink
            // relative to the thumbnails as the scale factor grows. Render the
            // output-scale spacing mapped back into the loaded-thumbnail coordinate
            // space (ratio = loaded / chosen) so the preview shows the correct
            // proportions without re-rendering the thumbnails.
            const ratio = loadedScaleFactor / s.scaleFactor;
            const outSpacing = effectiveSpacing(s, s.scaleFactor);
            const previewSettings = {
              ...s,
              gutter: Math.round(outSpacing.gutter * ratio),
              margin: Math.round(outSpacing.margin * ratio),
            };
            const sheet = this.compose(ordered, previewSettings);
            cacheSrc = previewSrc(sheet, 'image/png', undefined);
            cacheKey = key;
            return cacheSrc;
          };

          // Clean, clamped config values to persist back (so Settings stays tidy).
          const toConfigUpdate = (values) => {
            const s = normalizeConfig({ ...initialRaw, ...values });
            return {
              columns: s.columns,
              scaleFactor: s.scaleFactor,
              gutter: s.gutter,
              margin: s.margin,
              background: s.background,
              labels: s.labels,
              sortBy: s.sortBy,
              headerText: s.headerText,
              fileType: s.fileType,
              frameMode: s.frameMode,
              scaleGapMargin: s.scaleGapMargin ? '1' : '0',
            };
          };

          // Compose the full-size output sheet from the current instance config.
          const composeOutput = (outputCells) => {
            const s = normalizeConfig(this.config);
            const ordered = this.sortCells(outputCells, s.sortBy);
            const spacing = effectiveSpacing(s, s.scaleFactor);
            return this.compose(ordered, { ...s, gutter: spacing.gutter, margin: spacing.margin });
          };

          // close the progress overlay before opening the dialog
          this.progress(0);

          this.setDialog({
            message: `Contact sheet — ${cells.length} images`,
            questions: (values) => ([
              {
                type: 'image',
                label: 'Preview',
                key: 'preview',
                src: renderPreview(values),
              },
              ...optionQuestions,
            ]),
            confirm: (values) => {
              // Persist edits: Object.assign onto the shared config object also
              // updates the stored plugin config (which the app saves to IndexedDB).
              this.setConfig(toConfigUpdate(values));

              if (this.scaleFactor !== loadedScaleFactor || this.frameMode !== loadedFrameMode) {
                // Scale factor or frame mode changed -> re-render the thumbnails.
                this.progress(0.01);
                return this.loadCells(images).then((rescaled) => {
                  this.progress(0);
                  return this.saveCanvas(composeOutput(rescaled));
                });
              }

              return this.saveCanvas(composeOutput(cells));
            },
            deny: () => {
              this.dismissDialog();
              return Promise.resolve();
            },
          });
        })
        .catch((error) => {
          this.progress(0);
          this.setError(error instanceof Error ? error : new Error(String(error)));
        });
    }
  }

  if (typeof window !== 'undefined' && typeof window.gbpwRegisterPlugin === 'function') {
    window.gbpwRegisterPlugin(ContactSheetPlugin);
  }
}());
