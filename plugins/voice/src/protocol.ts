import { randomUUID } from 'node:crypto'

export const PROTOCOL_VERSION = 2
export const SUPPORTED_VERSIONS = [1, 2] as const
export const SAMPLE_RATE_IN = 16_000
export const SAMPLE_RATE_OUT = 24_000
export const AUDIO_FORMAT = { encoding: 'pcm_s16le', channels: 1 } as const
export const CAPABILITIES = ['turns', 'conversation.select', 'playback', 'playback.flow', 'response.stop', 'audio.framed', 'agent.activity', 'presentation.state', 'presentation.cue', 'ui.render'] as const

export class VoiceError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

export function identifier(value: unknown, max = 64): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && /^[a-zA-Z0-9_-]+$/.test(value)
}

export function newId(): string { return randomUUID() }

/** Race an operation against cancellation without leaving listeners on long lived signals. */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The operation may already have started before the caller noticed cancellation.
    void operation.catch(() => undefined)
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    const cancel = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener('abort', cancel)
    signal.addEventListener('abort', cancel, { once: true })
    operation.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const cancel = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, ms)
    signal.addEventListener('abort', cancel, { once: true })
  })
}
