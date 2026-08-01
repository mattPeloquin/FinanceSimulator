// Runs the Monte Carlo off the main thread so the UI never freezes.
// Thin dispatcher: routes by message `type` to handlers under ./handlers/.
//
// Acts as either the Master Orchestrator (run / goalSeek / sensitivity) or a
// Sub-Worker (chunk) depending on the message type.

import { dispatchWorkerMessage } from './dispatch.js';

self.onmessage = async (e) => {
  await dispatchWorkerMessage(e.data, {
    post: (msg, transfer) => {
      if (transfer) self.postMessage(msg, transfer);
      else self.postMessage(msg);
    },
  });
};
