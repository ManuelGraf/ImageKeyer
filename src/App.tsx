import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Editor } from './engine/editor'
import type { RGB, Tool } from './engine/types'
import { EditorCanvas, type Backdrop, type ViewController } from './components/EditorCanvas'
import {
  IconDownload,
  IconEraser,
  IconFit,
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

const rgbCss = (c: RGB) => `rgb(${c.r},${c.g},${c.b})`
const sameColor = (a: RGB, b: RGB) => a.r === b.r && a.g === b.g && a.b === b.b

interface Toast {
  id: number
  msg: string
}

let toastId = 0

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [fileName, setFileName] = useState('image')
  const [tool, setTool] = useState<Tool>('pick-drop')
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
  const [, bumpHistory] = useReducer((x: number) => x + 1, 0)

  const viewRef = useRef<ViewController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<Editor | null>(null)
  editorRef.current = editor
  const toolRef = useRef(tool)
  toolRef.current = tool

  const toast = useCallback((msg: string) => {
    const id = ++toastId
    setToasts((t) => [...t, { id, msg }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

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
      setTool('pick-drop')
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
          setTool('brush')
          break
        case 'KeyE':
          setTool('erase')
          break
        case 'KeyR':
          setTool('restore')
          break
        case 'KeyV':
          setTool('pan')
          break
        case 'KeyD':
          setTool('pick-drop')
          break
        case 'KeyK':
          setTool('pick-keep')
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
  }, [])

  const onPick = useCallback(
    (kind: 'drop' | 'keep', color: RGB) => {
      if (kind === 'drop') {
        setDropColors((cs) => (cs.some((c) => sameColor(c, color)) ? cs : [...cs, color]))
      } else {
        setKeepColors((cs) => (cs.some((c) => sameColor(c, color)) ? cs : [...cs, color]))
      }
    },
    [],
  )

  const exportImage = useCallback(
    async (type: 'image/png' | 'image/webp') => {
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

  const toolButtons: { id: Tool; label: string; title: string; icon: React.ReactNode }[] = [
    { id: 'pick-drop', label: 'Pick −', title: 'Pick colors to remove (D)', icon: <IconPickDrop /> },
    { id: 'pick-keep', label: 'Pick +', title: 'Pick colors to keep (K)', icon: <IconPickKeep /> },
    { id: 'brush', label: 'Magic', title: 'Magic brush — removes picked colors (B)', icon: <IconWand /> },
    { id: 'erase', label: 'Erase', title: 'Plain eraser (E)', icon: <IconEraser /> },
    { id: 'restore', label: 'Restore', title: 'Restore original (R)', icon: <IconRestore /> },
    { id: 'pan', label: 'Pan', title: 'Pan / zoom (V, or hold Space)', icon: <IconPan /> },
  ]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Image&nbsp;<span>Keyer</span>
        </div>
        <button className="btn" title="Open image" onClick={() => fileInputRef.current?.click()}>
          <IconOpen />
          <span className="btn-text">Open</span>
        </button>
        <button className="btn" title="Paste image from clipboard" onClick={() => void pasteFromClipboard()}>
          <IconPaste />
          <span className="btn-text">Paste</span>
        </button>
        <div className="sep" />
        <button
          className="btn icon-only"
          title="Undo (Ctrl+Z)"
          disabled={!editor?.canUndo}
          onClick={() => editor?.undo()}
        >
          <IconUndo />
        </button>
        <button
          className="btn icon-only"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!editor?.canRedo}
          onClick={() => editor?.redo()}
        >
          <IconRedo />
        </button>
        <div className="sep" />
        <button className="btn icon-only" title="Fit to view" disabled={!editor} onClick={() => viewRef.current?.fit()}>
          <IconFit />
        </button>
        <button className="btn" title="Zoom to 100%" disabled={!editor} onClick={() => viewRef.current?.zoom100()}>
          1:1
        </button>
        <div className="sep" />
        <div className="segmented" title="Preview backdrop">
          {(['checker', 'white', 'black'] as const).map((b) => (
            <button
              key={b}
              className={backdrop === b ? 'active' : ''}
              title={`${b} backdrop`}
              onClick={() => setBackdrop(b)}
            >
              {b === 'checker' ? <span className="checker-swatch" /> : <span className={`solid-swatch ${b}`} />}
            </button>
          ))}
        </div>
        {busy && <div className="spinner" title="Applying colors…" />}
        <div className="spacer" />
        <button className="btn primary" title="Export as PNG" disabled={!editor} onClick={() => void exportImage('image/png')}>
          <IconDownload />
          <span className="btn-text">PNG</span>
        </button>
        <button className="btn" title="Export as WebP" disabled={!editor} onClick={() => void exportImage('image/webp')}>
          <IconDownload />
          <span className="btn-text">WebP</span>
        </button>
      </header>

      <div className="main">
        <aside className="panel">
          <div className="tool-grid">
            {toolButtons.map((t) => (
              <button
                key={t.id}
                className={`tool-btn ${tool === t.id ? 'active' : ''}`}
                title={t.title}
                onClick={() => setTool(t.id)}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="sliders">
            <label>
              <span>
                Size <em>{brushSize}px</em>
              </span>
              <input
                type="range"
                min={1}
                max={400}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
              />
            </label>
            <label>
              <span>
                Softness <em>{softness}%</em>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={softness}
                onChange={(e) => setSoftness(Number(e.target.value))}
              />
            </label>
            <label>
              <span>
                Strength <em>{strength}%</em>
              </span>
              <input
                type="range"
                min={1}
                max={100}
                value={strength}
                onChange={(e) => setStrength(Number(e.target.value))}
              />
            </label>
            <label>
              <span>
                Tolerance <em>{tolerance}%</em>
              </span>
              <input
                type="range"
                min={1}
                max={100}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
              />
            </label>
          </div>

          <div className="palette">
            <h3>Remove colors</h3>
            <div className="chips">
              {dropColors.map((c, i) => (
                <button
                  key={`${rgbCss(c)}-${i}`}
                  className="chip"
                  style={{ background: rgbCss(c) }}
                  title={`${rgbCss(c)} — click to remove from palette`}
                  onClick={() => setDropColors((cs) => cs.filter((_, j) => j !== i))}
                />
              ))}
              {dropColors.length === 0 && <p className="hint">Use the “Pick −” eyedropper on the background.</p>}
            </div>
          </div>
          <div className="palette">
            <h3>Keep colors</h3>
            <div className="chips">
              {keepColors.map((c, i) => (
                <button
                  key={`${rgbCss(c)}-${i}`}
                  className="chip"
                  style={{ background: rgbCss(c) }}
                  title={`${rgbCss(c)} — click to remove from palette`}
                  onClick={() => setKeepColors((cs) => cs.filter((_, j) => j !== i))}
                />
              ))}
              {keepColors.length === 0 && <p className="hint">Optional: protect subject colors with “Pick +”.</p>}
            </div>
          </div>
        </aside>

        <div className="viewport">
          {editor ? (
            <EditorCanvas
              editor={editor}
              tool={tool}
              brush={{ size: brushSize, softness: softness / 100, strength: strength / 100 }}
              backdrop={backdrop}
              onPick={onPick}
              controllerRef={viewRef}
            />
          ) : (
            <div className="empty">
              <IconWand size={48} />
              <h2>Image Keyer</h2>
              <p>
                Remove backgrounds by color — even through glass and bubbles.
                <br />
                Everything runs locally in your browser; no image ever leaves this device.
              </p>
              <div className="empty-actions">
                <button className="btn primary" onClick={() => fileInputRef.current?.click()}>
                  <IconOpen /> Open image
                </button>
                <button className="btn" onClick={() => void pasteFromClipboard()}>
                  <IconPaste /> Paste
                </button>
              </div>
              <p className="hint">…or drag &amp; drop a JPG / PNG / WebP anywhere, or press Ctrl+V.</p>
            </div>
          )}
        </div>
      </div>

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
