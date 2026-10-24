// minimax 语音合成（t2a_v2，HTTP + SSE 流式，api.minimax.cn 新版平台，仅需 Bearer Key）：
// 逐句合成，audio 为 hex 编码的裸 PCM（默认 24kHz 16bit mono），按帧下发。

import { Buffer } from 'node:buffer'

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
}

const TTS_ENDPOINT = 'https://api.minimax.cn/v1/t2a_v2'

/**
 * 流式合成一句文本，异步产出 PCM 片段（24kHz 16bit mono）。
 * 中断：options.signal 触发后生成器结束，不再产出。
 */
export async function* synthesizeStream(text: string, options: TtsOptions): AsyncGenerator<Buffer> {
  const apiKey = options.apiKey
  if (apiKey === '') throw new TtsError('no_api_key', 'minimax API key 未配置（设置面板 → MiniMax 凭据）')

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
      signal: options.signal,
    })
  } catch (error) {
    if (options.signal?.aborted) return
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

  try {
    while (!finished) {
      if (options.signal?.aborted) return
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (!line.startsWith('data:')) continue
        const payloadText = line.slice(5).trim()
        if (payloadText === '' || payloadText === '[DONE]') continue
        let payload: any
        try {
          payload = JSON.parse(payloadText)
        } catch {
          continue
        }
        if (payload?.base_resp?.status_code !== undefined && payload.base_resp.status_code !== 0) {
          throw new TtsError(
            'api_' + String(payload.base_resp.status_code),
            `语音合成业务错误：${String(payload.base_resp.status_msg)}`,
          )
        }
        const audioHex = payload?.data?.audio
        if (typeof audioHex === 'string' && audioHex !== '') {
          const chunk = Buffer.from(audioHex, 'hex')
          // api.minimax.cn 流式的 status=2 末事件会重发整段完整音频；
          // 已收到增量时跳过重发（长度不足视为普通尾片段，兼容旧接口）
          const isFullRecap = payload?.data?.status === 2 && yieldedBytes > 0 && chunk.length >= yieldedBytes
          if (chunk.length > 0 && !isFullRecap) {
            yieldedBytes += chunk.length
            yield chunk
          }
        }
        if (payload?.data?.status === 2) finished = true
      }
    }
  } catch (error) {
    if (options.signal?.aborted) return
    if (error instanceof TtsError) throw error
    throw new TtsError('stream', `语音合成流中断：${String(error)}`)
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* 连接已关闭 */
    }
  }
}
