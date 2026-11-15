// Vercel serverless entry. vercel.json rewrites every /api/* request here.
import { handle } from '../server/api.js';

export default function handler(req, res) {
  return handle(req, res);
}
