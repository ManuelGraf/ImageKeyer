import { useEffect, useRef } from 'react'
import type { Editor } from '../engine/editor'
import type { BrushSettings, RGB, Tool } from '../engine/types'

export type Backdrop = 'checker' | 'white' | 'black'

export interface ViewController {
  fit: () => void
  zoom100: () => void
}

interface Props {
  editor: Editor
  tool: Tool
  brush: BrushSettings
  backdrop: Backdrop
  onPick: (kind: 'drop' | 'keep', color: RGB) => void
  controllerRef: React.MutableRefObject<ViewController | null>
}

interface View {
  scale: number
  tx: number
  ty: number
}

const MIN_SCALE = 0.02
const MAX_SCALE = 32

function makeCheckerPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const tile = document.createElement('canvas')
  tile.width = 16
  tile.height = 16
  const tctx = tile.getContext('2d')
  if (!tctx) return null
  tctx.fillStyle = '#a0a0a0'
  tctx.fillRect(0, 0, 16, 16)
  tctx.fillStyle = '#5f5f5f'
  tctx.fillRect(0, 0, 8, 8)
  tctx.fillRect(8, 8, 8, 8)
  return ctx.createPattern(tile, 'repeat')
}

export function EditorCanvas({ editor, tool, brush, backdrop, onPick, controllerRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Mirror the latest props into a ref so event handlers (registered once)
  // always see current values.
  const propsRef = useRef({ editor, tool, brush, backdrop, onPick })
  propsRef.current = { editor, tool, brush, backdrop, onPick }

  const stateRef = useRef({
    view: { scale: 1, tx: 0, ty: 0 } as View,
    pointers: new Map<number, { x: number; y: number }>(),
    mode: 'idle' as 'idle' | 'stroke' | 'pan' | 'pinch',
    lastImg: { x: 0, y: 0 },
    lastScreen: { x: 0, y: 0 },
    pinchStart: null as null | { d: number; mid: { x: number; y: number }; view: View },
    cursor: null as null | { x: number; y: number },
    spaceDown: false,
    raf: 0,
    pattern: null as CanvasPattern | null,
  })

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const st = stateRef.current
    st.pattern = makeCheckerPattern(ctx)

    const repaint = () => {
      st.raf = 0
      const p = propsRef.current
      const dpr = window.devicePixelRatio || 1
      const { view } = st
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#0d0e11'
      ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr)

      const w = p.editor.width * view.scale
      const h = p.editor.height * view.scale
      if (p.backdrop === 'checker' && st.pattern) {
        ctx.fillStyle = st.pattern
      } else {
        ctx.fillStyle = p.backdrop === 'white' ? '#ffffff' : '#000000'
      }
      ctx.fillRect(view.tx, view.ty, w, h)

      ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty)
      ctx.imageSmoothingEnabled = view.scale < 4
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(p.editor.result, 0, 0)

      // Brush cursor ring (screen space).
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const brushTool = p.tool === 'brush' || p.tool === 'erase' || p.tool === 'restore'
      if (st.cursor && brushTool && !st.spaceDown && st.mode !== 'pan' && st.mode !== 'pinch') {
        const r = p.brush.size * view.scale
        ctx.beginPath()
        ctx.arc(st.cursor.x, st.cursor.y, r, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'
        ctx.lineWidth = 3
        ctx.stroke()
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 1.25
        ctx.stroke()
      }
    }

    const schedule = () => {
      if (!st.raf) st.raf = requestAnimationFrame(repaint)
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = container.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      schedule()
    }

    const fit = () => {
      const p = propsRef.current
      const rect = container.getBoundingClientRect()
      const pad = 24
      const scale = Math.min(
        (rect.width - pad * 2) / p.editor.width,
        (rect.height - pad * 2) / p.editor.height,
        8,
      )
      const s = Math.max(MIN_SCALE, scale)
      st.view = {
        scale: s,
        tx: (rect.width - p.editor.width * s) / 2,
        ty: (rect.height - p.editor.height * s) / 2,
      }
      schedule()
    }

    const zoom100 = () => {
      const p = propsRef.current
      const rect = container.getBoundingClientRect()
      st.view = {
        scale: 1,
        tx: (rect.width - p.editor.width) / 2,
        ty: (rect.height - p.editor.height) / 2,
      }
      schedule()
    }

    controllerRef.current = { fit, zoom100 }

    const toLocal = (e: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const toImage = (pt: { x: number; y: number }) => ({
      x: (pt.x - st.view.tx) / st.view.scale,
      y: (pt.y - st.view.ty) / st.view.scale,
    })

    const zoomAt = (pt: { x: number; y: number }, factor: number) => {
      const v = st.view
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
      const f = s / v.scale
      st.view = { scale: s, tx: pt.x - (pt.x - v.tx) * f, ty: pt.y - (pt.y - v.ty) * f }
      schedule()
    }

    const endStrokeIfAny = () => {
      if (st.mode === 'stroke') propsRef.current.editor.endStroke()
    }

    const startPinch = () => {
      const pts = [...st.pointers.values()]
      if (pts.length < 2) return
      endStrokeIfAny()
      st.mode = 'pinch'
      st.pinchStart = {
        d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
        view: { ...st.view },
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      const p = propsRef.current
      canvas.setPointerCapture(e.pointerId)
      const pt = toLocal(e)
      st.pointers.set(e.pointerId, pt)
      st.cursor = pt

      if (st.pointers.size === 2) {
        startPinch()
        return
      }
      if (st.pointers.size > 2) return

      const wantsPan = p.tool === 'pan' || st.spaceDown || e.button === 1
      if (wantsPan) {
        st.mode = 'pan'
        st.lastScreen = pt
        schedule()
        return
      }
      if (p.tool === 'pick-drop' || p.tool === 'pick-keep') {
        const img = toImage(pt)
        const color = p.editor.pickColor(img.x, img.y)
        if (color) p.onPick(p.tool === 'pick-drop' ? 'drop' : 'keep', color)
        return
      }
      if (e.button !== 0 && e.pointerType === 'mouse') return
      // Brush / erase / restore stroke.
      st.mode = 'stroke'
      const img = toImage(pt)
      st.lastImg = img
      p.editor.beginStroke()
      p.editor.strokeTo(img.x, img.y, img.x, img.y, p.tool as 'brush' | 'erase' | 'restore', p.brush)
    }

    const onPointerMove = (e: PointerEvent) => {
      const p = propsRef.current
      const pt = toLocal(e)
      st.cursor = pt
      if (st.pointers.has(e.pointerId)) st.pointers.set(e.pointerId, pt)

      if (st.mode === 'pinch' && st.pinchStart && st.pointers.size >= 2) {
        const pts = [...st.pointers.values()]
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
        const start = st.pinchStart
        const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (start.view.scale * d) / Math.max(1, start.d)))
        const f = s / start.view.scale
        st.view = {
          scale: s,
          tx: mid.x - (start.mid.x - start.view.tx) * f,
          ty: mid.y - (start.mid.y - start.view.ty) * f,
        }
        schedule()
        return
      }
      if (st.mode === 'pan' && st.pointers.has(e.pointerId)) {
        st.view.tx += pt.x - st.lastScreen.x
        st.view.ty += pt.y - st.lastScreen.y
        st.lastScreen = pt
        schedule()
        return
      }
      if (st.mode === 'stroke' && st.pointers.has(e.pointerId)) {
        const img = toImage(pt)
        p.editor.strokeTo(
          st.lastImg.x,
          st.lastImg.y,
          img.x,
          img.y,
          p.tool as 'brush' | 'erase' | 'restore',
          p.brush,
        )
        st.lastImg = img
      }
      schedule()
    }

    const onPointerUpOrCancel = (e: PointerEvent) => {
      st.pointers.delete(e.pointerId)
      if (st.mode === 'pinch') {
        if (st.pointers.size < 2) {
          st.mode = 'idle'
          st.pinchStart = null
        }
        return
      }
      if (st.pointers.size === 0) {
        endStrokeIfAny()
        st.mode = 'idle'
        if (e.pointerType !== 'mouse') st.cursor = null
        schedule()
      }
    }

    const onPointerLeave = () => {
      if (st.mode === 'idle') {
        st.cursor = null
        schedule()
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.008 : 0.0015))
      zoomAt(toLocal(e), factor)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return
      if (e.type === 'keydown') {
        st.spaceDown = true
        e.preventDefault()
      } else {
        st.spaceDown = false
      }
      updateCursorStyle()
      schedule()
    }

    const updateCursorStyle = () => {
      const p = propsRef.current
      if (st.spaceDown || p.tool === 'pan') canvas.style.cursor = 'grab'
      else if (p.tool === 'pick-drop' || p.tool === 'pick-keep') canvas.style.cursor = 'crosshair'
      else canvas.style.cursor = 'none'
    }
    updateCursorStyle()

    const onContextMenu = (e: Event) => e.preventDefault()

    const ro = new ResizeObserver(resize)
    ro.observe(container)
    resize()
    fit()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUpOrCancel)
    canvas.addEventListener('pointercancel', onPointerUpOrCancel)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)

    const prevOnDirty = propsRef.current.editor.onDirty
    propsRef.current.editor.onDirty = schedule

    return () => {
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUpOrCancel)
      canvas.removeEventListener('pointercancel', onPointerUpOrCancel)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      if (st.raf) {
        cancelAnimationFrame(st.raf)
        st.raf = 0
      }
      propsRef.current.editor.onDirty = prevOnDirty
      controllerRef.current = null
    }
    // The editor instance is the only dependency that requires a full re-setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // Cursor style + repaint when tool/backdrop/brush change.
  useEffect(() => {
    const canvas = canvasRef.current
    const st = stateRef.current
    if (!canvas) return
    if (st.spaceDown || tool === 'pan') canvas.style.cursor = 'grab'
    else if (tool === 'pick-drop' || tool === 'pick-keep') canvas.style.cursor = 'crosshair'
    else canvas.style.cursor = 'none'
    // Trigger a repaint via the editor's dirty hook (rAF-throttled inside).
    editor.onDirty?.()
  }, [tool, backdrop, brush, editor])

  return (
    <div ref={containerRef} className="canvas-container">
      <canvas ref={canvasRef} className="editor-canvas" />
    </div>
  )
}
