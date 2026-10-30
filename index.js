/**
 * dsh-baidu — Host half.
 *
 * Serves one exact HTTP route, `GET /dsh-baidu/search?q=<text>`, that runs a
 * search through the DSH web access service (`ctx.web` — the same service
 * behind the agent's `web_search` tool) and answers the panel's JSON.
 *
 * The browser page shares this route's origin, so it can call it directly; the
 * route is deliberately narrow: read-only, one query parameter, a fixed
 * 10-result cap, and a same-origin guard. No other Host capability is exposed.
 *
 * @module dsh-baidu
 */

/** The exact route path. Exported for the Host test. */
export const SEARCH_PATH = '/dsh-baidu/search'

/** How many results the plugin asks for and shows. */
export const MAX_RESULTS = 10

/** Hard dependency: the route is served by the browser carrier. */
export const inject = ['webServer']

/**
 * Answer one JSON body.
 * @param res - the Node response.
 * @param status - HTTP status code.
 * @param payload - the JSON-serializable body.
 */
function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

/**
 * Whether the caller is the page this Host serves.
 *
 * Browsers send `Sec-Fetch-Site`; a cross-site value is refused so another
 * page cannot spend the user's search quota. Non-browser clients (tests,
 * curl) omit the header and are allowed.
 * @param req - the incoming request.
 * @returns whether the request may use the route.
 */
function isSameOriginFetch(req) {
  const site = req.headers['sec-fetch-site']
  if (site === undefined) return true
  return site === 'same-origin' || site === 'none'
}

/**
 * Keep only the fields the panel renders, drop useless rows, cap the list.
 * The provider decides the ranking; this only normalizes the wire shape.
 * @param sources - the provider's sources.
 * @returns at most {@link MAX_RESULTS} panel rows.
 */
function normalizeSources(sources) {
  const rows = []
  for (const source of sources) {
    if (typeof source?.url !== 'string' || source.url === '') continue
    rows.push({
      url: source.url,
      title: typeof source.title === 'string' && source.title !== '' ? source.title : source.url,
      snippet: typeof source.snippet === 'string' ? source.snippet : '',
      publishedAt: typeof source.publishedAt === 'string' ? source.publishedAt : '',
    })
    if (rows.length === MAX_RESULTS) break
  }
  return rows
}

/**
 * The Agents a search may be borrowed from, most specific first.
 *
 * Inside a turn the initiating Agent is the only honest choice. Outside one
 * (an HTTP route is outside every turn) each live root Agent is a candidate:
 * the DeepSeek provider only uses the signed-in DeepSeek Account for a call
 * made on behalf of an Agent, so without borrowing one the route would fall
 * back to a stored API key and fail for account-only setups.
 * @param agents - the agents service, or undefined when it is not mounted.
 * @returns the candidate Agents in attempt order.
 */
function candidateAgents(agents) {
  if (agents === undefined) return []
  const current = typeof agents.currentInitiator === 'function' ? agents.currentInitiator() : undefined
  if (current !== undefined) return [current]
  return typeof agents.roots === 'function' ? agents.roots() : []
}

/**
 * Whether a failure means "this Agent cannot pay for the search".
 *
 * The provider raises this before dispatching any request, so trying the next
 * candidate costs nothing and never double-charges a search.
 * @param error - a rejected search.
 * @returns whether another Agent may still succeed.
 */
function isCredentialMissing(error) {
  if (error === null || typeof error !== 'object') return false
  if (error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING') return true
  return typeof error.message === 'string' && error.message.includes('has no API key')
}

/**
 * Run the provider call, bound to an Agent when one is available.
 *
 * Candidates are tried in order and only a missing credential advances to the
 * next one; any real search failure is reported as-is.
 * @param ctx - the plugin's Host context.
 * @param web - the web access service.
 * @param query - the search text.
 * @returns the provider's result.
 */
async function searchAs(ctx, web, query) {
  const agents = ctx.get('agents')
  const candidates = candidateAgents(agents)
  const call = () => web.search({ query, maxResults: MAX_RESULTS })
  if (agents === undefined || typeof agents.withInitiator !== 'function' || candidates.length === 0) {
    return await call()
  }

  let failure
  for (const agent of candidates) {
    try {
      return await agents.withInitiator(agent, call)
    }
    catch (error) {
      failure = error
      if (!isCredentialMissing(error)) throw error
    }
  }
  throw failure
}

/**
 * Build the search route over the current Host context.
 *
 * The web service is read per request (never captured at activation) so the
 * panel keeps working across a live provider reconfiguration.
 * @param ctx - the plugin's Host context.
 * @returns the exact route to register.
 */
export function createSearchRoute(ctx) {
  return {
    kind: 'exact',
    path: SEARCH_PATH,
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.setHeader('allow', 'GET')
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      if (!isSameOriginFetch(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }

      const query = (new URL(req.url ?? '/', 'http://localhost').searchParams.get('q') ?? '').trim()
      if (query === '') {
        sendJson(res, 400, { error: 'missing-query' })
        return
      }

      const web = ctx.get('web')
      if (web === undefined || typeof web.search !== 'function') {
        sendJson(res, 503, {
          error: 'search-unavailable',
          message: 'No web search provider is available in this Host.',
        })
        return
      }

      try {
        const result = await searchAs(ctx, web, query)
        const sources = normalizeSources(Array.isArray(result?.sources) ? result.sources : [])
        sendJson(res, 200, {
          query,
          count: sources.length,
          truncated: result?.truncated === true,
          sources,
        })
      }
      catch (error) {
        sendJson(res, 502, {
          error: 'search-failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}

/**
 * Register the search route for the lifetime of this plugin row.
 * @param ctx - the plugin's Host context.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register(createSearchRoute(ctx)),
    'dsh-baidu: search route',
  )
}
