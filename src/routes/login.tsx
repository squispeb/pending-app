import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { LoaderCircle, Mail, ShieldCheck } from 'lucide-react'
import { z } from 'zod'
import { requestEmailOtp, verifyEmailOtp } from '../server/auth'

const requestOtpSchema = z.object({
  email: z.email('Enter a valid email address.'),
})

const verifyOtpSchema = z.object({
  email: z.email('Enter a valid email address.'),
  otp: z.string().trim().min(6, 'Enter the 6-digit code.'),
  name: z.string().trim().optional(),
})

const loginSearchSchema = z.object({
  redirect: z.string().optional(),
})

function sanitizeRedirect(redirect: string | undefined) {
  if (!redirect || !redirect.startsWith('/')) {
    return '/'
  }

  if (redirect.startsWith('//')) {
    return '/'
  }

  return redirect
}

export const Route = createFileRoute('/login')({
  validateSearch: (search) => loginSearchSchema.parse(search),
  beforeLoad: async ({ context, search }) => {
    const redirectTarget = sanitizeRedirect(search.redirect)

    if (context.auth.state === 'authenticated') {
      throw redirect({ href: redirectTarget, replace: true })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const search = Route.useSearch()
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [name, setName] = useState('')
  const [step, setStep] = useState<'request' | 'verify'>('request')
  const [message, setMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isRedirecting, setIsRedirecting] = useState(false)

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email])
  const redirectTarget = useMemo(() => sanitizeRedirect(search.redirect), [search.redirect])

  const requestOtpMutation = useMutation({
    mutationFn: async () => {
      const parsed = requestOtpSchema.parse({ email: normalizedEmail })
      return requestEmailOtp({ data: parsed })
    },
    onSuccess: async () => {
      setStep('verify')
      setErrorMessage(null)
      setMessage(`We sent a sign-in code to ${normalizedEmail}.`)
      await queryClient.invalidateQueries({ queryKey: ['auth-status'] })
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Could not send a sign-in code.')
    },
  })

  const verifyOtpMutation = useMutation({
    mutationFn: async () => {
      const parsed = verifyOtpSchema.parse({
        email: normalizedEmail,
        otp,
        name: name.trim() || undefined,
      })
      return verifyEmailOtp({ data: parsed })
    },
    onSuccess: async () => {
      setIsRedirecting(true)
      setMessage('Code verified. Redirecting...')
      setErrorMessage(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['auth-status'] }),
        queryClient.invalidateQueries(),
      ])
      await router.invalidate({ sync: true })
      await navigate({ href: redirectTarget, replace: true })
    },
    onError: (error) => {
      setIsRedirecting(false)
      setErrorMessage(error instanceof Error ? error.message : 'Could not verify the sign-in code.')
    },
  })

  function handleRequestSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    setErrorMessage(null)
    requestOtpMutation.mutate()
  }

  function handleVerifySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    verifyOtpMutation.mutate()
  }

  return (
    <main className="page-wrap flex min-h-[calc(100vh-12rem)] items-center justify-center py-10">
      <section className="panel w-full max-w-xl rounded-[28px] p-6 sm:p-8">
        <div className="mb-6 space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
            <ShieldCheck size={14} />
            Login
          </div>
          <h1 className="display-title m-0 text-3xl font-bold text-[var(--ink-strong)]">Log in to Pending App</h1>
          <p className="m-0 max-w-lg text-sm leading-7 text-[var(--ink-soft)] sm:text-base">
            Enter your email address and we’ll send you a one-time sign-in code. That session will be shared with the assistant service too.
          </p>
        </div>

        {message ? (
          <div className="mb-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-500">
            {message}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-500">
            {errorMessage}
          </div>
        ) : null}

        {step === 'request' ? (
          <form className="space-y-4" onSubmit={handleRequestSubmit}>
            <label className="block text-sm font-medium text-[var(--ink-soft)]">
              Email address
              <div className="mt-2 flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
                <Mail size={18} className="text-[var(--ink-soft)]" />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-transparent text-[var(--ink-strong)] outline-none"
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={requestOtpMutation.isPending || isRedirecting}
              className="primary-pill w-full cursor-pointer border-0 justify-center text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            >
              {requestOtpMutation.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle size={16} className="animate-spin" />
                  Sending code...
                </span>
              ) : (
                'Send sign-in code'
              )}
            </button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={handleVerifySubmit}>
            <label className="block text-sm font-medium text-[var(--ink-soft)]">
              Email address
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
              />
            </label>

            <label className="block text-sm font-medium text-[var(--ink-soft)]">
              One-time code
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                placeholder="123456"
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
              />
            </label>

            <label className="block text-sm font-medium text-[var(--ink-soft)]">
              Name (optional)
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Used if this is your first login"
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[var(--ink-strong)] outline-none transition focus:border-[var(--brand)]"
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                disabled={isRedirecting}
                onClick={() => {
                  setStep('request')
                  setOtp('')
                  setErrorMessage(null)
                  setMessage(null)
                }}
                className="secondary-pill w-full cursor-pointer border-0 justify-center text-sm font-semibold"
              >
                Use a different email
              </button>
              <button
                type="submit"
                disabled={verifyOtpMutation.isPending || isRedirecting}
                className="primary-pill w-full cursor-pointer border-0 justify-center text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                {verifyOtpMutation.isPending || isRedirecting ? (
                  <span className="inline-flex items-center gap-2">
                    <LoaderCircle size={16} className="animate-spin" />
                    {isRedirecting ? 'Redirecting...' : 'Logging in...'}
                  </span>
                ) : (
                  'Verify code'
                )}
              </button>
            </div>
          </form>
        )}

        <p className="mt-6 text-sm text-[var(--ink-soft)]">
          Looking for your planning dashboard? <Link to="/" className="font-semibold">Return home</Link>
        </p>
      </section>
    </main>
  )
}
