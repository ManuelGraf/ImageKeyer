# Image Keyer

A fully client-side background eraser inspired by onOne Mask Pro's magic brush.
Pick the colors you want to **remove** and the colors you want to **keep**, then
brush over the image: matching hues turn transparent, and partially transparent
pixels are *decontaminated* (the removed color is solved out of the RGB
channels), so glass, soap bubbles, hair and smoke keep their translucency.

Everything runs locally in the browser — no server, no uploads, no network
requests at all (the production build ships a CSP with `connect-src 'none'`).

## Usage

1. Open an image (button, drag & drop anywhere, or paste with Ctrl+V / the
   Paste button).
2. Use the **Pick −** eyedropper to click background colors, optionally
   **Pick +** to protect subject colors.
3. Brush over the background with the **Magic** brush. **Erase** is a plain
   eraser, **Restore** brings the original back.
4. Export as PNG or WebP with transparency.

### Shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) | Undo / redo |
| `B` `E` `R` `V` | Magic brush / Eraser / Restore / Pan |
| `D` / `K` | Eyedropper: remove color / keep color |
| `[` / `]` | Brush size |
| Space (hold) or middle-drag | Pan |
| Mouse wheel / pinch | Zoom |

On touch devices: one finger uses the active tool, two fingers pinch-zoom and
pan.

## Development

```sh
npm install
npm run dev      # dev server
npm run build    # type-check + production build into dist/
```

## Deployment

Copy the contents of `dist/` to any static web space (the build uses relative
paths, so a sub-directory works too). Serve over HTTPS so clipboard paste
works. No server-side code required.

## Security notes

- Production `index.html` carries a strict Content-Security-Policy;
  `connect-src 'none'` means the app provably cannot send data anywhere.
- SVG input is rejected (only raster formats are accepted), file types are
  checked before decoding, and images larger than ~24 MP (16 MP on iOS, which
  caps canvas sizes) are downscaled to avoid decompression-bomb freezes.
- Exports are re-encoded through a canvas, which strips EXIF/GPS metadata.
- Runtime dependencies are just React + ReactDOM; everything is bundled
  locally, no CDNs.
