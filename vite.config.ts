import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Inject a strict Content-Security-Policy into the built index.html.
// Applied only on build: the dev server needs inline module preambles and a
// websocket for HMR, which this policy would block.
// connect-src 'none' guarantees the app cannot make any network request.
function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: [
                "default-src 'none'",
                "script-src 'self'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' blob: data:",
                "worker-src 'self' blob:",
                "connect-src 'none'",
                "font-src 'self'",
                "base-uri 'none'",
                "form-action 'none'",
              ].join('; '),
            },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: './',
  build: {
    target: 'es2022',
  },
})
