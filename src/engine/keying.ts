import type { KeyParams } from './types'

/** Maximum possible euclidean distance between two RGB colors. */
const MAX_RGB_DIST = 441.673

/**
 * Color-based alpha unmixing ("keying"), the Mask Pro-style algorithm:
 *
 * Each pixel is assumed to be a mix of foreground and a background color
 * from the drop palette: pixel = alpha * fg + (1 - alpha) * dropColor.
 *
 * 1. The pixel's proximity to the nearest drop color vs. the nearest keep
 *    color decides alpha (pure drop color -> 0, keep color or unrelated
 *    color -> 1, in between -> partial transparency).
 * 2. Decontamination: for partially transparent pixels the drop color's
 *    contribution is solved out of the RGB channels, so translucent things
 *    (glass, bubbles, hair) lose the background tint as they gain
 *    transparency.
 *
 * Writes the keyed RGBA result into `out`. If the drop palette is empty the
 * image passes through unchanged.
 */
export function keyImage(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  pixelCount: number,
  params: KeyParams,
): void {
  const { drop, keep } = params
  if (drop.length === 0) {
    out.set(src)
    return
  }

  const maxDist = Math.max(1, (params.tolerance / 100) * MAX_RGB_DIST)

  // Flatten palettes into typed arrays for a tight inner loop.
  const nd = drop.length
  const dropFlat = new Float64Array(nd * 3)
  for (let c = 0; c < nd; c++) {
    dropFlat[c * 3] = drop[c].r
    dropFlat[c * 3 + 1] = drop[c].g
    dropFlat[c * 3 + 2] = drop[c].b
  }
  const nk = keep.length
  const keepFlat = new Float64Array(nk * 3)
  for (let c = 0; c < nk; c++) {
    keepFlat[c * 3] = keep[c].r
    keepFlat[c * 3 + 1] = keep[c].g
    keepFlat[c * 3 + 2] = keep[c].b
  }

  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4
    const r = src[o]
    const g = src[o + 1]
    const b = src[o + 2]
    const srcA = src[o + 3]

    // Nearest drop color.
    let bestSq = Infinity
    let bestC = 0
    for (let c = 0; c < nd; c++) {
      const dr = r - dropFlat[c * 3]
      const dg = g - dropFlat[c * 3 + 1]
      const db = b - dropFlat[c * 3 + 2]
      const d = dr * dr + dg * dg + db * db
      if (d < bestSq) {
        bestSq = d
        bestC = c
      }
    }
    const dDrop = Math.sqrt(bestSq)
    let kDrop = 1 - dDrop / maxDist
    if (kDrop < 0) kDrop = 0
    // Smoothstep for a gentle transition band around the tolerance edge.
    let removal = kDrop * kDrop * (3 - 2 * kDrop)

    // Keep-palette protection: only suppress removal for pixels that are
    // closer to a keep color than to the nearest drop color, fading in as
    // dKeep approaches 0. A pixel exactly matching a drop color must always
    // go fully transparent, no matter what the keep palette contains.
    if (nk > 0 && removal > 0) {
      let dKeepSq = Infinity
      for (let c = 0; c < nk; c++) {
        const dr = r - keepFlat[c * 3]
        const dg = g - keepFlat[c * 3 + 1]
        const db = b - keepFlat[c * 3 + 2]
        const d = dr * dr + dg * dg + db * db
        if (d < dKeepSq) dKeepSq = d
      }
      const dKeep = Math.sqrt(dKeepSq)
      const sum = dDrop + dKeep
      const protect = sum > 0 ? Math.min(1, (2 * dKeep) / sum) : 1
      removal *= protect
    }

    const alpha = 1 - removal

    let R = r
    let G = g
    let B = b
    if (removal > 0 && alpha > 1 / 255) {
      // Solve pixel = alpha * fg + (1 - alpha) * dropColor for fg.
      const ia = 1 - alpha
      const dc = bestC * 3
      R = (r - ia * dropFlat[dc]) / alpha
      G = (g - ia * dropFlat[dc + 1]) / alpha
      B = (b - ia * dropFlat[dc + 2]) / alpha
      if (R < 0) R = 0
      else if (R > 255) R = 255
      if (G < 0) G = 0
      else if (G > 255) G = 255
      if (B < 0) B = 0
      else if (B > 255) B = 255
    }

    out[o] = R
    out[o + 1] = G
    out[o + 2] = B
    out[o + 3] = Math.round(alpha * srcA)
  }
}
