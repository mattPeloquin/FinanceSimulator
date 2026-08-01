// Shared returns / allocation UI controller.
//
// Features mount a compact panel (year range, distMethod, starting allocation)
// into a host element. Plan keeps its rich sparklines markup and uses the
// slice helpers + optional attach-to-existing-ids mode (`idPrefix: ''` with
// pre-rendered DOM) without renaming legacy ids.

import {
  ALLOCATION_PCT_KEYS,
  YEAR_RANGE,
  canonicalizeDistMethod,
  normalizeAllocationPct,
  isValidYearRange,
  buildSamplesAndProfiles,
} from '../../state/returnsAllocationSlice.js';

const ALLOC_LABELS = {
  usLgGrowthAllocation: 'US Lg Growth',
  usLgValueAllocation: 'US Lg Value',
  usSmMidAllocation: 'US Sm/Mid',
  exUsAllocation: 'Ex-US',
  bondAllocation: 'Bond',
  cashAllocation: 'Cash',
};

const DIST_OPTIONS = [
  { value: 'lognormal', label: 'Log-normal' },
  { value: 'resampling', label: 'Historical resampling' },
  { value: 'scaledHistorical', label: 'Scaled historical' },
  { value: 'historicalSequence', label: 'Historical sequence' },
];

/**
 * @typedef {object} ReturnsAllocationUiOptions
 * @property {string} [idPrefix] - e.g. 'accumulation-' or 'ss-timing-'; empty for Plan legacy ids
 * @property {boolean} [mountMarkup] - when true, write year/dist/alloc markup into root
 * @property {boolean} [showAllocation] - render allocation grid (default true when mounting)
 * @property {boolean} [showRefreshProfiles] - show "Refresh profiles" button
 * @property {string[]} [distMethods] - subset of DIST_OPTIONS values
 * @property {() => object} getSlice
 * @property {(partial: object) => void} setSlice
 * @property {(slice: object) => void} [onChange]
 */

function id(prefix, name) {
  // Plan legacy: startYear / endYear (camelCase, no prefix).
  if (!prefix) return name;
  // Prefixed features use kebab ids: accumulation-start-year
  const kebab = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
  return `${prefix}${kebab}`;
}

/**
 * Create a returns/allocation UI bound to a feature's slice getters.
 * @param {HTMLElement} root - host element (feature panel or #accumulation-returns-host)
 * @param {ReturnsAllocationUiOptions} options
 */
export function createReturnsAllocationUi(root, options) {
  if (!root) {
    return {
      refreshFromState() {},
      readFromDom() { return null; },
      refreshProfiles() { return null; },
      destroy() {},
      YEAR_RANGE,
    };
  }

  const prefix = options.idPrefix ?? '';
  const getSlice = options.getSlice;
  const setSlice = options.setSlice;
  const onChange = options.onChange;
  const mountMarkup = options.mountMarkup !== false;
  const showAllocation = options.showAllocation !== false;
  const showRefresh = options.showRefreshProfiles !== false;
  const distMethods = options.distMethods || DIST_OPTIONS.map((d) => d.value);

  let destroyed = false;

  if (mountMarkup) {
    root.innerHTML = buildMarkup(prefix, { showAllocation, showRefresh, distMethods });
  }

  const startEl = () => document.getElementById(id(prefix, prefix ? 'start-year' : 'startYear'));
  const endEl = () => document.getElementById(id(prefix, prefix ? 'end-year' : 'endYear'));
  const distEl = () => document.getElementById(id(prefix, prefix ? 'dist-method' : 'distMethod'));
  const msgEl = () => document.getElementById(id(prefix, prefix ? 'returns-msg' : 'historical-range-msg'));
  const allocHost = () => (
    document.getElementById(id(prefix, prefix ? 'allocation' : 'allocationHost'))
    || root.querySelector('[data-returns-allocation]')
  );

  function readFromDom() {
    const startYear = parseInt(startEl()?.value, 10);
    const endYear = parseInt(endEl()?.value, 10);
    let distMethod = distEl()?.value;
    // Plan uses radio group name="distribution-method"
    if (!distMethod && !prefix) {
      const checked = document.querySelector('input[name="distribution-method"]:checked');
      distMethod = checked?.value;
    }
    const allocation = {};
    for (const key of ALLOCATION_PCT_KEYS) {
      const el = document.getElementById(
        prefix ? `${prefix}alloc-${key}` : key,
      );
      const n = Number(el?.value);
      allocation[key] = Number.isFinite(n) ? n : 0;
    }
    return {
      startYear: Number.isFinite(startYear) ? startYear : getSlice().startYear,
      endYear: Number.isFinite(endYear) ? endYear : getSlice().endYear,
      distMethod: canonicalizeDistMethod(distMethod, getSlice().distMethod),
      allocation: normalizeAllocationPct(allocation),
    };
  }

  function refreshFromState() {
    if (destroyed) return;
    const slice = getSlice();
    const s = startEl();
    const e = endEl();
    const d = distEl();
    if (s) s.value = String(slice.startYear);
    if (e) e.value = String(slice.endYear);
    if (d) d.value = canonicalizeDistMethod(slice.distMethod);
    if (!prefix) {
      const radio = document.querySelector(
        `input[name="distribution-method"][value="${canonicalizeDistMethod(slice.distMethod)}"]`,
      );
      if (radio) radio.checked = true;
    }
    if (showAllocation && mountMarkup) {
      renderAllocationGrid(allocHost(), prefix, slice.allocation);
    } else if (showAllocation) {
      for (const key of ALLOCATION_PCT_KEYS) {
        const el = document.getElementById(prefix ? `${prefix}alloc-${key}` : key);
        if (el) el.value = String(slice.allocation[key] ?? 0);
      }
    }
  }

  function refreshProfiles({ force = true } = {}) {
    const partial = readFromDom();
    const merged = { ...getSlice(), ...partial };
    const { profiles } = buildSamplesAndProfiles(merged, { forceProfiles: force });
    if (profiles) {
      setSlice({ ...partial, profiles, profilesEdited: false });
      const msg = msgEl();
      if (msg) {
        msg.textContent = `Profiles updated from ${merged.startYear}–${merged.endYear}.`;
      }
      onChange?.(getSlice());
      return profiles;
    }
    const msg = msgEl();
    if (msg) {
      msg.textContent = isValidYearRange(merged.startYear, merged.endYear)
        ? 'No historical years in range.'
        : `Enter a year range between ${YEAR_RANGE.minYear} and ${YEAR_RANGE.maxYear}.`;
    }
    return null;
  }

  function handleDomChange() {
    if (destroyed) return;
    const partial = readFromDom();
    setSlice({
      ...partial,
      allocationOverTimeTiers: [partial.allocation],
    });
    onChange?.(getSlice());
  }

  const onInput = (ev) => {
    if (!(ev.target instanceof HTMLElement)) return;
    if (!root.contains(ev.target) && prefix) return;
    handleDomChange();
  };

  root.addEventListener('change', onInput);
  root.addEventListener('input', onInput);

  const refreshBtn = document.getElementById(
    id(prefix, prefix ? 'refresh-profiles' : 'refreshProfiles'),
  );
  const onRefreshClick = () => refreshProfiles({ force: true });
  refreshBtn?.addEventListener('click', onRefreshClick);

  refreshFromState();

  return {
    refreshFromState,
    readFromDom,
    refreshProfiles,
    YEAR_RANGE,
    destroy() {
      destroyed = true;
      root.removeEventListener('change', onInput);
      root.removeEventListener('input', onInput);
      refreshBtn?.removeEventListener('click', onRefreshClick);
    },
  };
}

function renderAllocationGrid(host, prefix, allocation) {
  if (!host) return;
  host.innerHTML = ALLOCATION_PCT_KEYS.map((key) => `
    <label class="block space-y-0.5">
      <span class="text-xs text-theme-muted">${ALLOC_LABELS[key] || key}</span>
      <input type="number" id="${prefix}alloc-${key}" min="0" max="100" step="1"
        value="${allocation[key] ?? 0}"
        class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm" />
    </label>`).join('');
}

function buildMarkup(prefix, { showAllocation, showRefresh, distMethods }) {
  const startId = id(prefix, prefix ? 'start-year' : 'startYear');
  const endId = id(prefix, prefix ? 'end-year' : 'endYear');
  const distId = id(prefix, prefix ? 'dist-method' : 'distMethod');
  const msgId = id(prefix, prefix ? 'returns-msg' : 'historical-range-msg');
  const allocId = id(prefix, prefix ? 'allocation' : 'allocationHost');
  const refreshId = id(prefix, prefix ? 'refresh-profiles' : 'refreshProfiles');

  const options = DIST_OPTIONS
    .filter((d) => distMethods.includes(d.value))
    .map((d) => `<option value="${d.value}">${d.label}</option>`)
    .join('');

  return `
    <div class="space-y-3" data-returns-allocation-root>
      <p class="text-xs text-theme-muted">
        Historical year range for return sampling (${YEAR_RANGE.minYear}–${YEAR_RANGE.maxYear}).
      </p>
      <div class="grid grid-cols-2 gap-3">
        <label class="block space-y-1">
          <span class="text-sm font-medium text-theme-body">Start year</span>
          <input type="number" id="${startId}"
            class="w-full rounded-lg border border-theme-border bg-theme-input px-3 py-2 text-sm text-theme-heading" />
        </label>
        <label class="block space-y-1">
          <span class="text-sm font-medium text-theme-body">End year</span>
          <input type="number" id="${endId}"
            class="w-full rounded-lg border border-theme-border bg-theme-input px-3 py-2 text-sm text-theme-heading" />
        </label>
      </div>
      <label class="block space-y-1">
        <span class="text-sm font-medium text-theme-body">Distribution</span>
        <select id="${distId}" class="w-full rounded-lg border border-theme-border bg-theme-input px-3 py-2 text-sm text-theme-heading">
          ${options}
        </select>
      </label>
      ${showRefresh ? `<button type="button" id="${refreshId}" class="text-xs text-theme-accent hover:underline">Refresh profiles from year range</button>` : ''}
      <p id="${msgId}" class="text-xs text-theme-faint"></p>
      ${showAllocation ? `
        <div class="space-y-2">
          <h4 class="text-sm font-semibold text-theme-heading">Starting allocation (%)</h4>
          <div id="${allocId}" class="grid grid-cols-2 gap-2" data-returns-allocation></div>
        </div>` : ''}
    </div>`;
}

export { YEAR_RANGE, ALLOCATION_PCT_KEYS, ALLOC_LABELS };
