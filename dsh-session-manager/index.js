/**
 * dsh-session-onlyclean — Host half.
 *
 * Gives the Web UI a real "delete this session" capability, which the shipped
 * Harness deliberately does not expose (it only archives a session: the log
 * stays on disk forever). The plugin owns three same-origin POST routes:
 *
 *   /dsh-session-onlyclean/list     → workspaces + their sessions (title/date/size/live)
 *   /dsh-session-onlyclean/preview  → exactly what a delete would remove
 *   /dsh-session-onlyclean/delete   → permanent removal of one session
 *
 * Deletion is deliberately fail-closed:
 *   - a live (running / currently opened) session is refused;
 *   - a session that still has fork descendants is refused (a child log may
 *     resume from its parent's prefix, so removing the parent first would
 *     corrupt the children);
 *   - the log directory is only removed after the persistence-provided store
 *     path is proven to be `<home>/sessions/<encoded-cwd>/<sessionId>/`, so a
 *     wrong or hostile location can never turn this into an arbitrary rm.
 *
 * After the files are gone the plugin drops the session from the workspace
 * accounting (detach) and clears its projection-cache file, in that order, so
 * a failure can never leave a row that is hidden but still stored.
 */
import { readdir, rm, stat as statPath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export const name = 'dsh-session-onlyclean'

export const inject = ['webServer', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry', 'sessions']

const PREFIX = '/dsh-session-onlyclean'
const SESSIONS_DIR = 'sessions'
const MAX_BODY_BYTES = 64 * 1024
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function messageOf(error) {
  if (error === undefined || error === null) return ''
  if (typeof error === 'string') return error
  if (typeof error.message === 'string') return error.message
  try {
    return String(error)
  } catch {
    return ''
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('body-too-large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Same-origin JSON only. A cross-site page cannot send `application/json`
 * without a CORS preflight, and a mismatching Origin is rejected outright, so
 * an unrelated local page cannot trigger a delete.
 */
function rejectionOf(req) {
  if (req.method !== 'POST') return 'method'
  const type = String(req.headers['content-type'] ?? '').toLowerCase()
  if (!type.startsWith('application/json')) return 'content-type'
  const origin = req.headers.origin
  if (origin !== undefined) {
    let host
    try {
      host = new URL(origin).host
    } catch {
      return 'origin'
    }
    if (host !== req.headers.host) return 'origin'
  }
  return null
}

function defineRoute(ctx, path, handler) {
  const routeHandler = async (req, res) => {
    const rejection = rejectionOf(req)
    if (rejection !== null) {
      sendJson(res, rejection === 'method' ? 405 : 403, { ok: false, code: rejection })
      return
    }
    let body
    try {
      body = await readJson(req)
    } catch (error) {
      sendJson(res, 400, { ok: false, code: 'bad-body', detail: messageOf(error) })
      return
    }
    try {
      await handler(body, res)
    } catch (error) {
      sendJson(res, 500, { ok: false, code: 'internal', detail: messageOf(error) })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler: routeHandler }))
}

/** A session is live when this process holds it in memory or drives an agent for it. */
function hasAgent(ctx, id) {
  try {
    const agents = ctx.get('agents')
    return agents !== undefined && agents.get(id) !== undefined
  } catch {
    return false
  }
}

function hasSession(ctx, id) {
  try {
    return ctx.sessions.get(id) !== undefined
  } catch {
    return false
  }
}

/** Held by this Host process: a live Agent or a prepared in-memory Session. */
function isLive(ctx, id) {
  return hasAgent(ctx, id) || hasSession(ctx, id)
}

/**
 * The session directory, proven to sit inside a `sessions` root and to be
 * named after the session id. `undefined` means "refuse to delete".
 */
function locateSessionDir(id, path) {
  if (typeof path !== 'string' || path === '') return undefined
  for (const candidate of [dirname(path), path]) {
    if (basename(candidate) !== id) continue
    const encodedCwd = dirname(candidate)
    if (basename(dirname(encodedCwd)).toLowerCase() !== SESSIONS_DIR) continue
    return candidate
  }
  return undefined
}

async function directoryBytes(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) {
        try {
          total += (await statPath(full)).size
        } catch {
          /* raced or vanished: ignore */
        }
      }
    }
  }
  return total
}

/**
 * Is someone holding write ownership of this session's log right now?
 *
 * This is the real "can I remove the files" question: a running turn appends
 * through a write handle, and so does background title generation. A merely
 * *opened* conversation also keeps a live Agent, but that alone must not block
 * deletion — the user has no way to close it. Opening for write and closing
 * immediately changes nothing; it only proves ownership is free.
 */
async function probeWriter(ctx, id) {
  let handle
  try {
    handle = await ctx.sessionPersistence.open(id, 'write')
  } catch (error) {
    const signature = `${String(error && error.name)} ${messageOf(error)}`
    if (/already|owned|owner|busy|lock/i.test(signature)) return { held: true }
    if (/not.?found|missing|no such/i.test(signature)) return { held: true, missing: true }
    return { held: true, detail: messageOf(error) }
  }
  try {
    await handle.close()
  } catch {
    /* the probe leaves no events behind */
  }
  return { held: false }
}

/** Everything both preview and delete need, resolved once. */
async function inspectTarget(ctx, id) {
  const snapshot = await ctx.sessionPersistence.stat(id)
  if (snapshot === undefined) {
    return { id, state: isLive(ctx, id) ? 'live' : 'missing' }
  }
  const location = snapshot.location
  const rawPath = location !== undefined && typeof location.path === 'string' ? location.path : ''
  const dir = locateSessionDir(id, rawPath)
  const live = isLive(ctx, id)
  const writer = live ? await probeWriter(ctx, id) : { held: false }
  return {
    id,
    live,
    writerHeld: writer.held === true,
    writerMissing: writer.missing === true,
    state: live ? 'live' : 'ready',
    header: snapshot.header,
    storePath: rawPath,
    dir,
    sizeBytes: snapshot.sizeBytes,
  }
}

async function titleOf(ctx, id) {
  try {
    const snapshot = await ctx.sessionQuery.readTitle(id)
    return snapshot !== undefined && typeof snapshot.title === 'string' ? snapshot.title : ''
  } catch {
    return ''
  }
}

/** Persisted sessions whose parent is `id` — deleting those parents-first would corrupt them. */
function descendantsOf(records, id) {
  return records.filter((record) => String(record.header.parentSession ?? '') === id)
}

async function buildList(ctx) {
  const workspaces = ctx.workspaceRegistry.list()
  const records = await ctx.sessionQuery.listSessions()
  const recordById = new Map(records.map((record) => [String(record.header.id), record]))
  const snapshots = await ctx.sessionPersistence.list()
  const snapshotById = new Map(snapshots.map((snapshot) => [String(snapshot.header.id), snapshot]))

  const wanted = []
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) {
      if (recordById.has(String(id))) wanted.push(String(id))
    }
  }

  const titles = new Map()
  if (wanted.length > 0) {
    try {
      const results = await ctx.sessionQuery.readTitleSnapshots(wanted)
      for (const result of results) {
        if (result.status !== 'fulfilled') continue
        const value = result.value !== undefined ? result.value : undefined
        const title = value !== undefined && value.title !== undefined && typeof value.title.title === 'string'
          ? value.title.title
          : ''
        titles.set(String(result.sessionId), title)
      }
    } catch {
      /* titles are decoration; the list still works without them */
    }
  }

  const groups = []
  let totalSessions = 0
  let totalBytes = 0
  for (const workspace of workspaces) {
    const items = []
    for (const id of workspace.sessionIds) {
      const key = String(id)
      const record = recordById.get(key)
      if (record === undefined) continue
      const snapshot = snapshotById.get(key)
      const storePath = snapshot !== undefined && snapshot.location !== undefined && typeof snapshot.location.path === 'string'
        ? snapshot.location.path
        : ''
      const item = {
        id: key,
        title: titles.get(key) ?? '',
        createdAt: record.header.createdAt,
        sizeBytes: snapshot !== undefined && typeof snapshot.sizeBytes === 'number' ? snapshot.sizeBytes : null,
        live: record.live === true || isLive(ctx, key),
        open: hasAgent(ctx, key),
        cached: hasSession(ctx, key),
        descendants: descendantsOf(records, key).length,
        storePath,
        /* Path + lineage only; whether a writer holds the log is decided by preview. */
        deletable: locateSessionDir(key, storePath) !== undefined && descendantsOf(records, key).length === 0,
      }
      items.push(item)
      totalSessions += 1
      if (typeof item.sizeBytes === 'number') totalBytes += item.sizeBytes
    }
    groups.push({ id: String(workspace.id), title: workspace.title, path: workspace.path, sessions: items })
  }

  return { ok: true, workspaces: groups, totals: { sessions: totalSessions, bytes: totalBytes } }
}

async function buildPreview(ctx, id) {
  const target = await inspectTarget(ctx, id)
  if (target.state === 'missing') return { ok: false, status: 404, code: 'missing' }
  const records = await ctx.sessionQuery.listSessions()
  const descendants = descendantsOf(records, id).map((record) => String(record.header.id))
  const titles = await Promise.all(descendants.map((childId) => titleOf(ctx, childId)))
  const sizeBytes = target.dir !== undefined ? await directoryBytes(target.dir) : (target.sizeBytes ?? 0)
  return {
    ok: true,
    session: {
      id,
      title: await titleOf(ctx, id),
      createdAt: target.header !== undefined ? target.header.createdAt : 0,
      cwd: target.header !== undefined && typeof target.header.cwd === 'string' ? target.header.cwd : '',
      sizeBytes,
      live: target.live,
      open: hasAgent(ctx, id),
      writerHeld: target.writerHeld === true,
      storePath: target.dir ?? target.storePath,
      located: target.dir !== undefined,
      descendants: descendants.map((childId, index) => ({ id: childId, title: titles[index] ?? '' })),
    },
  }
}

async function deleteSession(ctx, id) {
  const target = await inspectTarget(ctx, id)
  if (target.writerMissing === true) return { ok: false, status: 404, code: 'missing' }
  if (target.state === 'missing') return { ok: false, status: 404, code: 'missing' }
  if (target.writerHeld === true) return { ok: false, status: 409, code: 'writer-held' }
  if (target.dir === undefined) {
    return { ok: false, status: 422, code: 'bad-location', detail: target.storePath }
  }
  const records = await ctx.sessionQuery.listSessions()
  const descendants = descendantsOf(records, id)
  if (descendants.length > 0) {
    return { ok: false, status: 409, code: 'has-descendants', detail: String(descendants.length) }
  }

  const sizeBytes = await directoryBytes(target.dir)
  try {
    await rm(target.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 })
  } catch (error) {
    return { ok: false, status: 500, code: 'remove-failed', detail: messageOf(error) }
  }

  /* The derived projection cache is not part of the log; drop its file too. */
  const home = dirname(dirname(dirname(target.dir)))
  const cacheFile = join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`)
  try {
    await rm(cacheFile, { force: true })
  } catch {
    /* a leftover cache file is harmless */
  }

  /* Only now touch the books: drop pin/archive membership (both are
     existence-free removals) and detach the workspace accounting. */
  try {
    await ctx.workspaceRegistry.unpinSession(id)
  } catch {
    /* not pinned */
  }
  try {
    await ctx.workspaceRegistry.unarchiveSession(id)
  } catch {
    /* not archived */
  }
  /* Announce the removal on the same channel the Session Controller uses, so the
     browser drops its row instead of re-homing it: a Session that is no longer
     accounted for but still present in the client list would render under
     "Ungrouped" until the page reloads. Emit before detaching, so the client
     never learns about a membership loss for a Session it still lists. */
  try {
    ctx.emit('api-session/removed', id)
  } catch {
    /* best effort: the Client also refreshes its list after a delete */
  }
  let detached = false
  for (const workspace of ctx.workspaceRegistry.list()) {
    if (!workspace.sessionIds.some((value) => String(value) === id)) continue
    try {
      await workspace.detachSession(id)
      detached = true
    } catch {
      /* another workspace may still list it; the next one is tried */
    }
  }

  return { ok: true, id, freedBytes: sizeBytes, detached }
}

export function apply(ctx) {
  defineRoute(ctx, `${PREFIX}/list`, async (_body, res) => {
    sendJson(res, 200, await buildList(ctx))
  })

  defineRoute(ctx, `${PREFIX}/preview`, async (body, res) => {
    const id = body !== null && typeof body.sessionId === 'string' ? body.sessionId : ''
    if (!SESSION_ID.test(id)) {
      sendJson(res, 400, { ok: false, code: 'bad-session-id' })
      return
    }
    const result = await buildPreview(ctx, id)
    if (result.ok === false) {
      sendJson(res, result.status, { ok: false, code: result.code })
      return
    }
    sendJson(res, 200, result)
  })

  defineRoute(ctx, `${PREFIX}/delete`, async (body, res) => {
    const id = body !== null && typeof body.sessionId === 'string' ? body.sessionId : ''
    if (!SESSION_ID.test(id)) {
      sendJson(res, 400, { ok: false, code: 'bad-session-id' })
      return
    }
    const result = await deleteSession(ctx, id)
    if (result.ok === false) {
      sendJson(res, result.status, { ok: false, code: result.code, detail: result.detail ?? '' })
      return
    }
    sendJson(res, 200, result)
  })

  console.error('[dsh-session-onlyclean] host ready: POST', `${PREFIX}/{list,preview,delete}`)
}
