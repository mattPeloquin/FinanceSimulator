// Parallel Monte Carlo execution across a pool of sub-workers.
// Domain code calls `run(params)`; this module owns chunking, messaging,
// and stitching transferred ArrayBuffers back into typed arrays.
//
// Sub-workers are spawned by the MAIN THREAD and handed to the master worker
// as MessagePorts (workers can't spawn blob sub-workers from a null origin,
// e.g. when the single-file build runs over file://).

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
  const maxYears = params.maxYears ?? params.numYears;
  const baseSeed = params.seed >>> 0;

  const avgReturn = new Float64Array(totalSims);
  const finalBalance = new Float64Array(totalSims);
  const totalWithdrawn = new Float64Array(totalSims);
  const medianYearlyWithdrawal = new Float64Array(totalSims);
  const earlyWithdrawn = new Float64Array(totalSims);
  const depletionYear = new Float64Array(totalSims);
  const horizonYears = new Int32Array(totalSims);
  const allYearsReturns = new Float64Array(totalSims * maxYears);
  allYearsReturns.fill(NaN);

  for (const chunk of chunkResults) {
    const { startIndex, numSimulations, avgReturn: a, finalBalance: fb, totalWithdrawn: tw, medianYearlyWithdrawal: myw, earlyWithdrawn: ew, depletionYear: dy, horizonYears: hy, allYearsReturns: yr } = chunk;
    avgReturn.set(a, startIndex);
    finalBalance.set(fb, startIndex);
    totalWithdrawn.set(tw, startIndex);
    medianYearlyWithdrawal.set(myw, startIndex);
    earlyWithdrawn.set(ew, startIndex);
    depletionYear.set(dy, startIndex);
    horizonYears.set(hy, startIndex);
    for (let i = 0; i < numSimulations; i++) {
      allYearsReturns.set(
        yr.subarray(i * maxYears, (i + 1) * maxYears),
        (startIndex + i) * maxYears,
      );
    }
  }

  return {
    baseSeed,
    numSimulations: totalSims,
    avgReturn,
    finalBalance,
    totalWithdrawn,
    medianYearlyWithdrawal,
    earlyWithdrawn,
    depletionYear,
    horizonYears,
    allYearsReturns,
  };
}

function runChunkOnPort(port, params, startIndex, numSimulations) {
  return new Promise((resolve, reject) => {
    const onMessage = (e) => {
      const msg = e.data;
      if (msg.type === 'chunkDone') {
        port.removeEventListener('message', onMessage);
        port.removeEventListener('messageerror', onError);
        const { avgReturn, finalBalance, totalWithdrawn, medianYearlyWithdrawal, earlyWithdrawn, depletionYear, horizonYears, allYearsReturns } = msg.buffers;
        resolve({
          startIndex: msg.startIndex,
          numSimulations: msg.numSimulations,
          avgReturn: new Float64Array(avgReturn),
          finalBalance: new Float64Array(finalBalance),
          totalWithdrawn: new Float64Array(totalWithdrawn),
          medianYearlyWithdrawal: new Float64Array(medianYearlyWithdrawal),
          earlyWithdrawn: new Float64Array(earlyWithdrawn),
          depletionYear: new Float64Array(depletionYear),
          horizonYears: new Int32Array(horizonYears),
          allYearsReturns: new Float64Array(allYearsReturns),
        });
      } else if (msg.type === 'error') {
        port.removeEventListener('message', onMessage);
        port.removeEventListener('messageerror', onError);
        reject(new Error(msg.message));
      }
    };
    const onError = (err) => {
      port.removeEventListener('message', onMessage);
      port.removeEventListener('messageerror', onError);
      reject(err);
    };
    port.addEventListener('message', onMessage);
    port.addEventListener('messageerror', onError);
    port.start();
    port.postMessage({ type: 'chunk', params, startIndex, numSimulations });
  });
}

export class ParallelPool {
  constructor(subWorkerPorts, numCores) {
    this.ports = subWorkerPorts || [];
    this.numCores = Math.max(1, numCores);
  }

  async run(params, { onProgress } = {}) {
    const totalSims = params.numSimulations;
    const maxWorkers = Math.min(this.numCores, this.ports.length);
    if (maxWorkers <= 1 || totalSims <= 1) {
      return runMonteCarlo(params, { onProgress });
    }

    const chunks = splitIntoChunks(totalSims, Math.min(maxWorkers, totalSims));

    try {
      let completedChunks = 0;
      const chunkPromises = chunks.map((chunk, i) =>
        runChunkOnPort(this.ports[i], params, chunk.startIndex, chunk.numSimulations).then((result) => {
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
    for (const port of this.ports) port.close();
    this.ports = [];
  }
}
