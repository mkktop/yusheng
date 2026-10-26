import { Buffer } from 'node:buffer'
import { delay, VoiceError, SAMPLE_RATE_OUT } from './protocol.js'

export interface VoiceSocket {
  readyState: number
  bufferedAmount?: number
  send(data: string | Buffer): void
  close(code?: number, reason?: string): void
}

type Item = { audio: Buffer } | { marker: () => void }
const FRAME_BYTES = 1920
const QUEUE_BYTES = SAMPLE_RATE_OUT * 2 * 5
const SOCKET_BYTES = 256 * 1024

/** Bounded producer/consumer queue. Preserve PCM sample and frame boundaries across vendor chunks. */
export class AudioSender {
  private items: Item[] = []
  private bytes = 0
  private tail = Buffer.alloc(0)
  private ending = false
  private waiters = new Set<() => void>()
  private worker: Promise<void>
  private failure: unknown
  private sequence = 0
  sentSamples = 0
  queuedSamples = 0
  firstSentAt?: number

  constructor(private ws: VoiceSocket, private signal: AbortSignal, private streamId: number, private framed: boolean, private clientBuffered: () => number = () => 0) {
    this.worker = this.run().catch(error => { this.failure = error; this.wake() })
    signal.addEventListener('abort', () => this.wake(), { once: true })
  }

  private wake() { for (const fn of [...this.waiters]) fn() }
  private check() {
    this.signal.throwIfAborted()
    if (this.failure) throw this.failure
    if (this.ws.readyState !== 1) throw new VoiceError('disconnected', '连接已关闭')
  }
  private changed(): Promise<void> {
    return new Promise(resolve => {
      const fn = () => { this.waiters.delete(fn); resolve() }
      this.waiters.add(fn)
    })
  }

  mark(marker: () => void) { this.check(); this.items.push({ marker }); this.wake() }

  async push(chunk: Buffer) {
    this.check()
    if (chunk.length > 8 * 1024 * 1024) throw new VoiceError('audio_overflow', '合成音频块过大')
    const data = this.tail.length ? Buffer.concat([this.tail, chunk]) : chunk
    let offset = 0
    while (data.length - offset >= FRAME_BYTES) {
      while (this.bytes >= QUEUE_BYTES) { this.check(); await this.changed() }
      this.check()
      const frame = Buffer.from(data.subarray(offset, offset + FRAME_BYTES))
      this.items.push({ audio: frame }); this.bytes += frame.length
      this.queuedSamples += frame.length / 2
      offset += FRAME_BYTES
      this.wake()
    }
    this.tail = Buffer.from(data.subarray(offset))
  }

  /** Flush each sentence's short tail before its next boundary marker. */
  flushSentence() {
    this.check()
    if (this.tail.length % 2) throw new VoiceError('bad_audio', 'PCM 数据未对齐 16 位采样')
    if (this.tail.length) {
      this.items.push({ audio: this.tail }); this.bytes += this.tail.length
      this.queuedSamples += this.tail.length / 2
      this.tail = Buffer.alloc(0); this.wake()
    }
  }

  async finish() {
    this.flushSentence(); this.ending = true; this.wake()
    await this.worker; this.check()
  }

  private async run() {
    let nextSend = Date.now()
    while (!this.signal.aborted) {
      if (!this.items.length) {
        if (this.ending) return
        await this.changed(); nextSend = Date.now(); continue
      }
      this.check()
      const item = this.items.shift()!
      if ('marker' in item) { item.marker(); continue }
      while ((this.ws.bufferedAmount ?? 0) > SOCKET_BYTES || this.clientBuffered() > SAMPLE_RATE_OUT * 2) await delay(20, this.signal)
      await delay(Math.max(0, nextSend - Date.now()), this.signal)
      this.check()
      const pcm = item.audio
      this.firstSentAt ??= Date.now()
      if (this.framed) {
        const header = Buffer.alloc(24)
        header.write('YSV2'); header.writeUInt32LE(this.streamId, 4)
        header.writeUInt32LE(this.sequence++, 8); header.writeDoubleLE(this.sentSamples, 12)
        header.writeUInt32LE(pcm.length, 20)
        this.ws.send(Buffer.concat([header, pcm]))
      } else this.ws.send(pcm)
      this.sentSamples += pcm.length / 2; this.bytes -= pcm.length; this.wake()
      // Keep the sample clock anchored: adding scheduler/socket overhead to
      // every 40ms frame makes delivery steadily slower than the DAC. Allow a
      // small catch-up burst after a stall, bounded to 200ms of queued audio.
      nextSend = Math.max(nextSend + pcm.length / (SAMPLE_RATE_OUT * 2) * 1000, Date.now() - 200)
    }
    this.items = []; this.tail = Buffer.alloc(0); this.bytes = 0
  }
}
