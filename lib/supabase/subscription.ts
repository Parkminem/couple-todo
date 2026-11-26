// The SDK reuses a channel for a topic until its asynchronous removal finishes.
export function queueSubscription(previous: Promise<unknown>, start: () => () => Promise<unknown>) {
  let cancelled = false
  let stop: (() => Promise<unknown>) | undefined
  const started = previous.then(() => { if (!cancelled) stop = start() })

  return () => {
    cancelled = true
    return started.then(() => stop?.()).then(() => undefined, () => undefined)
  }
}
