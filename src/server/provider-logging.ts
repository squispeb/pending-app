function toSafeErrorSummary(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(typeof (error as { code?: unknown }).code === 'string'
        ? { code: (error as { code: string }).code }
        : {}),
    }
  }

  return {
    message: String(error),
  }
}

function toSafeMetadata(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  )
}

export function logProviderCall(
  provider: string,
  event: string,
  metadata: Record<string, unknown>,
) {
  console.info(`[provider:${provider}] ${event}`, toSafeMetadata(metadata))
}

export function logProviderError(
  provider: string,
  event: string,
  metadata: Record<string, unknown>,
  error?: unknown,
) {
  console.error(`[provider:${provider}] ${event}`, {
    ...toSafeMetadata(metadata),
    ...(error ? { error: toSafeErrorSummary(error) } : {}),
  })
}
