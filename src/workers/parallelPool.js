// Parallel Monte Carlo execution across a pool of sub-workers.
// Domain code calls `run(params)`; this module owns chunking, messaging,
// and stitching transferred ArrayBuffers back into typed arrays.

import { runMonteCarlo } from '../core/simulation.js';

function splitIntoChunks(total, numWorkers) {
  const MIN_CHUNK_SIZE = 100;
  const effectiveWorkers = Math.min(
    numWorkers,
    Math.max(1, Math.floor(total / MIN_CHUNK_SIZE))
  );

  const base = Math.floor(total / effectiveWorkers);
  const remainder = total % effectiveWorkers;
  const chunks = [];
  let startIndex = 0;
  for (let i = 0; i < effectiveWorkers; i++) {
    const size = base + (i < remainder ? 1 : 0);
    if (size > 0) {
      chunks.push({ startIndex, numSimulations: size });
      startIndex += size;
    }
  }
  return chunks;
}

function stitchMonteCarloResults(params, chunkResults) {
  const totalSims = params.numSimulations;
  const { numYears } = params;
  const baseSeed = params.seed >>> 0;

  const avgReturn = new Float64Array(totalSims);
  const finalBalance = new Float64Array(totalSims);
  const totalWithdrawn = new Float64Array(totalSims);
  const earlyWithdrawn = new Float64Array(totalSims);
  const depletionYear = new Float64Array(totalSims);
  const allYearsReturns = new Float64Array(totalSims * numYears);

  for (const chunk of chunkResults) {
    const { startIndex, numSimulations, avgReturn: a, finalBalance: fb, totalWithdrawn: tw, earlyWithdrawn: ew, depletionYear: dy, allYearsReturns: yr } = chunk;
    avgReturn.set(a, startIndex);
    finalBalance.set(fb, startIndex);
    totalWithdrawn.set(tw, startIndex);
    earlyWithdrawn.set(ew, startIndex);
    depletionYear.set(dy, startIndex);
    for (let i = 0; i < numSimulations; i++) {
      allYearsReturns.set(
        yr.subarray(i * numYears, (i + 1) * numYears),
        (startIndex + i) * numYears,
      );
    }
  }

  return {
    baseSeed,
    numSimulations: totalSims,
    avgReturn,
    finalBalance,
    totalWithdrawn,
    earlyWithdrawn,
    depletionYear,
    allYearsReturns,
  };
}

function runChunkOnWorker(worker, params, startIndex, numSimulations) {
  return new Promise((resolve, reject) => {
    const onMessage = (e) => {
      const msg = e.data;
      if (msg.type === 'chunkDone') {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        const { avgReturn, finalBalance, totalWithdrawn, earlyWithdrawn, depletionYear, allYearsReturns } = msg.buffers;
        resolve({
          startIndex: msg.startIndex,
          numSimulations: msg.numSimulations,
          avgReturn: new Float64Array(avgReturn),
          finalBalance: new Float64Array(finalBalance),
          totalWithdrawn: new Float64Array(totalWithdrawn),
          earlyWithdrawn: new Float64Array(earlyWithdrawn),
          depletionYear: new Float64Array(depletionYear),
          allYearsReturns: new Float64Array(allYearsReturns),
        });
      } else if (msg.type === 'error') {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        reject(new Error(msg.message));
      }
    };
    const onError = (err) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      reject(err);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'chunk', params, startIndex, numSimulations });
  });
}

export class ParallelPool {
  constructor(WorkerClass, numCores) {
    this.WorkerClass = WorkerClass;
    this.numCores = Math.max(1, numCores);
    this.workers = [];
  }

  async run(params, { onProgress } = {}) {
    const totalSims = params.numSimulations;
    if (this.numCores <= 1 || totalSims <= 1) {
      return runMonteCarlo(params, { onProgress });
    }

    const chunks = splitIntoChunks(totalSims, Math.min(this.numCores, totalSims));
    while (this.workers.length < chunks.length) {
      this.workers.push(new this.WorkerClass());
    }

    try {
      let completedChunks = 0;
      const chunkPromises = chunks.map((chunk, i) =>
        runChunkOnWorker(this.workers[i], params, chunk.startIndex, chunk.numSimulations).then((result) => {
          completedChunks++;
          if (onProgress) onProgress(completedChunks / chunks.length);
          return result;
        }),
      );
      const chunkResults = await Promise.all(chunkPromises);
      return stitchMonteCarloResults(params, chunkResults);
    } catch (err) {
      this.terminate();
      throw err;
    }
  }

  terminate() {
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
  }
}
