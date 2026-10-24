// minimax 语音合成（t2a_v2，HTTP + SSE 流式，api.minimax.cn 新版平台，仅需 Bearer Key）：
// 逐句合成，audio 为 hex 编码的裸 PCM（默认 24kHz 16bit mono），按帧下发。

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

export const TTS_SAMPLE_RATE = 24_000
/** 下发帧长 40ms：24000Hz × 2 字节 × 0.04s = 1920 字节 */
export const TTS_FRAME_BYTES = (TTS_SAMPLE_RATE * 2 * 40) / 1000

export class TtsError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface TtsOptions {
  apiKey: string
  model?: string
  voiceId?: string
  speed?: number
  vol?: number
  pitch?: number
  signal?: AbortSignal
  timeoutMs?: number
}

const TTS_ENDPOINT = 'https://api.minimax.cn/v1/t2a_v2'

/**
 * 流式合成一句文本，异步产出 PCM 片段（24kHz 16bit mono）。
 * 中断：options.signal 触发后生成器结束，不再产出。
 */
export async function* synthesizeStream(text: string, options: TtsOptions): AsyncGenerator<Buffer> {
  const apiKey = options.apiKey
  if (apiKey === '') throw new TtsError('no_api_key', 'minimax API key 未配置（设置面板 → MiniMax 凭据）')
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000)
  const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])

  const body = {
    model: options.model || 'speech-2.8-turbo',
    text,
    stream: true,
    voice_setting: {
      voice_id: options.voiceId || 'female-shaonv',
      speed: options.speed ?? 1,
      vol: options.vol ?? 1,
      pitch: options.pitch ?? 0,
    },
    audio_setting: {
      sample_rate: TTS_SAMPLE_RATE,
      bitrate: 128_000,
      format: 'pcm',
      channel: 1,
    },
  }

  let response: Response
  try {
    response = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (options.signal?.aborted) return
    if (timeout.aborted) throw new TtsError('tts_timeout', '语音合成请求超时')
    throw new TtsError('network', `语音合成请求失败：${String(error)}`)
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw new TtsError('http_' + String(response.status), `语音合成失败（${response.status}）：${detail.slice(0, 300)}`)
  }

  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  let yieldedBytes = 0
  const incrementalHash = createHash('sha256')

  function decodeLine(line: string): Buffer | undefined {
    line = line.trim()
    if (!line.startsWith('data:')) return undefined
    const text = line.slice(5).trim()
    if (text === '') return undefined
    if (text === '[DONE]') { finished = true; return undefined }
    let payload: any
    try { payload = JSON.parse(text) }
    catch { throw new TtsError('bad_tts_response', '语音合成流返回无效 JSON') }
    if (payload?.base_resp?.status_code !== undefined && payload.base_resp.status_code !== 0) {
      throw new TtsError('api_' + String(payload.base_resp.status_code), `语音合成业务错误：${String(payload.base_resp.status_msg)}`)
    }
    const terminal = payload?.data?.status === 2
    if (terminal) finished = true
    const hex = payload?.data?.audio
    if (hex === undefined || hex === '') return undefined
    if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
      throw new TtsError('bad_tts_response', '语音合成流返回无效 PCM hex')
    }
    let chunk = Buffer.from(hex, 'hex')
    // status=2 可重发完整音频。校验前缀后只跳过已发部分，保留 recap 中的新尾音。
    if (terminal && yieldedBytes > 0 && chunk.length >= yieldedBytes) {
      const prefixHash = createHash('sha256').update(chunk.subarray(0, yieldedBytes)).digest('hex')
      if (prefixHash === incrementalHash.copy().digest('hex')) chunk = chunk.subarray(yieldedBytes)
    }
    if (chunk.length === 0) return undefined
    incrementalHash.update(chunk)
    yieldedBytes += chunk.length
    return chunk
  }

  try {
    while (!finished) {
      if (options.signal?.aborted) return
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        if (buffer.trim() !== '') {
          const chunk = decodeLine(buffer)
          if (chunk !== undefined) yield chunk
        }
        break
      }
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while (!finished && (newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const chunk = decodeLine(line)
        if (chunk !== undefined) yield chunk
      }
    }
    if (!finished && !options.signal?.aborted) throw new TtsError('stream', '语音合成流在完成标记前中断')
    if (yieldedBytes === 0 && !options.signal?.aborted) throw new TtsError('empty_tts', 'TTS 未返回音频')
  } catch (error) {
    if (options.signal?.aborted) return
    if (timeout.aborted) throw new TtsError('tts_timeout', '语音合成流超时')
    if (error instanceof TtsError) throw error
    throw new TtsError('stream', `语音合成流中断：${String(error)}`)
  } finally {
    try { await reader.cancel() } catch { /* 连接已关闭 */ }
  }
}
