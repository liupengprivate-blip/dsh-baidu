/**
 * Host-half tests for dsh-baidu, run with `node --test test/`.
 *
 * The Host half is one small route, so these tests drive the real handler with
 * a fake context (a route sink + a `web` service double) and a fake Node
 * response, asserting the wire contract the panel depends on.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, createSearchRoute, MAX_RESULTS, SEARCH_PATH } from '../index.js'

/** Build a plugin context whose web server collects registered routes. */
function makeContext(web, agents) {
  const routes = []
  const ctx = {
    effects: [],
    effect(callback, label) {
      this.effects.push(label)
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          routes.pop()
        }
      },
    },
    get(name) {
      if (name === 'web') return web
      if (name === 'agents') return agents
      return undefined
    },
  }
  return { ctx, routes }
}

/** A `ctx.agents` double recording which Agent each search borrowed. */
function makeAgents(options = {}) {
  const borrowed = []
  return {
    borrowed,
    currentInitiator() {
      return options.current
    },
    roots() {
      return options.roots ?? []
    },
    async withInitiator(agent, operation) {
      borrowed.push(agent.id)
      return await operation()
    },
  }
}

/** A `ctx.web` double whose failures are scripted per call. */
function makeScriptedWeb(steps) {
  let index = 0
  return {
    async search() {
      const step = steps[Math.min(index, steps.length - 1)]
      index += 1
      if (step !== undefined && step.throwing !== undefined) throw step.throwing
      return step
    },
  }
}

/** A Node-server response double that records what the route wrote. */
function makeResponse() {
  const record = { status: 0, headers: {}, body: '' }
  const res = {
    headersSent: false,
    setHeader(name, value) {
      record.headers[name.toLowerCase()] = value
    },
    writeHead(status, headers) {
      record.status = status
      for (const [name, value] of Object.entries(headers ?? {})) {
        record.headers[name.toLowerCase()] = value
      }
      return res
    },
    end(body) {
      record.body = body ?? ''
      return res
    },
  }
  return { res, record, parsed: () => JSON.parse(record.body) }
}

/** A request double for one URL and method. */
function makeRequest(url, options = {}) {
  return {
    method: options.method ?? 'GET',
    url,
    headers: options.headers ?? {},
  }
}

/** A `ctx.web` double answering one search result set. */
function makeWeb(sources, overrides = {}) {
  const calls = []
  return {
    calls,
    async search(request) {
      calls.push(request)
      if (overrides.throws) throw new Error(overrides.throws)
      return { sources, truncated: overrides.truncated === true }
    },
  }
}

/** Eleven sources, so the cap is observable. */
const MANY_SOURCES = Array.from({ length: 11 }, (_, index) => ({
  url: `https://example.com/${index + 1}`,
  title: `Title ${index + 1}`,
  snippet: `Snippet ${index + 1}`,
}))

test('registers exactly one exact GET route on the documented path', () => {
  const { ctx, routes } = makeContext(makeWeb([]))
  apply(ctx)

  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'exact')
  assert.equal(routes[0].path, SEARCH_PATH)
  assert.equal(typeof routes[0].handler, 'function')
})

test('asks the web service for at most ten results and caches nothing', async () => {
  const web = makeWeb(MANY_SOURCES)
  const { ctx, routes } = makeContext(web)
  apply(ctx)
  const { res, record, parsed } = makeResponse()

  await routes[0].handler(makeRequest(`${SEARCH_PATH}?q=deepseek`), res)

  assert.deepEqual(web.calls, [{ query: 'deepseek', maxResults: MAX_RESULTS }])
  assert.equal(MAX_RESULTS, 10)
  assert.equal(record.status, 200)
  assert.equal(record.headers['cache-control'], 'no-store')
  assert.match(record.headers['content-type'], /application\/json/)
  assert.equal(parsed().count, 10)
  assert.equal(parsed().sources.length, 10)
  assert.equal(parsed().query, 'deepseek')
})

test('normalizes rows to the panel shape and drops unusable entries', async () => {
  const web = makeWeb([
    { url: 'https://a.example/x', title: 'A', snippet: 'SA', publishedAt: '2026-01-01' },
    { url: 'https://b.example/y' },
    { title: 'no url' },
    { url: '' },
  ])
  const { ctx } = makeContext(web)
  const route = createSearchRoute(ctx)
  const { res, parsed } = makeResponse()

  await route.handler(makeRequest(`${SEARCH_PATH}?q=x`), res)

  const { sources } = parsed()
  assert.equal(sources.length, 2)
  assert.deepEqual(sources[0], {
    url: 'https://a.example/x',
    title: 'A',
    snippet: 'SA',
    publishedAt: '2026-01-01',
  })
  assert.deepEqual(sources[1], {
    url: 'https://b.example/y',
    title: 'https://b.example/y',
    snippet: '',
    publishedAt: '',
  })
})

test('passes the provider truncation flag through', async () => {
  const { ctx, routes } = makeContext(makeWeb(MANY_SOURCES, { truncated: true }))
  apply(ctx)
  const { res, parsed } = makeResponse()

  await routes[0].handler(makeRequest(`${SEARCH_PATH}?q=x`), res)

  assert.equal(parsed().truncated, true)
})

test('rejects a missing or blank query without calling the provider', async () => {
  const web = makeWeb([])
  const { ctx, routes } = makeContext(web)
  apply(ctx)

  for (const url of [SEARCH_PATH, `${SEARCH_PATH}?q=`, `${SEARCH_PATH}?q=%20%20`]) {
    const { res, record, parsed } = makeResponse()
    await routes[0].handler(makeRequest(url), res)
    assert.equal(record.status, 400)
    assert.equal(parsed().error, 'missing-query')
  }
  assert.deepEqual(web.calls, [])
})

test('answers 405 for a non-GET method', async () => {
  const { ctx, routes } = makeContext(makeWeb([]))
  apply(ctx)
  const { res, record, parsed } = makeResponse()

  await routes[0].handler(makeRequest(`${SEARCH_PATH}?q=x`, { method: 'POST' }), res)

  assert.equal(record.status, 405)
  assert.equal(record.headers.allow, 'GET')
  assert.equal(parsed().error, 'method-not-allowed')
})

test('refuses a cross-site browser request', async () => {
  const web = makeWeb([])
  const { ctx, routes } = makeContext(web)
  apply(ctx)
  const { res, record, parsed } = makeResponse()

  await routes[0].handler(
    makeRequest(`${SEARCH_PATH}?q=x`, { headers: { 'sec-fetch-site': 'cross-site' } }),
    res,
  )

  assert.equal(record.status, 403)
  assert.equal(parsed().error, 'forbidden')
  assert.deepEqual(web.calls, [])
})

test('accepts a same-origin browser request', async () => {
  const { ctx, routes } = makeContext(makeWeb([{ url: 'https://a.example/', title: 'A' }]))
  apply(ctx)
  const { res, record } = makeResponse()

  await routes[0].handler(
    makeRequest(`${SEARCH_PATH}?q=x`, { headers: { 'sec-fetch-site': 'same-origin' } }),
    res,
  )

  assert.equal(record.status, 200)
})

test('answers 503 when the host has no web search service', async () => {
  const { ctx, routes } = makeContext(undefined)
  apply(ctx)
  const { res, record, parsed } = makeResponse()

  await routes[0].handler(makeRequest(`${SEARCH_PATH}?q=x`), res)

  assert.equal(record.status, 503)
  assert.equal(parsed().error, 'search-unavailable')
})

test('answers 502 with the reason when the provider throws', async () => {
  const { ctx, routes } = makeContext(makeWeb([], { throws: 'provider exploded' }))
  apply(ctx)
  const { res, record, parsed } = makeResponse()

  await routes[0].handler(makeRequest(`${SEARCH_PATH}?q=x`), res)

  assert.equal(record.status, 502)
  assert.equal(parsed().error, 'search-failed')
  assert.match(parsed().message, /provider exploded/)
})

test('reads the web service per request, not at activation', async () => {
  const first = makeWeb([{ url: 'https://one.example/' }])
  const { ctx, routes } = makeContext(first)
  apply(ctx)

  const second = makeWeb([{ url: 'https://two.example/' }])
  ctx.get = name => (name === 'web' ? second : undefined)

  const { res, parsed } = makeResponse()
  await routes[0].handler(makeRequest(`${SEARCH_PATH}?q=x`), res)

  assert.equal(parsed().sources[0].url, 'https://two.example/')
  assert.equal(first.calls.length, 0)
})

test('borrows the initiating Agent when the call happens inside a turn', async () => {
  const agents = makeAgents({ current: { id: 'current-agent' }, roots: [{ id: 'root-a' }] })
  const web = makeWeb([{ url: 'https://a.example/' }])
  const { ctx, routes } = makeContext(web, agents)
  apply(ctx)
  const { res, record } = makeResponse()

  await routes[0].handler(makeRequest(`${SEARCH_PATH}?q=x`), res)

  assert.equal(record.status, 200)
  assert.deepEqual(agents.borrowed, ['current-agent'])
})

test('outside a turn, it borrows a live root Agent', async () => {
  const agents = makeAgents({ roots: [{ id: 'root-a' }] })
  const web = makeWeb([{ url: 'https://a.example/' }])
  const { ctx, routes } = makeContext(web, agents)
  apply(ctx)
  const { res, record } = makeResponse()

  await routes[0].handler(makeRequest(`${SEARCH_PATH}?q=x`), res)

  assert.equal(record.status, 200)
  assert.deepEqual(agents.borrowed, ['root-a'])
})

test('moves to the next Agent only when the credential is missing', async () => {
  const credentialMissing = Object.assign(new Error('no api key'), {
    code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
  })
  const agents = makeAgents({ roots: [{ id: 'root-a' }, { id: 'root-b' }] })
  const web = makeScriptedWeb([
    { throwing: credentialMissing },
    { sources: [{ url: 'https://second.example/' }], truncated: false },
  ])
  const { ctx, routes } = makeContext(web, agents)
  apply(ctx)
  const { res, parsed } = makeResponse()

  await routes[0].handler(makeRequest(`${SEARCH_PATH}?q=x`), res)

  assert.deepEqual(agents.borrowed, ['root-a', 'root-b'])
  assert.equal(parsed().sources[0].url, 'https://second.example/')
})

test('a real search failure is reported without trying another Agent', async () => {
  const agents = makeAgents({ roots: [{ id: 'root-a' }, { id: 'root-b' }] })
  const web = makeScriptedWeb([{ throwing: new Error('provider exploded') }])
  const { ctx, routes } = makeContext(web, agents)
  apply(ctx)
  const { res, record, parsed } = makeResponse()

  await routes[0].handler(makeRequest(`${SEARCH_PATH}?q=x`), res)

  assert.equal(record.status, 502)
  assert.deepEqual(agents.borrowed, ['root-a'])
  assert.match(parsed().message, /provider exploded/)
})

test('reports the last credential failure when no Agent can pay', async () => {
  const credentialMissing = Object.assign(new Error('no api key'), {
    code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
  })
  const agents = makeAgents({ roots: [{ id: 'root-a' }, { id: 'root-b' }] })
  const web = makeScriptedWeb([{ throwing: credentialMissing }])
  const { ctx, routes } = makeContext(web, agents)
  apply(ctx)
  const { res, record, parsed } = makeResponse()

  await routes[0].handler(makeRequest(`${SEARCH_PATH}?q=x`), res)

  assert.equal(record.status, 502)
  assert.deepEqual(agents.borrowed, ['root-a', 'root-b'])
  assert.match(parsed().message, /no api key/)
})
