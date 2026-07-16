import type {
  BrushMode,
  BrushSettings,
  KeyParams,
  Rect,
  RGB,
  WorkerInitMsg,
  WorkerKeyMsg,
  WorkerResultMsg,
} from './types'
import { keyImage } from './keying'

interface HistoryEntry {
  rect: Rect
  eBefore: Uint8Array
  aBefore: Uint8Array
  eAfter: Uint8Array
  aAfter: Uint8Array
}

const MAX_HISTORY_ENTRIES = 50
const MAX_HISTORY_BYTES = 256 * 1024 * 1024

/**
 * Non-destructive editing core.
 *
 * The original pixels are never modified. Two full-resolution maps drive the
 * visible result:
 *   E — per-pixel keying strength (how much of the color-keyed result shows)
 *   A — per-pixel manual alpha multiplier (plain eraser / restore)
 * plus `keyed`, the color-keyed version of the whole image, recomputed in a
 * web worker whenever the palettes or tolerance change.
 *
 * result pixel = lerp(original, keyed, E) with alpha
 *                lerp(origAlpha, keyedAlpha, E) * A
 */
export class Editor {
  readonly width: number
  readonly height: number
  /** Full-resolution composited result; draw this to screen and export it. */
  readonly result: HTMLCanvasElement

  onDirty: (() => void) | null = null
  onHistoryChange: (() => void) | null = null
  onBusyChange: ((busy: boolean) => void) | null = null

  private readonly orig: Uint8ClampedArray
  private keyed: Uint8ClampedArray
  private readonly E: Uint8Array
  private readonly A: Uint8Array
  private readonly comp: ImageData
  private readonly rctx: CanvasRenderingContext2D

  private readonly eStart: Uint8Array
  private readonly aStart: Uint8Array
  private strokeRect: Rect | null = null
  private stroking = false

  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []

  private worker: Worker | null = null
  private gen = 0
  private pendingGen: number | null = null

  constructor(image: ImageBitmap) {
    this.width = image.width
    this.height = image.height
    const n = this.width * this.height

    const scratch = document.createElement('canvas')
    scratch.width = this.width
    scratch.height = this.height
    const sctx = scratch.getContext('2d', { willReadFrequently: true })
    if (!sctx) throw new Error('Canvas 2D is not available')
    sctx.drawImage(image, 0, 0)
    this.orig = sctx.getImageData(0, 0, this.width, this.height).data

    this.keyed = new Uint8ClampedArray(this.orig)
    this.E = new Uint8Array(n)
    this.A = new Uint8Array(n).fill(255)
    this.eStart = new Uint8Array(n)
    this.aStart = new Uint8Array(n)
    this.comp = new ImageData(this.width, this.height)

    this.result = document.createElement('canvas')
    this.result.width = this.width
    this.result.height = this.height
    const rctx = this.result.getContext('2d')
    if (!rctx) throw new Error('Canvas 2D is not available')
    this.rctx = rctx

    // Show the untouched image immediately.
    this.compose(this.fullRect())
  }

  /**
   * The worker is created lazily (and recreated after dispose), so a
   * dispose/reuse cycle — e.g. React StrictMode's double-run of effects —
   * cannot leave the editor with a dead worker.
   */
  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./keyWorker.ts', import.meta.url), { type: 'module' })
    const initBuf = new Uint8ClampedArray(this.orig).buffer
    const init: WorkerInitMsg = { type: 'init', width: this.width, height: this.height, buffer: initBuf }
    worker.postMessage(init, [initBuf])
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as WorkerResultMsg
      if (msg.type !== 'keyed' || msg.gen !== this.gen) return
      this.keyed = new Uint8ClampedArray(msg.buffer)
      this.pendingGen = null
      this.onBusyChange?.(false)
      this.compose(this.fullRect())
    }
    this.worker = worker
    return worker
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.pendingGen = null
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get busy(): boolean {
    return this.pendingGen !== null
  }

  /** Recompute the keyed image for new palettes/tolerance (async, in worker). */
  rekey(params: KeyParams): void {
    this.gen++
    if (params.drop.length === 0) {
      // Trivial case: nothing to key; skip the worker round-trip.
      const n = this.width * this.height
      keyImage(this.orig, this.keyed, n, params)
      this.pendingGen = null
      this.onBusyChange?.(false)
      this.compose(this.fullRect())
      return
    }
    this.pendingGen = this.gen
    this.onBusyChange?.(true)
    const msg: WorkerKeyMsg = { type: 'key', gen: this.gen, params }
    this.ensureWorker().postMessage(msg)
  }

  pickColor(x: number, y: number): RGB | null {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return null
    const o = (yi * this.width + xi) * 4
    return { r: this.orig[o], g: this.orig[o + 1], b: this.orig[o + 2] }
  }

  beginStroke(): void {
    if (this.stroking) return
    this.stroking = true
    this.strokeRect = null
    this.eStart.set(this.E)
    this.aStart.set(this.A)
  }

  endStroke(): void {
    if (!this.stroking) return
    this.stroking = false
    const rect = this.strokeRect
    this.strokeRect = null
    if (!rect) return
    const entry: HistoryEntry = {
      rect,
      eBefore: this.cropMap(this.eStart, rect),
      aBefore: this.cropMap(this.aStart, rect),
      eAfter: this.cropMap(this.E, rect),
      aAfter: this.cropMap(this.A, rect),
    }
    this.undoStack.push(entry)
    this.redoStack = []
    this.trimHistory()
    this.onHistoryChange?.()
  }

  /** Stamp a line segment of brush dabs from (x0,y0) to (x1,y1), image coords. */
  strokeTo(x0: number, y0: number, x1: number, y1: number, mode: BrushMode, brush: BrushSettings): void {
    if (!this.stroking) return
    const dx = x1 - x0
    const dy = y1 - y0
    const dist = Math.hypot(dx, dy)
    const spacing = Math.max(1, brush.size * 0.15)
    const steps = Math.max(1, Math.ceil(dist / spacing))
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let s = 0; s <= steps; s++) {
      const x = x0 + (dx * s) / steps
      const y = y0 + (dy * s) / steps
      this.stamp(x, y, mode, brush)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    const r = Math.ceil(brush.size) + 1
    const rect = this.clampRect({
      x: Math.floor(minX) - r,
      y: Math.floor(minY) - r,
      w: Math.ceil(maxX - minX) + 2 * r + 1,
      h: Math.ceil(maxY - minY) + 2 * r + 1,
    })
    if (!rect) return
    this.growStrokeRect(rect)
    this.compose(rect)
  }

  undo(): void {
    const entry = this.undoStack.pop()
    if (!entry) return
    this.applyCrop(entry.rect, entry.eBefore, entry.aBefore)
    this.redoStack.push(entry)
    this.compose(entry.rect)
    this.onHistoryChange?.()
  }

  redo(): void {
    const entry = this.redoStack.pop()
    if (!entry) return
    this.applyCrop(entry.rect, entry.eAfter, entry.aAfter)
    this.undoStack.push(entry)
    this.compose(entry.rect)
    this.onHistoryChange?.()
  }

  exportBlob(type: 'image/png' | 'image/webp'): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.result.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))),
        type,
        type === 'image/webp' ? 0.95 : undefined,
      )
    })
  }

  private stamp(cx: number, cy: number, mode: BrushMode, brush: BrushSettings): void {
    const r = brush.size
    const hardness = 1 - brush.softness
    const inner = r * hardness
    const x0 = Math.max(0, Math.floor(cx - r))
    const y0 = Math.max(0, Math.floor(cy - r))
    const x1 = Math.min(this.width - 1, Math.ceil(cx + r))
    const y1 = Math.min(this.height - 1, Math.ceil(cy + r))
    const { E, A } = this

    for (let y = y0; y <= y1; y++) {
      const row = y * this.width
      for (let x = x0; x <= x1; x++) {
        const dxp = x - cx
        const dyp = y - cy
        const d = Math.sqrt(dxp * dxp + dyp * dyp)
        if (d > r) continue
        let fall = 1
        if (d > inner) {
          const t = (d - inner) / Math.max(1e-6, r - inner)
          fall = 1 - t * t * (3 - 2 * t)
        }
        const w = fall * brush.strength
        if (w <= 0) continue
        const i = row + x
        const w255 = Math.round(w * 255)
        if (mode === 'brush') {
          if (w255 > E[i]) E[i] = w255
        } else if (mode === 'erase') {
          const v = 255 - w255
          if (v < A[i]) A[i] = v
        } else {
          // restore: pull both maps back toward "untouched"
          const v = 255 - w255
          if (v < E[i]) E[i] = v
          if (w255 > A[i]) A[i] = w255
        }
      }
    }
  }

  /** Composite orig/keyed/E/A into the result canvas for the given rect. */
  private compose(rect: Rect): void {
    const { orig, keyed, E, A, comp } = this
    const data = comp.data
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      const row = y * this.width
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = row + x
        const o = i * 4
        const e = E[i] / 255
        const or = orig[o]
        const og = orig[o + 1]
        const ob = orig[o + 2]
        data[o] = or + (keyed[o] - or) * e
        data[o + 1] = og + (keyed[o + 1] - og) * e
        data[o + 2] = ob + (keyed[o + 2] - ob) * e
        const baseA = orig[o + 3] + (keyed[o + 3] - orig[o + 3]) * e
        data[o + 3] = (baseA * A[i]) / 255
      }
    }
    this.rctx.putImageData(comp, 0, 0, rect.x, rect.y, rect.w, rect.h)
    this.onDirty?.()
  }

  private fullRect(): Rect {
    return { x: 0, y: 0, w: this.width, h: this.height }
  }

  private clampRect(rect: Rect): Rect | null {
    const x = Math.max(0, rect.x)
    const y = Math.max(0, rect.y)
    const x2 = Math.min(this.width, rect.x + rect.w)
    const y2 = Math.min(this.height, rect.y + rect.h)
    if (x2 <= x || y2 <= y) return null
    return { x, y, w: x2 - x, h: y2 - y }
  }

  private growStrokeRect(rect: Rect): void {
    if (!this.strokeRect) {
      this.strokeRect = { ...rect }
      return
    }
    const s = this.strokeRect
    const x = Math.min(s.x, rect.x)
    const y = Math.min(s.y, rect.y)
    const x2 = Math.max(s.x + s.w, rect.x + rect.w)
    const y2 = Math.max(s.y + s.h, rect.y + rect.h)
    this.strokeRect = { x, y, w: x2 - x, h: y2 - y }
  }

  private cropMap(map: Uint8Array, rect: Rect): Uint8Array {
    const out = new Uint8Array(rect.w * rect.h)
    for (let y = 0; y < rect.h; y++) {
      const src = (rect.y + y) * this.width + rect.x
      out.set(map.subarray(src, src + rect.w), y * rect.w)
    }
    return out
  }

  private applyCrop(rect: Rect, e: Uint8Array, a: Uint8Array): void {
    for (let y = 0; y < rect.h; y++) {
      const dst = (rect.y + y) * this.width + rect.x
      this.E.set(e.subarray(y * rect.w, (y + 1) * rect.w), dst)
      this.A.set(a.subarray(y * rect.w, (y + 1) * rect.w), dst)
    }
  }

  private trimHistory(): void {
    while (this.undoStack.length > MAX_HISTORY_ENTRIES) this.undoStack.shift()
    let bytes = 0
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      bytes += this.undoStack[i].rect.w * this.undoStack[i].rect.h * 4
      if (bytes > MAX_HISTORY_BYTES) {
        this.undoStack.splice(0, i + 1)
        break
      }
    }
  }
}
