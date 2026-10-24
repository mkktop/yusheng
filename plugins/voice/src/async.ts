/** 等待外部任务时可立即放弃；仍接住原任务的迟到结果/异常。 */
export function abortable<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return task
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('aborted'))
    task.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}
