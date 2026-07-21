export interface RGB {
  r: number
  g: number
  b: number
}

export interface KeyParams {
  /** Colors to remove (made transparent). */
  drop: RGB[]
  /** Colors to protect from removal. */
  keep: RGB[]
  /** 1..100 — how far from a palette color a pixel may be and still match. */
  tolerance: number
}

export type Tool = 'brush' | 'erase' | 'restore' | 'pan'

/** Armed eyedropper state — a modal overlay on top of the active tool, not a tool itself. */
export type Picker = 'drop' | 'keep' | null

export type BrushMode = 'brush' | 'erase' | 'restore'

export interface BrushSettings {
  /** Radius in image pixels. */
  size: number
  /** 0..1 — 0 = hard edge, 1 = fully feathered. */
  softness: number
  /** 0..1 — maximum effect applied by one stroke. */
  strength: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface WorkerInitMsg {
  type: 'init'
  width: number
  height: number
  /** RGBA pixels of the original image (transferred). */
  buffer: ArrayBuffer
}

export interface WorkerKeyMsg {
  type: 'key'
  gen: number
  params: KeyParams
}

export interface WorkerResultMsg {
  type: 'keyed'
  gen: number
  /** RGBA pixels of the keyed image (transferred). */
  buffer: ArrayBuffer
}
