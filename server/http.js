// Tiny router + request/response helpers shared by Vercel and the local dev server.

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

export function send(res, status, body, headers = {}) {
  const json = body === undefined ? '' : JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(json);
}

export async function readBody(req, limit = 100_000) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw bad('Invalid JSON'); }
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }
  match(method, path) {
    for (const r of this.routes) {
      const m = path.match(r.re);
      if (m && r.method === method) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return this.routes.some((r) => r.re.test(path)) ? 'method' : null;
  }
}

// Validation helpers
export const str = (v, { max = 500, min = 0, name = 'field' } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw bad(`${name} is required`);
  if (s.length > max) throw bad(`${name} is too long`);
  return s;
};
export const int = (v, { min = -Infinity, max = Infinity, name = 'value' } = {}) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number${Number.isFinite(min) ? ` ≥ ${min}` : ''}`);
  return n;
};
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
