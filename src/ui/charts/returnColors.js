// Red/green color ramp for annual market returns (red = crash, green = boom).
// Shared by the 3D surface's column coloring and the per-year balance bars.

// Returns beyond ±50% clamp to the ends of the ramp.
export const RETURN_MIN = -0.5;
export const RETURN_MAX = 0.5;

export function lerpColor(a, b, t) {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

// Map a real return to the red/green ramp color at that value.
export function colorForReturn(v) {
  const clamped = Math.max(RETURN_MIN, Math.min(RETURN_MAX, v));
  const deepRed = [127, 29, 29];
  const lightRed = [248, 113, 113];
  const lightGreen = [134, 239, 172];
  const deepGreen = [21, 128, 61];

  if (clamped < 0) {
    const t = (clamped - RETURN_MIN) / (0 - RETURN_MIN);
    return lerpColor(deepRed, lightRed, t);
  }
  return lerpColor(lightGreen, deepGreen, clamped / RETURN_MAX);
}

export function returnColorWithAlpha(ret, alpha) {
  const [r, g, b] = colorForReturn(ret).match(/\d+/g).map(Number);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
