import { keyImage } from './keying'
import type { WorkerInitMsg, WorkerKeyMsg, WorkerResultMsg } from './types'

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage(msg: unknown, transfer?: Transferable[]): void
}

let src: Uint8ClampedArray | null = null
let pixelCount = 0

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data as WorkerInitMsg | WorkerKeyMsg
  if (msg.type === 'init') {
    src = new Uint8ClampedArray(msg.buffer)
    pixelCount = msg.width * msg.height
    return
  }
  if (msg.type === 'key') {
    if (!src) return
    const out = new Uint8ClampedArray(pixelCount * 4)
    keyImage(src, out, pixelCount, msg.params)
    const result: WorkerResultMsg = { type: 'keyed', gen: msg.gen, buffer: out.buffer }
    ctx.postMessage(result, [out.buffer])
  }
}
