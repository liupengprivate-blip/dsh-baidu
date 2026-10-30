/**
 * dsh-baidu — Client half.
 *
 * Registers two things into the Web shell:
 *  - `sidebar.panellist` (id `dsh-baidu`): the left sidebar launcher glyph. The
 *    shell owns the button; this contributes the icon and the label.
 *  - `main` (key `dsh-baidu`): the panel the shell shows when that launcher is
 *    selected — a simulated search engine UI.
 *
 * The page talks to its own Host half through `GET /dsh-baidu/search?q=…`,
 * which is a same-origin route, so no token or cross-origin setup is needed.
 */
window.__ModuleLoader__.load({
  id: 'dsh-baidu',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Sidebar entry id; also the `main` slot key the shell dispatches. */
    const PANEL_ID = 'dsh-baidu'
    /** The Host route this page reads. */
    const SEARCH_PATH = '/dsh-baidu/search'
    /** Results shown; the Host caps the same number. */
    const MAX_RESULTS = 10

    const CSS = `
.dshb-root {
  height: 100%;
  overflow-y: auto;
  padding: 24px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
}
.dshb-stage { max-width: 760px; margin: 0 auto; padding-top: 9vh; }
.dshb-root--searched .dshb-stage { padding-top: 0; }
.dshb-brand {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  margin-bottom: 20px;
}
.dshb-root--searched .dshb-brand { margin-bottom: 14px; }
.dshb-brand-glyph { color: var(--dsw-alias-brand-primary); flex: none; }
.dshb-brand-text {
  font-size: 26px; font-weight: 600; letter-spacing: 0.02em;
  color: var(--dsw-alias-brand-primary);
}
.dshb-root--searched .dshb-brand-text { font-size: 19px; }
.dshb-form { display: flex; align-items: center; gap: 8px; }
.dshb-input {
  flex: 1; min-width: 0; height: 44px; padding: 0 18px;
  border-radius: 22px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 15px;
  outline: none;
}
.dshb-input::placeholder { color: var(--dsw-alias-label-secondary); }
.dshb-input:focus { border-color: var(--dsw-alias-brand-primary); }
.dshb-button {
  height: 44px; padding: 0 24px; border-radius: 22px; border: none;
  background: var(--dsw-alias-brand-primary); color: #ffffff;
  font: inherit; font-size: 15px; cursor: pointer; white-space: nowrap;
}
.dshb-button:disabled { opacity: 0.45; cursor: default; }
.dshb-hint {
  margin: 12px 4px 0; font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dshb-status {
  margin: 26px 4px; font-size: 13px;
  color: var(--dsw-alias-label-secondary);
}
.dshb-status--error { color: var(--dsw-alias-state-error-primary); }
.dshb-count {
  margin: 24px 4px 4px; font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dshb-results { list-style: none; margin: 0; padding: 0; }
.dshb-result { padding: 14px 4px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshb-result:last-child { border-bottom: none; }
.dshb-title {
  display: inline-block; font-size: 17px; line-height: 1.45;
  color: var(--dsw-alias-brand-primary); text-decoration: none;
  overflow-wrap: anywhere;
}
.dshb-title:hover { text-decoration: underline; }
.dshb-url {
  margin-top: 3px; font-size: 12px;
  color: var(--dsw-alias-state-success-primary);
  overflow-wrap: anywhere;
}
.dshb-snippet {
  margin: 6px 0 0; font-size: 13px; line-height: 1.65;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.dshb-note {
  margin: 16px 4px 0; font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
`

    /** The magnifier used by both the launcher and the brand row. */
    function Magnifier(props) {
      const size = props.size || 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          focusable: false,
          className: props.className,
        },
        h('circle', { cx: 10.5, cy: 10.5, r: 6.5, stroke: 'currentColor', strokeWidth: 1.8 }),
        h('path', {
          d: 'M15.4 15.4 L20 20',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
        }),
      )
    }

    /** The sidebar launcher glyph; the shell draws the button and its state. */
    function PanellistIcon(props) {
      return h(Magnifier, { size: props.size || 20 })
    }

    /**
     * Turn a failure into the one line the page shows.
     * @param status - the HTTP status.
     * @param payload - the parsed body, when there was one.
     * @returns a human-readable message.
     */
    function failureMessage(status, payload) {
      const code = payload && payload.error
      if (code === 'missing-query') return '请输入搜索内容。'
      if (code === 'search-unavailable') return '本机没有可用的搜索服务，请先在 DSH 中配置网络搜索。'
      if (code === 'search-failed') {
        return '搜索失败：' + (payload && payload.message ? payload.message : '未知错误')
      }
      return '搜索失败（HTTP ' + status + '）。'
    }

    /**
     * Show a result URL the way a search engine does: no scheme, no bare `/`.
     * @param url - the result URL.
     * @returns the compact display text.
     */
    function displayUrl(url) {
      try {
        const parsed = new URL(url)
        const path = parsed.pathname === '/' ? '' : parsed.pathname
        return (parsed.hostname + path).replace(/\/$/, '') || url
      }
      catch {
        return url
      }
    }

    /** One result row. */
    function ResultRow(props) {
      const source = props.source
      return h(
        'li',
        { className: 'dshb-result' },
        h(
          'a',
          {
            className: 'dshb-title',
            href: source.url,
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          source.title || source.url,
        ),
        h('div', { className: 'dshb-url' }, displayUrl(source.url)),
        source.snippet ? h('p', { className: 'dshb-snippet' }, source.snippet) : null,
      )
    }

    /** The main-column panel: a simulated search engine page. */
    function SearchPanel() {
      const [draft, setDraft] = React.useState('')
      const [phase, setPhase] = React.useState('idle')
      const [state, setState] = React.useState({ query: '', sources: [], truncated: false, message: '' })
      const loading = phase === 'loading'

      const run = (raw) => {
        const query = String(raw == null ? '' : raw).trim()
        if (query === '' || loading) return
        setDraft(query)
        setPhase('loading')
        setState({ query, sources: [], truncated: false, message: '' })
        fetch(SEARCH_PATH + '?q=' + encodeURIComponent(query), {
          headers: { accept: 'application/json' },
        })
          .then(response => response.json().then(
            payload => ({ response, payload }),
            () => ({ response, payload: null }),
          ))
          .then(({ response, payload }) => {
            if (!response.ok) throw new Error(failureMessage(response.status, payload))
            const sources = Array.isArray(payload && payload.sources)
              ? payload.sources.slice(0, MAX_RESULTS)
              : []
            setState({ query, sources, truncated: payload && payload.truncated === true, message: '' })
            setPhase('done')
          })
          .catch(error => {
            setState({
              query,
              sources: [],
              truncated: false,
              message: error instanceof Error ? error.message : String(error),
            })
            setPhase('error')
          })
      }

      const onSubmit = event => {
        event.preventDefault()
        run(draft)
      }

      let body = null
      if (phase === 'loading') {
        body = h('p', { className: 'dshb-status', role: 'status' }, '搜索中…')
      }
      else if (phase === 'error') {
        body = h('p', { className: 'dshb-status dshb-status--error', role: 'alert' }, state.message)
      }
      else if (phase === 'done' && state.sources.length === 0) {
        body = h(
          'p',
          { className: 'dshb-status' },
          '没有找到与「' + state.query + '」相关的结果。',
        )
      }
      else if (phase === 'done') {
        body = h(
          'div',
          null,
          h(
            'p',
            { className: 'dshb-count' },
            '找到 ' + state.sources.length + ' 条结果 · 关键词「' + state.query + '」',
          ),
          h(
            'ol',
            { className: 'dshb-results' },
            state.sources.map((source, index) =>
              h(ResultRow, { key: source.url + '#' + index, source }),
            ),
          ),
          state.truncated
            ? h('p', { className: 'dshb-note' }, '结果已被搜索服务截断，仅展示前 ' + MAX_RESULTS + ' 条。')
            : null,
        )
      }

      return h(
        'div',
        { className: 'dshb-root' + (phase === 'idle' ? '' : ' dshb-root--searched') },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dshb-stage' },
          h(
            'div',
            { className: 'dshb-brand' },
            h(Magnifier, { size: phase === 'idle' ? 30 : 24, className: 'dshb-brand-glyph' }),
            h('span', { className: 'dshb-brand-text' }, '搜索引擎模拟器'),
          ),
          h(
            'form',
            { className: 'dshb-form', role: 'search', onSubmit },
            h('input', {
              className: 'dshb-input',
              type: 'search',
              value: draft,
              placeholder: '输入关键词，按回车或点击搜索',
              'aria-label': '搜索关键词',
              autoFocus: true,
              onChange: event => setDraft(event.target.value),
            }),
            h(
              'button',
              {
                className: 'dshb-button',
                type: 'submit',
                disabled: loading || draft.trim() === '',
              },
              loading ? '搜索中…' : '搜索',
            ),
          ),
          h('p', { className: 'dshb-hint' }, '搜索能力来自 DSH 本地搜索接口，最多展示 ' + MAX_RESULTS + ' 条结果。'),
          body,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 60,
          label: () => '搜索引擎模拟器',
        }, PanellistIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, SearchPanel))
      },
    }
  },
})
