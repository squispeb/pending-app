import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { VitePWA } from 'vite-plugin-pwa'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  optimizeDeps: {
    exclude: ['@tanstack/start-server-core'],
  },
  plugins: [
    devtools(),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    nitro({
      rollupConfig: {
        external: [/^@sentry\//],
        onwarn(warning, warn) {
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.id?.includes('/node_modules/')) {
            return
          }

          warn(warning)
        },
      },
    }),
    viteReact(),
    VitePWA({
      outDir: '.output/public',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'logo192.png', 'logo512.png'],
      workbox: {
        navigateFallback: null,
      },
      manifest: {
        name: 'Pending App',
        short_name: 'Pending',
        description:
          'A personal planning app for tasks, habits, reminders, and calendar context.',
        theme_color: '#0f172a',
        background_color: '#eef4ff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/logo192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/logo512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
})

export default config
