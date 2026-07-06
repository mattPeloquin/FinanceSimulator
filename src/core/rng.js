// Seedable pseudo-random number generator.
//
// Using a deterministic PRNG (instead of Math.random) makes every run
// reproducible: the same seed + scenario always yields identical results.
// It also enables a major memory optimisation — we can throw away the full
// per-simulation paths and regenerate any individual path on demand simply
// by re-seeding with that simulation's derived seed.

// mulberry32: tiny, fast, good-enough statistical quality for Monte Carlo.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mix a base seed with an integer index to get a well-distributed per-stream seed.
export function deriveSeed(baseSeed, index) {
  let h = (baseSeed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Convert an asset's arithmetic mean/stdDev (as decimals) into the underlying
// log-normal distribution's `mu`/`sigma` parameters. These only depend on the
// asset's fixed mean/stdDev — never on the random draw — so callers that run
// many years/simulations for the *same* asset (like the Monte Carlo engine)
// should compute this once and reuse it, rather than recomputing it on every
// draw (see `applyLogNormalMuSigma`).
export function logNormalMuSigma(mean, stdDev) {
  const m = 1 + mean;
  const s = stdDev;
  const sigma2 = Math.log(1 + (s * s) / (m * m));
  const mu = Math.log(m) - sigma2 / 2.0;
  const sigma = Math.sqrt(sigma2);
  return { mu, sigma };
}

// Map a *supplied* standard-normal draw `z` to a log-normal return using
// pre-computed `mu`/`sigma` (from `logNormalMuSigma`). Cheap: no logs/sqrt.
export function applyLogNormalMuSigma(mu, sigma, z) {
  return Math.exp(mu + sigma * z) - 1;
}

export function createRng(seed) {
  const uniform = mulberry32(seed);
  let cached = null;

  // Standard normal via Box-Muller, caching the second value of each pair.
  function normal() {
    if (cached !== null) {
      const v = cached;
      cached = null;
      return v;
    }
    let u1, u2;
    do {
      u1 = uniform();
      u2 = uniform();
    } while (u1 <= Number.EPSILON);
    const r = Math.sqrt(-2.0 * Math.log(u1));
    const theta = 2.0 * Math.PI * u2;
    cached = r * Math.sin(theta);
    return r * Math.cos(theta);
  }

  // Map a *supplied* standard-normal draw `z` to a log-normal return with the
  // given arithmetic mean and standard deviation (as decimals). Keeping the
  // normal draw external lets callers inject correlated/serially-smoothed draws.
  // Prefer `logNormalMuSigma` + `applyLogNormalMuSigma` in hot loops that reuse
  // the same mean/stdDev across many draws (e.g. once per year per simulation).
  function logNormalFromZ(mean, stdDev, z) {
    const { mu, sigma } = logNormalMuSigma(mean, stdDev);
    return applyLogNormalMuSigma(mu, sigma, z);
  }

  // Log-normal return drawing its own standard-normal internally.
  function logNormal(mean, stdDev) {
    return logNormalFromZ(mean, stdDev, normal());
  }

  return { uniform, normal, logNormal, logNormalFromZ };
}
