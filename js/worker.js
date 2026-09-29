// Web Worker: runs the game simulation off the page's main thread.
import { createEngine } from './engine.js';

const engine = createEngine();
self.onmessage = (e) => {
  try {
    for (const r of engine.handle(e.data)) self.postMessage(r.msg, r.transfer || []);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.stack || err) });
  }
};
