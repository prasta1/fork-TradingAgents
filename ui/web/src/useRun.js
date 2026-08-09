import { useCallback, useEffect, useRef, useState } from 'react'
import { api, streamRun } from './api.js'

const EMPTY = {
  run_id: null,
  status: 'idle',
  pipeline: [],
  node_status: {},
  node_elapsed: {},
  node_sources: {},
  reports: {},
  decision: {},
  signal: null,
  stats: {},
  investment_debate_state: {},
  risk_debate_state: {},
}

/**
 * Owns the live run: starts it, subscribes to its event stream, and folds
 * events into a snapshot the screens render from.
 *
 * The server replays a run's whole event log on connect, so this reconnects
 * cleanly after a page reload mid-run.
 */
export function useRun() {
  const [run, setRun] = useState(EMPTY)
  const [logs, setLogs] = useState([])
  const [error, setError] = useState(null)
  const closeRef = useRef(null)

  const apply = useCallback((event) => {
    switch (event.type) {
      case 'run.started':
      case 'run.finished':
        setRun((prev) => ({ ...prev, ...event }))
        break
      case 'node.started':
        setRun((prev) => ({
          ...prev,
          node_status: { ...prev.node_status, [event.node]: 'running' },
        }))
        break
      case 'node.completed':
        setRun((prev) => ({
          ...prev,
          node_status: { ...prev.node_status, [event.node]: 'complete' },
          node_elapsed: { ...prev.node_elapsed, [event.node]: event.elapsed },
        }))
        break
      case 'report':
        setRun((prev) => ({
          ...prev,
          reports: { ...prev.reports, [event.node]: event.content },
        }))
        break
      case 'decision':
        setRun((prev) => ({
          ...prev,
          decision: event.decision,
          signal: event.signal,
          report_path: event.report_path,
        }))
        break
      case 'stats':
        setRun((prev) => ({ ...prev, stats: { ...event } }))
        break
      case 'log':
        setLogs((prev) => [{ t: event.t, m: event.message, level: event.level }, ...prev].slice(0, 300))
        break
      case 'run.error':
        setError(event.message)
        break
      default:
        break
    }
  }, [])

  const subscribe = useCallback(
    (runId) => {
      closeRef.current?.()
      setLogs([])
      closeRef.current = streamRun(runId, apply)
    },
    [apply]
  )

  const attach = useCallback(
    async (runId) => {
      const snapshot = await api.getRun(runId)
      setRun(snapshot)
      setError(snapshot.error || null)
      subscribe(runId)
    },
    [subscribe]
  )

  const start = useCallback(
    async (config) => {
      setError(null)
      try {
        const snapshot = await api.startRun(config)
        setRun(snapshot)
        subscribe(snapshot.run_id)
        return snapshot
      } catch (err) {
        setError(err.detail || err.message)
        throw err
      }
    },
    [subscribe]
  )

  const cancel = useCallback(async () => {
    if (run.run_id) await api.cancelRun(run.run_id)
  }, [run.run_id])

  const reset = useCallback(() => {
    closeRef.current?.()
    setRun(EMPTY)
    setLogs([])
    setError(null)
  }, [])

  useEffect(() => () => closeRef.current?.(), [])

  return { run, logs, error, start, cancel, reset, attach }
}
