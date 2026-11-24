import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import electron from 'vite-plugin-electron/simple'

/**
 * Injects the Content-Security-Policy directly into the HTML document.
 * Vite's development client needs inline scripts and a WebSocket connection,
 * while the packaged application receives a much stricter policy.
 */
function contentSecurityPolicy(): Plugin {
  let isDevelopment = false

  return {
    name: 'cami:content-security-policy',
    configResolved(config) {
      isDevelopment = config.command === 'serve'
    },
    transformIndexHtml() {
      const policy = isDevelopment
        ? [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self' data:",
            "worker-src 'self' blob:",
            "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'"
          ].join('; ')
        : [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self' data:",
            "worker-src 'self' blob:",
            "connect-src 'self'",
            "media-src 'none'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'"
          ].join('; ')

      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: policy
          },
          injectTo: 'head-prepend' as const
        }
      ]
    }
  }
}

export default defineConfig({
  base: './',
  clearScreen: false,
  plugins: [
    react(),
    contentSecurityPolicy(),
    electron({
      main: {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            emptyOutDir: true,
            sourcemap: false,
            rolldownOptions: {
              external: ['node-pty'],
              output: {
                entryFileNames: 'index.js'
              }
            }
          }
        }
      },
      preload: {
        input: 'src/preload/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            emptyOutDir: true,
            sourcemap: false,
            rolldownOptions: {
              output: {
                entryFileNames: 'index.js',
                chunkFileNames: 'chunks/[name]-[hash].js'
              }
            }
          }
        }
      }
    })
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022'
  }
})
