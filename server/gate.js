// Pre-launch gate. While it is on, everyone who opens the main site is sent to /waitlist.
// Production: the same rules live in vercel.json ("redirects"), because static files never reach the API.
// Local dev: scripts/serve.mjs applies them when SITE_GATE=1.
// The owner gets through by opening /api/preview?key=<PREVIEW_KEY> once, which sets the arsh_preview cookie.
// To launch: delete the "redirects" block from vercel.json and push.
export const PREVIEW_COOKIE = 'arsh_preview';
export const GATED = ['/', '/index', '/index.html', '/checkout', '/order', '/team'];
export const GATE_TARGET = '/waitlist';
