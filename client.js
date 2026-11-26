/**
 * dsh-session-onlyclean — Client half.
 *
 * Two surfaces, one shared confirm dialog rendered in `shell.overlay`:
 *   - a trash button on every sidebar session row (`sidebar.workspaces.session.row.action`);
 *   - a "Session manager" settings page grouped by workspace (`settings.section`).
 *
 * All work happens on the Host: the browser only asks for a preview and then
 * asks to delete, through same-origin POST routes registered by index.js.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-onlyclean',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-session-onlyclean'
    const API = '/dsh-session-onlyclean'
    const STYLE_ID = 'dsh-session-onlyclean'

    const zh = {
      nav: '会话管理',
      title: '会话管理',
      hint: '按工作区列出本机会话，可永久删除不再需要的记录。删除只影响这台机器，且不可恢复。',
      refresh: '刷新',
      loading: '正在读取会话…',
      refreshing: '正在刷新…',
      empty: '还没有可删除的会话。',
      emptyWorkspace: '这个工作区没有可删除的会话。',
      total: '共 {n} 个会话 · {size}',
      delete: '删除',
      action: '删除会话',
      open: '已打开',
      hasForks: '{n} 个分叉',
      untitled: '（未命名会话）',
      confirmTitle: '删除会话',
      irreversible: '此操作会永久删除该会话在本机的全部记录（含日志），无法恢复。',
      reading: '正在读取会话信息…',
      cancel: '取消',
      deleting: '正在删除…',
      confirm: '永久删除',
      deleted: '已删除会话',
      created: '创建于',
      size: '大小',
      path: '记录位置',
      errBusy: '该会话仍被宿主进程占用（正在运行，或本次运行中打开过），暂时不能删除。结束运行或重启 DSH 后再试。',
      noteOpen: '该会话仍在界面中打开；删除后请刷新页面。',
      errMissing: '该会话的记录已不存在。',
      errForks: '该会话有 {n} 个分叉子会话，请先删除它们。',
      errBadLocation: '无法确认该会话的存储位置，已拒绝删除。',
      errRemove: '删除文件失败，可能被其他进程占用。',
      errUnknown: '操作失败，请稍后重试。',
      errLoad: '读取会话列表失败。',
      retry: '重试',
    }

    const en = {
      nav: 'Session manager',
      title: 'Session manager',
      hint: 'Lists this machine’s sessions by workspace and permanently deletes the ones you pick. Deletion is local and cannot be undone.',
      refresh: 'Refresh',
      loading: 'Loading sessions…',
      refreshing: 'Refreshing…',
      empty: 'No sessions to delete yet.',
      emptyWorkspace: 'This workspace has no sessions to delete.',
      total: '{n} sessions · {size}',
      delete: 'Delete',
      action: 'Delete session',
      open: 'Open',
      hasForks: '{n} forks',
      untitled: '(Untitled session)',
      confirmTitle: 'Delete session',
      irreversible: 'This permanently removes the session’s local records, including its log. It cannot be undone.',
      reading: 'Reading session details…',
      cancel: 'Cancel',
      deleting: 'Deleting…',
      confirm: 'Delete permanently',
      deleted: 'Session deleted',
      created: 'Created',
      size: 'Size',
      path: 'Stored at',
      errBusy: 'This session is still held by the Host process (running, or opened during this DSH run), so it cannot be deleted yet. Stop it or restart DSH first.',
      noteOpen: 'This session is still open in the UI. Refresh the page after deleting it.',
      errMissing: 'This session’s records are already gone.',
      errForks: 'This session has {n} fork(s). Delete those first.',
      errBadLocation: 'The session’s storage location could not be verified, so deletion was refused.',
      errRemove: 'Could not remove the files; another process may be holding them.',
      errUnknown: 'The operation failed. Try again.',
      errLoad: 'Could not load the session list.',
      retry: 'Retry',
    }

    const CSS = [
      '.dsh-sm-page{display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;padding-bottom:24px}',
      '.dsh-sm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
      '.dsh-sm-title{margin:0;font-size:16px;font-weight:500;line-height:24px}',
      '.dsh-sm-hint{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-sm-toolbar{display:flex;align-items:center;gap:8px;flex:none}',
      '.dsh-sm-count{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsh-sm-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 14px;font:inherit;font-size:12px;line-height:20px;cursor:pointer;white-space:nowrap}',
      '.dsh-sm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-sm-btn:disabled{opacity:.5;cursor:default}',
      '.dsh-sm-btn:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}',
      '.dsh-sm-btn--sm{padding:2px 10px}',
      '.dsh-sm-btn--danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-sm-btn--danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-sm-ws{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden}',
      '.dsh-sm-ws-head{display:flex;align-items:baseline;gap:8px;padding:9px 14px;background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-sm-ws-name{font-weight:500;white-space:nowrap}',
      '.dsh-sm-ws-path{font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all;min-width:0}',
      '.dsh-sm-ws-count{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsh-sm-row{display:flex;align-items:center;gap:12px;padding:8px 14px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dsh-sm-row-main{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}',
      '.dsh-sm-row-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-sm-row-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-sm-row-id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-secondary);opacity:.8}',
      '.dsh-sm-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2)}',
      '.dsh-sm-badge--live{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.dsh-sm-badge--warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.dsh-sm-empty{padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-sm-status{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-sm-error-line{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
      '.dsh-sm-rowbtn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}',
      '.dsh-sm-rowbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-sm-rowbtn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}',
      '.dsh-sm-mask{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.45);pointer-events:auto}',
      '.dsh-sm-dialog{display:flex;flex-direction:column;gap:12px;box-sizing:border-box;width:420px;max-width:100%;padding:16px 18px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35)}',
      '.dsh-sm-dialog-title{font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary)}',
      '.dsh-sm-target{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-sm-target-title{font-size:13px;line-height:20px;word-break:break-word}',
      '.dsh-sm-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:17px;word-break:break-all;color:var(--dsw-alias-label-secondary);user-select:text}',
      '.dsh-sm-warn{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary)}',
      '.dsh-sm-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
      '.dsh-sm-actions{display:flex;justify-content:flex-end;gap:8px}',
      '.dsh-sm-toast{position:fixed;left:50%;bottom:28px;z-index:2147483601;transform:translateX(-50%);max-width:80vw;padding:8px 16px;border-radius:999px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 8px 24px rgba(0,0,0,.3);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-sm-toast.is-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
    ].join('\n')

    /* ---------------------------------------------------------------- store */

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get() {
          return state
        },
        set(next) {
          state = next
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }
    }

    const store = createStore({ revision: 0, open: null, toast: null })

    let translate = (key) => key
    let toastTimer = null
    let sessionStore = null

    function refreshSessionList() {
      const sessions = sessionStore
      if (sessions === null || typeof sessions.refresh !== 'function') return
      try {
        void sessions.refresh().catch(() => {})
      } catch {
        /* the Host event already asked the list to drop the row */
      }
    }

    function useStore() {
      const [, setVersion] = useState(0)
      useEffect(() => store.subscribe(() => setVersion((version) => version + 1)), [])
      return store.get()
    }

    function useLocaleVersion(locale) {
      const [, setVersion] = useState(0)
      useEffect(() => {
        if (locale === undefined || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => setVersion((version) => version + 1))
      }, [locale])
    }

    /* ----------------------------------------------------------------- http */

    async function post(path, body) {
      const response = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body === undefined ? {} : body),
      })
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok || data === null || data.ok === false) {
        const code = data !== null && typeof data.code === 'string' ? data.code : 'http-' + response.status
        const error = new Error(code)
        error.code = code
        throw error
      }
      return data
    }

    /* ------------------------------------------------------------- helpers */

    function formatWhen(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
      try {
        return new Date(ms).toLocaleString(undefined, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      } catch {
        return ''
      }
    }

    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
      if (bytes < 1024) return bytes + ' B'
      const units = ['KB', 'MB', 'GB']
      let value = bytes / 1024
      let index = 0
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024
        index += 1
      }
      return (value >= 10 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[index]
    }

    function shortId(id) {
      const text = String(id)
      return text.length > 22 ? '…' + text.slice(-10) : text
    }

    function canDelete(info) {
      return (
        info !== null &&
        info !== undefined &&
        info.located === true &&
        info.writerHeld !== true &&
        info.descendants.length === 0
      )
    }

    function errorText(code) {
      if (code === 'writer-held' || code === 'live') return translate('errBusy')
      if (code === 'missing') return translate('errMissing')
      if (code === 'has-descendants') return translate('errForks').replace('{n}', '1+')
      if (code === 'bad-location') return translate('errBadLocation')
      if (code === 'remove-failed') return translate('errRemove')
      return translate('errUnknown')
    }

    function icon(paths, size) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', style: { display: 'block' } },
        paths.map((d, index) =>
          h('path', {
            key: index,
            d,
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        ),
      )
    }

    const TRASH = [
      'M2.5 4.2h11',
      'M6.2 4.2V2.8c0-.33.27-.6.6-.6h2.4c.33 0 .6.27.6.6v1.4',
      'M4.1 4.2l.62 8.5c.06.79.72 1.5 1.5 1.5h3.56c.78 0 1.44-.71 1.5-1.5l.62-8.5',
      'M6.6 7.2v3.9',
      'M9.4 7.2v3.9',
    ]

    /* ------------------------------------------------------------- dialogs */

    function openConfirm(sessionId) {
      store.set({ ...store.get(), open: { sessionId, phase: 'loading', info: null, error: '' } })
      void (async () => {
        try {
          const data = await post('/preview', { sessionId })
          const current = store.get().open
          if (current === null || current.sessionId !== sessionId) return
          store.set({ ...store.get(), open: { sessionId, phase: 'ready', info: data.session, error: '' } })
        } catch (error) {
          const current = store.get().open
          if (current === null || current.sessionId !== sessionId) return
          store.set({ ...store.get(), open: { sessionId, phase: 'error', info: null, error: error.code } })
        }
      })()
    }

    function closeConfirm() {
      store.set({ ...store.get(), open: null })
    }

    async function runDelete() {
      const current = store.get().open
      if (current === null || current.phase !== 'ready' || !canDelete(current.info)) return
      store.set({ ...store.get(), open: { ...current, phase: 'deleting', error: '' } })
      try {
        await post('/delete', { sessionId: current.sessionId })
        /* The sidebar's Ungrouped bucket is derived from the Client Session list
           minus Workspace membership. Without this pull, the row survives the
           Host removal and re-homes itself under Ungrouped until a page reload. */
        refreshSessionList()
        const title = current.info.title !== '' ? current.info.title : translate('untitled')
        store.set({ revision: store.get().revision + 1, open: null, toast: { text: translate('deleted') + ' · ' + title, tone: 'success' } })
        if (toastTimer !== null) clearTimeout(toastTimer)
        toastTimer = setTimeout(() => {
          toastTimer = null
          store.set({ ...store.get(), toast: null })
        }, 4000)
      } catch (error) {
        store.set({ ...store.get(), open: { ...current, phase: 'ready', error: error.code } })
      }
    }

    function ConfirmOverlay(props) {
      const { t, locale } = props
      useLocaleVersion(locale)
      const state = useStore()
      const cancelRef = useRef(null)
      const open = state.open
      const busy = open !== null && (open.phase === 'deleting' || open.phase === 'loading')

      useEffect(() => {
        if (open === null) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation()
            closeConfirm()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [open === null ? null : open.sessionId, busy])

      useEffect(() => {
        if (open === null) return
        const timer = setTimeout(() => {
          if (cancelRef.current !== null) cancelRef.current.focus()
        }, 0)
        return () => clearTimeout(timer)
      }, [open === null ? null : open.sessionId])

      const dialog = open === null ? null : buildDialog(t, open, cancelRef)
      const toast =
        state.toast === null
          ? null
          : h('div', { className: 'dsh-sm-toast' + (state.toast.tone === 'error' ? ' is-error' : '') }, state.toast.text)

      return h(React.Fragment, null, dialog, toast)
    }

    function buildDialog(t, open, cancelRef) {
      const info = open.info
      const body = []

      if (open.phase === 'loading') {
        body.push(h('div', { key: 'loading', className: 'dsh-sm-status' }, t('reading')))
      } else if (open.phase === 'error') {
        body.push(h('p', { key: 'error', className: 'dsh-sm-error' }, errorText(open.error)))
      } else if (info !== null) {
        body.push(
          h(
            'div',
            { key: 'target', className: 'dsh-sm-target' },
            h('div', { className: 'dsh-sm-target-title' }, info.title !== '' ? info.title : t('untitled')),
            h(
              'div',
              { className: 'dsh-sm-row-meta' },
              formatWhen(info.createdAt) !== '' ? h('span', { key: 'when' }, t('created') + ' ' + formatWhen(info.createdAt)) : null,
              formatBytes(info.sizeBytes) !== '' ? h('span', { key: 'size' }, formatBytes(info.sizeBytes)) : null,
            ),
          ),
          h('div', { key: 'path', className: 'dsh-sm-path' }, info.storePath),
          h('p', { key: 'warn', className: 'dsh-sm-warn' }, t('irreversible')),
        )
        if (info.writerHeld === true) body.push(h('p', { key: 'busy', className: 'dsh-sm-error' }, t('errBusy')))
        else if (info.live === true) body.push(h('p', { key: 'open', className: 'dsh-sm-warn' }, t('noteOpen')))
        if (info.located !== true) body.push(h('p', { key: 'loc', className: 'dsh-sm-error' }, t('errBadLocation')))
        if (info.descendants.length > 0) {
          body.push(
            h('p', { key: 'forks', className: 'dsh-sm-error' }, t('errForks').replace('{n}', String(info.descendants.length))),
          )
        }
        if (open.error !== '') body.push(h('p', { key: 'op-error', className: 'dsh-sm-error' }, errorText(open.error)))
      }

      const deleteDisabled = open.phase !== 'ready' || !canDelete(info)

      return h(
        'div',
        {
          className: 'dsh-sm-mask',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !busyOf(open)) closeConfirm()
          },
        },
        h(
          'div',
          {
            className: 'dsh-sm-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'dsh-sm-dialog-title',
          },
          h('div', { id: 'dsh-sm-dialog-title', className: 'dsh-sm-dialog-title' }, t('confirmTitle')),
          body,
          h(
            'div',
            { className: 'dsh-sm-actions' },
            h(
              'button',
              {
                key: 'cancel',
                ref: cancelRef,
                type: 'button',
                className: 'dsh-sm-btn',
                onClick: () => {
                  if (!busyOf(open)) closeConfirm()
                },
              },
              t('cancel'),
            ),
            h(
              'button',
              {
                key: 'delete',
                type: 'button',
                className: 'dsh-sm-btn dsh-sm-btn--danger',
                disabled: deleteDisabled,
                onClick: () => {
                  void runDelete()
                },
              },
              open.phase === 'deleting' ? t('deleting') : t('confirm'),
            ),
          ),
        ),
      )
    }

    function busyOf(open) {
      return open.phase === 'deleting' || open.phase === 'loading'
    }

    /* ------------------------------------------------------- sidebar action */

    function SessionRowAction(props) {
      const { t, locale, sessionId } = props
      useLocaleVersion(locale)
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-sm-rowbtn',
          title: t('action'),
          'aria-label': t('action'),
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            openConfirm(sessionId)
          },
        },
        icon(TRASH, 14),
      )
    }

    /* ------------------------------------------------------- settings page */

    function SessionManagerSection(props) {
      const { t, locale } = props
      useLocaleVersion(locale)
      const state = useStore()
      const [data, setData] = useState(null)
      const [status, setStatus] = useState('loading')
      const [error, setError] = useState('')

      const load = useCallback(async () => {
        setStatus((previous) => (data === null ? 'loading' : 'refreshing'))
        try {
          const next = await post('/list')
          setData(next)
          setStatus('ready')
          setError('')
        } catch (failure) {
          setStatus('error')
          setError(failure.code)
        }
      }, [data])

      useEffect(() => {
        void load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const revision = state.revision
      const firstRevision = useRef(revision)
      useEffect(() => {
        if (revision !== firstRevision.current) {
          firstRevision.current = revision
          void load()
        }
      }, [revision, load])

      const refresh = () => {
        void load()
      }

      const header = h(
        'div',
        { className: 'dsh-sm-head' },
        h(
          'div',
          { style: { minWidth: 0 } },
          h('h1', { className: 'dsh-sm-title' }, t('title')),
          h('p', { className: 'dsh-sm-hint' }, t('hint')),
        ),
        h(
          'div',
          { className: 'dsh-sm-toolbar' },
          data !== null
            ? h(
                'span',
                { className: 'dsh-sm-count' },
                t('total').replace('{n}', String(data.totals.sessions)).replace('{size}', formatBytes(data.totals.bytes)),
              )
            : null,
          h(
            'button',
            { type: 'button', className: 'dsh-sm-btn dsh-sm-btn--sm', onClick: refresh, disabled: status === 'loading' || status === 'refreshing' },
            status === 'loading' || status === 'refreshing' ? t('refreshing') : t('refresh'),
          ),
        ),
      )

      const body = []
      if (status === 'loading' && data === null) {
        body.push(h('div', { key: 'loading', className: 'dsh-sm-status' }, t('loading')))
      } else if (status === 'error' && data === null) {
        body.push(
          h(
            'div',
            { key: 'error', style: { display: 'flex', alignItems: 'center', gap: '10px' } },
            h('span', { className: 'dsh-sm-error-line' }, t('errLoad')),
            h('button', { type: 'button', className: 'dsh-sm-btn dsh-sm-btn--sm', onClick: refresh }, t('retry')),
          ),
        )
      } else if (data !== null && data.workspaces.length === 0) {
        body.push(h('div', { key: 'empty', className: 'dsh-sm-status' }, t('empty')))
      } else if (data !== null) {
        if (status === 'error') {
          body.push(h('div', { key: 'reload-error', className: 'dsh-sm-error-line' }, t('errLoad')))
        }
        for (const workspace of data.workspaces) {
          const sessions = workspace.sessions
          body.push(
            h(
              'div',
              { key: workspace.id, className: 'dsh-sm-ws' },
              h(
                'div',
                { className: 'dsh-sm-ws-head' },
                h('span', { className: 'dsh-sm-ws-name' }, workspace.title),
                h('span', { className: 'dsh-sm-ws-path' }, workspace.path),
                h('span', { className: 'dsh-sm-ws-count' }, String(sessions.length)),
              ),
              sessions.length === 0
                ? h('div', { className: 'dsh-sm-empty' }, t('emptyWorkspace'))
                : sessions.map((session) => sessionRow(t, session)),
            ),
          )
        }
      }

      return h('div', { className: 'dsh-sm-page' }, header, body)
    }

    function sessionRow(t, session) {
      const meta = [
        formatWhen(session.createdAt) !== '' ? h('span', { key: 'when' }, formatWhen(session.createdAt)) : null,
        typeof session.sizeBytes === 'number' ? h('span', { key: 'size' }, formatBytes(session.sizeBytes)) : null,
        h('span', { key: 'id', className: 'dsh-sm-row-id' }, shortId(session.id)),
      ]
      if (session.open === true) meta.push(h('span', { key: 'open', className: 'dsh-sm-badge dsh-sm-badge--live' }, t('open')))
      if (session.descendants > 0) {
        meta.push(
          h('span', { key: 'forks', className: 'dsh-sm-badge dsh-sm-badge--warn' }, t('hasForks').replace('{n}', String(session.descendants))),
        )
      }
      return h(
        'div',
        { key: session.id, className: 'dsh-sm-row' },
        h(
          'div',
          { className: 'dsh-sm-row-main' },
          h('div', { className: 'dsh-sm-row-title' }, session.title !== '' ? session.title : t('untitled')),
          h('div', { className: 'dsh-sm-row-meta' }, meta),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-sm-btn dsh-sm-btn--danger dsh-sm-btn--sm',
            onClick: () => openConfirm(session.id),
          },
          t('delete'),
        ),
      )
    }

    /* ---------------------------------------------------------------- apply */

    function injectStyles() {
      if (typeof document === 'undefined') return () => {}
      /* One tag per client run: an HMR replacement may overlap the old run, and
         a shared tag would be removed by whichever disposer fires first. */
      const tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', STYLE_ID)
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    function apply(ctx) {
      translate = ctx.locale.bind(NS)
      sessionStore = ctx.get('sessions') ?? null
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-onlyclean: dictionaries')
      ctx.effect(() => injectStyles(), 'dsh-session-onlyclean: styles')
      ctx.effect(
        () => () => {
          if (toastTimer !== null) {
            clearTimeout(toastTimer)
            toastTimer = null
          }
        },
        'dsh-session-onlyclean: toast timer',
      )

      const inject = () => ({ t: translate, locale: ctx.locale })

      ctx.slots.inject('sidebar.workspaces.session.row.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.row.action',
            id: 'session-delete',
            order: 300,
            inject,
          },
          SessionRowAction,
        ),
      )

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'session-manager',
            order: 70,
            label: () => translate('nav'),
            inject,
          },
          SessionManagerSection,
        ),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'session-manager.confirm',
            inject,
          },
          ConfirmOverlay,
        ),
      )
    }

    return { name: 'dsh-session-onlyclean', inject: ['slots', 'locale'], apply }
  },
})
