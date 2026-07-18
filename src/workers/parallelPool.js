// Parallel Monte Carlo execution across a pool of sub-workers.
// Domain code calls `run(params)`; this module owns chunking, messaging,
// and stitching transferred ArrayBuffers back into typed arrays.
//
// Sub-workers are spawned by the MAIN THREAD and handed to the master worker
// as MessagePorts (workers can't spawn blob sub-workers from a null origin,
// e.g. when the single-file build runs over file://).

import { runMonteCarlo } from '../core/simulation.js';

function splitIntoChunks(total, numWorkers) {
  const MIN_CHUNK_SIZE = 150;
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

export function stitchMonteCarloResults(params, chunkResults) {
  const totalSims = params.numSimulations;
  const maxYears = params.maxYears ?? params.numYears;
  const baseSeed = params.seed >>> 0;

  const avgReturn = new Float64Array(totalSims);
  const irr = new Float64Array(totalSims);
  const finalBalance = new Float64Array(totalSims);
  const totalWithdrawn = new Float64Array(totalSims);
  const totalNetSpend = new Float64Array(totalSims);
  const medianYearlyWithdrawal = new Float64Array(totalSims);
  const medianYearlyNetSpend = new Float64Array(totalSims);
  const earlyWithdrawn = new Float64Array(totalSims);
  const depletionYear = new Float64Array(totalSims);
  const horizonYears = new Int32Array(totalSims);
  const allYearsReturns = new Float64Array(totalSims * maxYears);
  allYearsReturns.fill(NaN);
  const allYearsWithdrawals = new Float64Array(totalSims * maxYears);
  allYearsWithdrawals.fill(NaN);
  const allYearsNetSpend = new Float64Array(totalSims * maxYears);
  allYearsNetSpend.fill(NaN);

  for (const chunk of chunkResults) {
    const {
      startIndex,
      numSimulations,
      avgReturn: a,
      irr: ir,
      finalBalance: fb,
      totalWithdrawn: tw,
      totalNetSpend: tns,
      medianYearlyWithdrawal: myw,
      medianYearlyNetSpend: myns,
      earlyWithdrawn: ew,
      depletionYear: dy,
      horizonYears: hy,
      allYearsReturns: yr,
      allYearsWithdrawals: yw,
      allYearsNetSpend: yn,
    } = chunk;
    avgReturn.set(a, startIndex);
    irr.set(ir, startIndex);
    finalBalance.set(fb, startIndex);
    totalWithdrawn.set(tw, startIndex);
    totalNetSpend.set(tns, startIndex);
    medianYearlyWithdrawal.set(myw, startIndex);
    medianYearlyNetSpend.set(myns, startIndex);
    earlyWithdrawn.set(ew, startIndex);
    depletionYear.set(dy, startIndex);
    horizonYears.set(hy, startIndex);
    for (let i = 0; i < numSimulations; i++) {
      allYearsReturns.set(
        yr.subarray(i * maxYears, (i + 1) * maxYears),
        (startIndex + i) * maxYears,
      );
      allYearsWithdrawals.set(
        yw.subarray(i * maxYears, (i + 1) * maxYears),
        (startIndex + i) * maxYears,
      );
      allYearsNetSpend.set(
        yn.subarray(i * maxYears, (i + 1) * maxYears),
        (startIndex + i) * maxYears,
      );
    }
  }

  return {
    baseSeed,
    numSimulations: totalSims,
    avgReturn,
    irr,
    finalBalance,
    totalWithdrawn,
    totalNetSpend,
    medianYearlyWithdrawal,
    medianYearlyNetSpend,
    earlyWithdrawn,
    depletionYear,
    horizonYears,
    allYearsReturns,
    allYearsWithdrawals,
    allYearsNetSpend,
  };
}

function runChunkOnPort(port, params, startIndex, numSimulations) {
  return new Promise((resolve, reject) => {
    const onMessage = (e) => {
      const msg = e.data;
      if (msg.type === 'chunkDone') {
        port.removeEventListener('message', onMessage);
        port.removeEventListener('messageerror', onError);
        const {
          avgReturn,
          irr,
          finalBalance,
          totalWithdrawn,
          totalNetSpend,
          medianYearlyWithdrawal,
          medianYearlyNetSpend,
          earlyWithdrawn,
          depletionYear,
          horizonYears,
          allYearsReturns,
          allYearsWithdrawals,
          allYearsNetSpend,
        } = msg.buffers;
        resolve({
          startIndex: msg.startIndex,
          numSimulations: msg.numSimulations,
          avgReturn: new Float64Array(avgReturn),
          irr: new Float64Array(irr),
          finalBalance: new Float64Array(finalBalance),
          totalWithdrawn: new Float64Array(totalWithdrawn),
          totalNetSpend: new Float64Array(totalNetSpend),
          medianYearlyWithdrawal: new Float64Array(medianYearlyWithdrawal),
          medianYearlyNetSpend: new Float64Array(medianYearlyNetSpend),
          earlyWithdrawn: new Float64Array(earlyWithdrawn),
          depletionYear: new Float64Array(depletionYear),
          horizonYears: new Int32Array(horizonYears),
          allYearsReturns: new Float64Array(allYearsReturns),
          allYearsWithdrawals: new Float64Array(allYearsWithdrawals),
          allYearsNetSpend: new Float64Array(allYearsNetSpend),
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