// minimax 语音识别（speech_to_text，api.minimax.cn 新版平台，仅需 Bearer Key）：
// 整段音频 multipart 上传，模型 asr-1.0；说完一句再识别，非流式。

import { Buffer } from 'node:buffer'

const ASR_ENDPOINT = 'https://api.minimax.cn/v1/speech_to_text'

export class AsrError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** 16kHz 16bit mono PCM → WAV 容器（minimax 不收裸 PCM）。 */
export function pcmToWav(pcm: Buffer, sampleRate = 16000, channels = 1, bitsPerSample = 16): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM chunk size
  header.writeUInt16LE(1, 20) // format = PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export interface AsrOptions {
  apiKey: string
  model?: string
  timeoutMs?: number
}

/**
 * 识别一段 16kHz 16bit mono PCM。
 * 返回识别文本（可能为空串）；失败抛 AsrError。
 */
export async function transcribePcm(pcm: Buffer, options: AsrOptions): Promise<string> {
  const model = options.model || 'asr-1.0'
  const timeoutMs = options.timeoutMs ?? 30_000
  if (options.apiKey === '') throw new AsrError('no_api_key', 'minimax API key 未配置（设置面板 → MiniMax 凭据）')

  const form = new FormData()
  form.append('model', model)
  const wav = pcmToWav(pcm)
  const blob = new Blob([new Uint8Array(wav)], { type: 'audio/wav' })
  form.append('file', blob, 'audio.wav')
  form.append('response_format', 'json')

  let response: Response
  try {
    response = await fetch(ASR_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new AsrError('network', `语音识别请求失败：${String(error)}`)
  }

  const bodyText = await response.text()
  let payload: any = undefined
  try {
    payload = JSON.parse(bodyText)
  } catch {
    /* 非 JSON 响应按错误文本处理 */
  }
  if (!response.ok) {
    const detail = payload?.base_resp?.status_msg ?? payload?.message ?? bodyText.slice(0, 300)
    throw new AsrError('http_' + String(response.status), `语音识别失败（${response.status}）：${String(detail)}`)
  }
  if (payload?.base_resp?.status_code !== undefined && payload.base_resp.status_code !== 0) {
    throw new AsrError('api_' + String(payload.base_resp.status_code), `语音识别业务错误：${String(payload.base_resp.status_msg)}`)
  }
  const text = typeof payload?.text === 'string' ? payload.text : ''
  return text.trim()
}
