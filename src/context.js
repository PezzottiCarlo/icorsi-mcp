// Wires the session store, the transports and a short cache; every service receives this object.

import { SessionStore } from './auth/session-store.js';
import { WebTransport } from './transport/web.js';
import { WsTransport } from './transport/ws.js';
import { PadletClient } from './transport/padlet.js';
import { Memo } from './util/memo.js';

export function createContext({ store = new SessionStore(), fetchImpl = globalThis.fetch } = {}) {
  const web = new WebTransport(store, { fetchImpl });
  const ws = new WsTransport(store, web, { fetchImpl });
  const padlet = new PadletClient({ fetchImpl, userAgent: store.userAgent });
  const cache = new Memo(60_000);
  const siteInfo = () => cache.get('siteinfo', () => ws.call('core_webservice_get_site_info'));
  let userId = null;
  return {
    store,
    web,
    ws,
    padlet,
    cache,
    siteInfo,
    userId: async () => (userId ??= (await siteInfo()).userid),
  };
}
