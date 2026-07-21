import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Editor } from './engine/editor'
import type { Picker, RGB, Tool } from './engine/types'
import { EditorCanvas, type Backdrop, type ViewController } from './components/EditorCanvas'
import {
  IconDownload,
  IconEraser,
  IconHeart,
  IconHelp,
  IconOpen,
  IconPan,
  IconPaste,
  IconPickDrop,
  IconPickKeep,
  IconRedo,
  IconRestore,
  IconUndo,
  IconWand,
} from './components/Icons'

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']

const IS_IOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// Safari caps canvas area around 16.7 MP; keep headroom elsewhere too so a
// decompression-bomb PNG can't freeze the tab.
const MAX_PIXELS = IS_IOS ? 16_000_000 : 24_000_000

const KOFI_URL = 'https://ko-fi.com/yummieee'
const COACH_KEY = 'ik.coachDismissed'

const rgbCss = (c: RGB) => `rgb(${c.r},${c.g},${c.b})`
const sameColor = (a: RGB, b: RGB) => a.r === b.r && a.g === b.g && a.b === b.b

const TOOL_NAMES: Record<Tool, string> = {
  brush: 'Magic Brush',
  erase: 'Eraser',
  restore: 'Restore',
  pan: 'Pan / Zoom',
}

const TOOL_LABELS: Record<Tool, string> = {
  brush: 'Magic',
  erase: 'Erase',
  restore: 'Restore',
  pan: 'Pan',
}

// Rail geometry: padding 14 + Magic 54 + gap 4 + divider 13 + gap 4, tools 50 + gap 4.
const RAIL_INDICATOR_TOP: Record<Tool, number> = { brush: 16, erase: 89, restore: 143, pan: 197 }
const TOOL_ORDER: Tool[] = ['brush', 'erase', 'restore', 'pan']

interface Toast {
  id: number
  msg: string
}

let toastId = 0

function readCoachDismissed(): boolean {
  try {
    return localStorage.getItem(COACH_KEY) === '1'
  } catch {
    return false
  }
}

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [fileName, setFileName] = useState('image')
  const [tool, setTool] = useState<Tool>('brush')
  const [picker, setPicker] = useState<Picker>(null)
  const [brushSize, setBrushSize] = useState(40)
  const [softness, setSoftness] = useState(50)
  const [strength, setStrength] = useState(100)
  const [tolerance, setTolerance] = useState(30)
  const [dropColors, setDropColors] = useState<RGB[]>([])
  const [keepColors, setKeepColors] = useState<RGB[]>([])
  const [backdrop, setBackdrop] = useState<Backdrop>('checker')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [zoom, setZoom] = useState(100)
  const [helpOpen, setHelpOpen] = useState(false)
  const [coachDismissed, setCoachDismissed] = useState(readCoachDismissed)
  const [exportOpen, setExportOpen] = useState(false)
  const [, bumpHistory] = useReducer((x: number) => x + 1, 0)

  const viewRef = useRef<ViewController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<Editor | null>(null)
  editorRef.current = editor

  const toast = useCallback((msg: string) => {
    const id = ++toastId
    setToasts((t) => [...t, { id, msg }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  const dismissCoach = useCallback(() => {
    setCoachDismissed(true)
    try {
      localStorage.setItem(COACH_KEY, '1')
    } catch {
      /* private mode */
    }
  }, [])

  const selectTool = useCallback((t: Tool) => {
    setTool(t)
    setPicker(null)
  }, [])

  const togglePicker = useCallback(
    (kind: 'drop' | 'keep') => {
      setPicker((p) => (p === kind ? null : kind))
      if (kind === 'drop') dismissCoach()
    },
    [dismissCoach],
  )

  const openHelp = useCallback(() => {
    setHelpOpen(true)
    dismissCoach()
  }, [dismissCoach])

  const loadBlob = useCallback(
    async (blob: Blob, name?: string) => {
      if (blob.type === 'image/svg+xml' || !ACCEPTED_TYPES.includes(blob.type)) {
        toast('Unsupported file type. Use JPG, PNG, WebP, GIF, AVIF or BMP.')
        return
      }
      let bitmap: ImageBitmap
      try {
        bitmap = await createImageBitmap(blob)
      } catch {
        toast('Could not decode that image.')
        return
      }
      if (bitmap.width * bitmap.height > MAX_PIXELS) {
        const s = Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height))
        const w = Math.round(bitmap.width * s)
        const h = Math.round(bitmap.height * s)
        bitmap.close()
        try {
          bitmap = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
        } catch {
          toast('Image is too large to load on this device.')
          return
        }
        toast(`Large image downscaled to ${w}×${h} for smooth editing.`)
      }
      const next = new Editor(bitmap)
      bitmap.close()
      // The previous editor is disposed by the lifecycle effect's cleanup.
      setEditor(next)
      if (name) setFileName(name.replace(/\.[^.]+$/, '') || 'image')
      setTool('brush')
      setPicker(null)
    },
    [toast],
  )

  const openFile = useCallback(
    (file: File | null | undefined) => {
      if (file) void loadBlob(file, file.name)
    },
    [loadBlob],
  )

  const pasteFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = ACCEPTED_TYPES.find((t) => item.types.includes(t))
        if (type) {
          void loadBlob(await item.getType(type), 'pasted-image')
          return
        }
      }
      toast('No image found in the clipboard.')
    } catch {
      toast('Clipboard not accessible. Try Ctrl+V instead.')
    }
  }, [loadBlob, toast])

  // Editor lifecycle: wire callbacks, dispose on replacement/unmount.
  useEffect(() => {
    if (!editor) return
    editor.onHistoryChange = bumpHistory
    editor.onBusyChange = setBusy
    return () => {
      editor.dispose()
    }
  }, [editor])

  // Re-key when palettes or tolerance change (debounced).
  useEffect(() => {
    if (!editor) return
    const t = window.setTimeout(() => {
      editor.rekey({ drop: dropColors, keep: keepColors, tolerance })
    }, 120)
    return () => window.clearTimeout(t)
  }, [editor, dropColors, keepColors, tolerance])

  // Global paste (Ctrl+V), drag & drop, unload guard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            void loadBlob(file, 'pasted-image')
          }
          return
        }
      }
    }
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer?.types.includes('Files')) setDragOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      openFile(e.dataTransfer?.files?.[0])
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (editorRef.current?.canUndo) e.preventDefault()
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [loadBlob, openFile])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const mod = e.ctrlKey || e.metaKey
      const ed = editorRef.current
      if (mod && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) ed?.redo()
        else ed?.undo()
        return
      }
      if (mod && e.code === 'KeyY') {
        e.preventDefault()
        ed?.redo()
        return
      }
      if (mod) return
      switch (e.code) {
        case 'KeyB':
          selectTool('brush')
          break
        case 'KeyE':
          selectTool('erase')
          break
        case 'KeyR':
          selectTool('restore')
          break
        case 'KeyV':
          selectTool('pan')
          break
        case 'KeyD':
          togglePicker('drop')
          break
        case 'KeyK':
          togglePicker('keep')
          break
        case 'Escape':
          setPicker(null)
          setHelpOpen(false)
          break
        case 'BracketLeft':
          setBrushSize((s) => Math.max(1, Math.round(s / 1.2)))
          break
        case 'BracketRight':
          setBrushSize((s) => Math.min(400, Math.max(s + 1, Math.round(s * 1.2))))
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectTool, togglePicker])

  const onPick = useCallback((kind: 'drop' | 'keep', color: RGB) => {
    if (kind === 'drop') {
      setDropColors((cs) => (cs.some((c) => sameColor(c, color)) ? cs : [...cs, color]))
    } else {
      setKeepColors((cs) => (cs.some((c) => sameColor(c, color)) ? cs : [...cs, color]))
    }
  }, [])

  const onZoomChange = useCallback((scale: number) => {
    setZoom(Math.round(scale * 100))
  }, [])

  const exportImage = useCallback(
    async (type: 'image/png' | 'image/webp') => {
      setExportOpen(false)
      const ed = editorRef.current
      if (!ed) return
      try {
        const blob = await ed.exportBlob(type)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${fileName}-cutout.${type === 'image/png' ? 'png' : 'webp'}`
        a.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      } catch {
        toast('Export failed.')
      }
    },
    [fileName, toast],
  )

  const isBrushy = tool === 'brush' || tool === 'erase' || tool === 'restore'
  const coachVisible = !!editor && !coachDismissed && dropColors.length === 0 && !helpOpen

  const toolIcon = (t: Tool, size: number) =>
    t === 'brush' ? (
      <IconWand size={size} />
    ) : t === 'erase' ? (
      <IconEraser size={size} />
    ) : t === 'restore' ? (
      <IconRestore size={size} />
    ) : (
      <IconPan size={size} />
    )

  const toolTitle: Record<Tool, string> = {
    brush: 'Magic brush — removes sampled colors (B)',
    erase: 'Eraser (E)',
    restore: 'Restore original (R)',
    pan: 'Pan / zoom (V, or hold Space)',
  }

  const swatches = (kind: 'drop' | 'keep') => {
    const colors = kind === 'drop' ? dropColors : keepColors
    const setColors = kind === 'drop' ? setDropColors : setKeepColors
    return colors.map((c, i) => (
      <div key={`${rgbCss(c)}-${i}`} className="swatch" style={{ background: rgbCss(c) }}>
        <button
          className={`swatch-x ${kind}`}
          title={`${rgbCss(c)} — click to remove`}
          onClick={() => setColors((cs) => cs.filter((_, j) => j !== i))}
        >
          ×
        </button>
      </div>
    ))
  }

  const wellHead = (kind: 'drop' | 'keep') => (
    <div className={`well-head ${kind}`}>
      {kind === 'drop' ? 'REMOVE' : 'KEEP'}
      <span className="well-count">{kind === 'drop' ? dropColors.length : keepColors.length}</span>
      <button
        className={`well-clear ${kind}`}
        title={`Clear all ${kind === 'drop' ? 'remove' : 'keep'} colors`}
        onClick={() => (kind === 'drop' ? setDropColors([]) : setKeepColors([]))}
      >
        Clear
      </button>
    </div>
  )

  const pipetteBtn = (kind: 'drop' | 'keep', withLabel: boolean) => (
    <button
      className={`pipette-btn ${kind} ${picker === kind ? 'armed' : ''}`}
      title={kind === 'drop' ? 'Sample colors to remove (D)' : 'Sample colors to keep (K)'}
      onClick={() => togglePicker(kind)}
    >
      {kind === 'drop' ? <IconPickDrop size={withLabel ? 15 : 18} /> : <IconPickKeep size={withLabel ? 15 : 18} />}
      {withLabel && (kind === 'drop' ? 'Sample remove color' : 'Sample keep color')}
    </button>
  )

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand m-hide">
          IMAGE <span>KEYER</span>
        </div>
        <div className="brand m-only">
          IK<span>·</span>
        </div>
        <div className="vsep m-hide" />
        <button className="ghost-btn m-hide" title="Open image" onClick={() => fileInputRef.current?.click()}>
          <IconOpen size={18} />
        </button>
        <button className="ghost-btn d-only" title="Paste image from clipboard" onClick={() => void pasteFromClipboard()}>
          <IconPaste size={18} />
        </button>
        <div className="vsep d-only" />
        <button
          className="ghost-btn"
          title="Undo (Ctrl+Z)"
          disabled={!editor?.canUndo}
          onClick={() => editor?.undo()}
        >
          <IconUndo size={18} />
        </button>
        <button
          className="ghost-btn m-hide"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!editor?.canRedo}
          onClick={() => editor?.redo()}
        >
          <IconRedo size={18} />
        </button>
        <div className="file-label">
          {editor && (
            <span className="file-text">
              {fileName}
              <span className="file-dims m-hide"> · {editor.width} × {editor.height}</span>
            </span>
          )}
          {busy && <span className="spinner" title="Applying colors…" />}
        </div>
        <div className="segmented m-hide" title="Preview backdrop">
          {(['checker', 'white', 'black'] as const).map((b) => (
            <button
              key={b}
              className={backdrop === b ? 'active' : ''}
              title={`${b.charAt(0).toUpperCase() + b.slice(1)} backdrop`}
              onClick={() => setBackdrop(b)}
            >
              <span className={`bd-swatch ${b}`} />
            </button>
          ))}
        </div>
        <div className="bd-dots m-only" title="Preview backdrop">
          {(['checker', 'white', 'black'] as const).map((b) => (
            <button
              key={b}
              className={`bd-dot ${b} ${backdrop === b ? 'active' : ''}`}
              title={`${b.charAt(0).toUpperCase() + b.slice(1)} backdrop`}
              onClick={() => setBackdrop(b)}
            />
          ))}
        </div>
        <div className="export-wrap">
          <button
            className="export-btn"
            title="Export cutout"
            disabled={!editor}
            onClick={() => setExportOpen((o) => !o)}
          >
            <IconDownload size={16} />
            <span className="m-hide">Export</span>
          </button>
          {exportOpen && (
            <>
              <div className="export-backdrop" onClick={() => setExportOpen(false)} />
              <div className="export-menu">
                <button onClick={() => void exportImage('image/png')}>PNG</button>
                <button onClick={() => void exportImage('image/webp')}>WebP</button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="optionsbar">
        <div className="tool-name">{TOOL_NAMES[tool]}</div>
        <div className="vsep" />
        {isBrushy && (
          <>
            <label className="opt-slider">
              Size
              <input
                type="range"
                min={1}
                max={400}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
              />
              <span className="opt-val size">{brushSize}px</span>
            </label>
            <label className="opt-slider d-only">
              Softness
              <input
                type="range"
                min={0}
                max={100}
                value={softness}
                onChange={(e) => setSoftness(Number(e.target.value))}
              />
              <span className="opt-val">{softness}%</span>
            </label>
            <label className="opt-slider d-only">
              Strength
              <input
                type="range"
                min={1}
                max={100}
                value={strength}
                onChange={(e) => setStrength(Number(e.target.value))}
              />
              <span className="opt-val">{strength}%</span>
            </label>
          </>
        )}
        {tool === 'brush' && (
          <>
            <div className="vsep d-only" />
            <label className="opt-slider">
              <span className="m-hide">Tolerance</span>
              <span className="m-only">Tol</span>
              <input
                type="range"
                min={1}
                max={100}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
              />
              <span className="opt-val">{tolerance}%</span>
            </label>
            <span className="opt-hint d-only">Removes sampled colors only — protects Keep colors</span>
          </>
        )}
        {tool === 'pan' && (
          <>
            <button className="outline-btn d-only" disabled={!editor} onClick={() => viewRef.current?.fit()}>
              Fit
            </button>
            <button className="outline-btn d-only" disabled={!editor} onClick={() => viewRef.current?.zoom100()}>
              100%
            </button>
            <span className="opt-hint">
              <span className="d-only">Scroll to zoom · drag to pan · hold Space anywhere</span>
              <span className="d-hide">Pinch to zoom · drag to pan</span>
            </span>
          </>
        )}
      </div>

      <div className="body">
        <nav className="rail d-only">
          <div className="rail-indicator" style={{ top: RAIL_INDICATOR_TOP[tool] }} />
          {TOOL_ORDER.map((t) => (
            <div key={t} className="rail-slot">
              <button
                className={`rail-btn ${t === 'brush' ? 'primary' : ''} ${tool === t ? 'active' : ''}`}
                title={toolTitle[t]}
                onClick={() => selectTool(t)}
              >
                {toolIcon(t, t === 'brush' ? 22 : 18)}
                {TOOL_LABELS[t]}
              </button>
              {t === 'brush' && <div className="rail-divider" />}
            </div>
          ))}
        </nav>

        <div className="viewport">
          {editor ? (
            <EditorCanvas
              editor={editor}
              tool={tool}
              picker={picker}
              brush={{ size: brushSize, softness: softness / 100, strength: strength / 100 }}
              backdrop={backdrop}
              onPick={onPick}
              onZoomChange={onZoomChange}
              controllerRef={viewRef}
            />
          ) : (
            <div className="empty">
              <IconWand size={44} />
              <h2>
                IMAGE <span>KEYER</span>
              </h2>
              <p>
                Remove backgrounds by color — even through glass and bubbles.
                <br />
                Everything runs locally in your browser; no image ever leaves this device.
              </p>
              <div className="empty-actions">
                <button className="cta-btn" onClick={() => fileInputRef.current?.click()}>
                  <IconOpen size={16} /> Open image
                </button>
                <button className="cta-btn ghost" onClick={() => void pasteFromClipboard()}>
                  <IconPaste size={16} /> Paste
                </button>
              </div>
              <p className="empty-hint">…or drag &amp; drop a JPG / PNG / WebP anywhere, or press Ctrl+V.</p>
            </div>
          )}
          {picker && (
            <div className={`picker-pill ${picker}`}>
              {picker === 'drop'
                ? 'Sampling colors to REMOVE — click the image'
                : 'Sampling colors to KEEP — click the image'}
            </div>
          )}
        </div>

        <aside className="sidebar d-only">
          <section className="well-group">
            {wellHead('drop')}
            <div className="well-box">
              {swatches('drop')}
              {dropColors.length === 0 && <p className="well-empty">Sample background colors below.</p>}
            </div>
            <div className="coach-anchor">
              {pipetteBtn('drop', true)}
              {coachVisible && (
                <div className="coach">
                  <span className="coach-arrow" />
                  <div className="coach-title">START HERE</div>
                  <p>Sample the colors you want to remove — the Magic brush only erases sampled colors.</p>
                  <div className="coach-keys">
                    <kbd>D</kbd>remove<kbd className="coach-k2">K</kbd>keep
                  </div>
                  <button className="coach-ok" onClick={dismissCoach}>
                    Got it
                  </button>
                </div>
              )}
            </div>
          </section>
          <section className="well-group">
            {wellHead('keep')}
            <div className="well-box">
              {swatches('keep')}
              {keepColors.length === 0 && <p className="well-empty">Optional: protect the subject.</p>}
            </div>
            {pipetteBtn('keep', true)}
          </section>
          <div className="sidebar-hints">
            <span>Click a swatch to remove it.</span>
            <span>Magic brush only affects sampled colors.</span>
          </div>
        </aside>
      </div>

      <div className="wells-strip d-hide">
        <div className="strip-well">
          <div className="well-head-wrap m-hide">{wellHead('drop')}</div>
          <div className="strip-row">
            <div className="well-box drop">
              {swatches('drop')}
              {dropColors.length === 0 && (
                <p className="well-empty">
                  <span className="m-hide">Sample the background →</span>
                  <span className="m-only">← Sample</span>
                </p>
              )}
            </div>
            {pipetteBtn('drop', false)}
          </div>
        </div>
        <div className="strip-well">
          <div className="well-head-wrap m-hide">{wellHead('keep')}</div>
          <div className="strip-row">
            <div className="well-box keep">
              {swatches('keep')}
              {keepColors.length === 0 && (
                <p className="well-empty">
                  <span className="m-hide">Optional →</span>
                  <span className="m-only">← Keep</span>
                </p>
              )}
            </div>
            {pipetteBtn('keep', false)}
          </div>
        </div>
      </div>

      <nav className="bottombar d-hide">
        <div className="bottom-tools">
          <div className="tab-indicator" style={{ left: `${TOOL_ORDER.indexOf(tool) * 25}%` }} />
          {TOOL_ORDER.map((t) => (
            <button
              key={t}
              className={`bottom-btn ${tool === t ? 'active' : ''}`}
              title={toolTitle[t]}
              onClick={() => selectTool(t)}
            >
              {toolIcon(t, 22)}
              {TOOL_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="vdiv" />
        <button className="bottom-cell" title="Help & shortcuts" onClick={openHelp}>
          <IconHelp size={20} />
          Help
        </button>
        <a
          className="bottom-cell kofi m-hide"
          href={KOFI_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Support on Ko-fi"
        >
          <IconHeart size={20} />
          Ko-fi
        </a>
      </nav>

      <footer className="statusbar d-only">
        <span>{zoom}%</span>
        {editor && (
          <span>
            {editor.width} × {editor.height} px
          </span>
        )}
        <div className="spacer" />
        <button className="status-btn" title="Help & shortcuts" onClick={openHelp}>
          <IconHelp size={14} />
          Help
        </button>
        <a className="status-btn kofi" href={KOFI_URL} target="_blank" rel="noopener noreferrer" title="Support on Ko-fi">
          <IconHeart size={14} />
          Ko-fi
        </a>
      </footer>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">HELP &amp; SHORTCUTS</div>
              <button className="modal-x" title="Close" onClick={() => setHelpOpen(false)}>
                ×
              </button>
            </div>
            <p className="modal-intro">
              1. Sample background colors with the Remove pipette. &nbsp;2. Optionally protect subject colors with
              Keep. &nbsp;3. Brush over the background with the Magic brush. &nbsp;4. Export as PNG or WebP.
            </p>
            <div className="shortcut-grid">
              <span>Magic brush</span>
              <kbd>B</kbd>
              <span>Eraser</span>
              <kbd>E</kbd>
              <span>Restore original</span>
              <kbd>R</kbd>
              <span>Pan / zoom</span>
              <kbd>V · hold Space</kbd>
              <span>Sample remove color</span>
              <kbd>D</kbd>
              <span>Sample keep color</span>
              <kbd>K</kbd>
              <span>Brush size</span>
              <kbd>[ · ]</kbd>
              <span>Undo / redo</span>
              <kbd>Ctrl+Z · Ctrl+Shift+Z</kbd>
              <span>Zoom</span>
              <kbd>Scroll · Pinch</kbd>
            </div>
            <div className="modal-foot">
              Enjoying Image Keyer?
              <a href={KOFI_URL} target="_blank" rel="noopener noreferrer">
                <IconHeart size={14} />
                Support on Ko-fi
              </a>
            </div>
          </div>
        </div>
      )}

      {dragOver && (
        <div className="drop-overlay">
          <div>Drop image to open</div>
        </div>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.msg}
          </div>
        ))}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        hidden
        onChange={(e) => {
          openFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
