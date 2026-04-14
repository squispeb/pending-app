import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import BottomTabBar from '../components/BottomTabBar'
import Footer from '../components/Footer'
import GlobalCaptureHost from '../components/GlobalCaptureHost'
import Header from '../components/Header'
import PwaLifecycle from '../components/PwaLifecycle'
import { getAuthStatus } from '../server/auth'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

type AuthContext =
  | {
      auth: {
        state: 'authenticated'
        user: {
          id: string
          email: string
          displayName: string | null
        } | null
      }
    }
  | {
      auth: {
        state: 'needs_login'
      }
    }

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Pending App',
      },
      {
        name: 'description',
        content:
          'A personal planning app for tasks, habits, reminders, and Google Calendar context.',
      },
      {
        name: 'theme-color',
        content: '#0f172a',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        href: '/favicon.ico',
      },
      {
        rel: 'manifest',
        href: '/manifest.webmanifest',
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center">
      <p>404 — Page not found</p>
    </div>
  ),
  beforeLoad: async ({ context }) => {
    const auth = await context.queryClient.fetchQuery({
      queryKey: ['auth-status'],
      queryFn: () => getAuthStatus(),
    })

    if (auth.state === 'authenticated') {
      return {
        auth: {
          state: 'authenticated' as const,
          user: auth.user,
        },
      }
    }

    return {
      auth: {
        state: 'needs_login' as const,
      },
    }
  },
  component: RootLayout,
})

function RootLayout() {
  return <Outlet />
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
        <Header />
        <GlobalCaptureHost>
          <div className="min-h-screen lg:min-h-[calc(100vh-4rem)]">{children}</div>
          <Footer />
          <BottomTabBar />
        </GlobalCaptureHost>
        <PwaLifecycle />
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
