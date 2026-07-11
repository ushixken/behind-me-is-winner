# behind-me-is-winner
lookback :>

# Brush Presets

Brush preset packs live under `assets/brush-presets/`. Each pack is a folder containing a `settings.json` and optional image files.

## Directory layout

```
assets/brush-presets/
  manifest.json          ← ordered list of enabled preset slugs
  rough-pencil/
    settings.json        ← required
    tip.png              ← optional brush tip shape
    texture.png          ← optional grain/texture overlay
  charcoal-stick/
    settings.json
    tip.png
    texture.png
```

## Adding a new preset

1. Create a folder inside `assets/brush-presets/` with a short, lowercase, hyphenated name (the *slug*):

   ```
   assets/brush-presets/charcoal-stick/
   ```

2. Add `settings.json` to that folder (see format below).

3. Add optional `tip.png` and/or `texture.png` images to the same folder.

4. Open `assets/brush-presets/manifest.json` and append the slug once:

   ```json
   {
     "presets": [
       "rough-pencil",
       "charcoal-stick"
     ]
   }
   ```

5. Reload the page. The new preset appears in the **Brush Presets** panel under **General Brushes** (or the category you specified).

That's it — no code changes required.

---

## settings.json format

```jsonc
{
  // Required
  "name": "Charcoal Stick",

  // Optional image file names (default: "tip.png" / "texture.png")
  "tipFile": "tip.png",
  "textureFile": "texture.png",

  // Optional image flags (default: true for both)
  // Set to false to skip loading that image entirely.
  "hasTip": true,
  "hasTexture": true,

  // Optional metadata (reserved for future UI features)
  "category": "General Brushes",   // panel folder name to place this preset in
  "description": "A rough charcoal stick brush.",
  "author": "Your Name",
  "tags": ["charcoal", "traditional", "texture"],
  "version": "1.0",

  // Tool settings — mirrors the ts-* slider IDs in Tool Settings
  "settings": {
    "ts-size": 18,
    "ts-hardness": 70,
    "ts-opacity": 100,
    "ts-flow": 75,
    "ts-density": 85,
    "ts-spacing": 10,
    "ts-spacing-mode": "fixed",
    "ts-rotation-mode": "fixed-rotation",
    "ts-angle": 0,
    "ts-tip-roundness": 100,
    "ts-tip-flip-x": false,
    "ts-tip-flip-y": false,
    "ts-scatter-enabled": false,
    "ts-scatter-amount": 0,
    "ts-scatter-count": 1,
    "ts-roundness": 100,
    "ts-aa": false,
    "ts-aa-mode": "medium",
    "ts-texture-depth": 60,
    "ts-texture-scale": 100
  }
}
```

### Required fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name shown in the panel (must be non-empty) |
| `settings` | object | Tool setting key/value pairs (may be empty `{}`) |

### Optional fields with defaults

| Field | Default | Description |
|-------|---------|-------------|
| `tipFile` | `"tip.png"` | Image filename for the brush tip, relative to the preset folder |
| `textureFile` | `"texture.png"` | Image filename for the grain texture |
| `hasTip` | `true` | Set `false` to skip tip loading entirely |
| `hasTexture` | `true` | Set `false` to skip texture loading entirely |
| `category` | General Brushes | Panel folder to place this preset in |

> **Note:** Do not store image data URLs inside `settings.json`. Image paths are resolved relative to the preset folder automatically.

---

## Validation and error handling

The loader validates each preset before registering it. Invalid presets are **skipped with a console warning** — they never crash the app.

Checks performed:

- `settings.json` must be fetchable and valid JSON
- `name` must be a non-empty string
- `settings` (if present) must be an object
- Duplicate slugs in `manifest.json` are skipped with a warning
- Duplicate generated IDs (`pack:<slug>`) are skipped with a warning

Missing optional images (`tip.png`, `texture.png`) are silently ignored by the image loader.

---

## Serving the app

Preset loading uses `fetch()` and requires an HTTP server. Run from the project root:

```sh
npx serve .
```

Direct `file://` loading is not supported.