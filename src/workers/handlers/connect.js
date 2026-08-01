// Wire a MessagePort so the master can farm `chunk` work to this sub-worker.

import { handleChunkMessage } from './chunk.js';

export function handleConnect(_ctx, data) {
  const port = data.port;
  port.onmessage = (pe) => {
    if (pe.data && pe.data.type === 'chunk') handleChunkMessage(port, pe.data);
  };
}
