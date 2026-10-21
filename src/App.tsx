import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DICTS, LOCALES, format, formatDateTime, isLocale, type Locale } from './i18n';
import { deriveClock, evaluateState, type ServiceState } from './domain/freshness';
import type { Dataset } from './domain/schema';
import { RADIUS_STEPS_KM, searchByLocality, searchByPoint, searchNearPoints, type SearchOutcome } from './domain/match';
import type { LatLon } from './domain/geo';
import { exactLocality, exactStreet, locateHouse, normaliseHouse, suggestLocalities, suggestStreets, type LocalityOption, type OfficialStreet } from './domain/streets';
import LOCALITY_EN from './data/locality-names-en.json';
import { LOCALITY_ALIASES } from './data/locality-aliases';
import { loadLocalityStreets, type LocalityStreets } from './services/streets';
import { loadDataset, loadManifest, loadRules, SnapshotError, type LoadedManifest, type PublicRules } from './services/snapshot';
import { PlaceCard } from './components/PlaceCard';
import { SourcesPage, PrivacyPage, AccessibilityPage } from './components/InfoPages';
import { OFFICIAL_INFO_URL, OFFICIAL_LIST_URL } from './config';

export type View = 'search' | 'sources' | 'privacy' | 'accessibility';
const VIEWS: View[] = ['search', 'sources', 'privacy', 'accessibility'];

/** 'memory' routing is used when the site is embedded in a host that does not support path routes (e.g. a hosted artifact). */
const MEMORY_ROUTER = import.meta.env.VITE_ROUTER === 'memory';

export function parsePath(pathname: string): { locale: Locale; view: View } {
  if (MEMORY_ROUTER) {
    const [l, v] = window.location.hash.replace(/^#/, '').split('-');
    return { locale: isLocale(l) ? l : 'he', view: VIEWS.includes(v as View) ? (v as View) : 'search' };
  }
  const base = import.meta.env.BASE_URL;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
  const [l, v] = rest.split('/').filter(Boolean);
  return { locale: isLocale(l) ? l : 'he', view: VIEWS.includes(v as View) ? (v as View) : 'search' };
}
export function pathFor(locale: Locale, view: View): string {
  if (MEMORY_ROUTER) return `#${locale}${view === 'search' ? '' : `-${view}`}`;
  return `${import.meta.env.BASE_URL}${locale}/${view === 'search' ? '' : `${view}/`}`;
}

type LoadState<T> = { status: 'idle' | 'loading' } | { status: 'ok'; value: T } | { status: 'error'; offline: boolean; detail?: string };

type Query =
  | { mode: 'locality'; localityCode: string; unlocatedStreet?: string }
  | { mode: 'locality-nearby'; localityCode: string }
  | {
      mode: 'street';
      localityCode: string;
      label: string;
      points: LatLon[];
      /** True when the house was located (exactly or from neighbouring numbers): distances are from the address. */
      precise: boolean;
      houseNotFound: string | null;
      houseApprox: string | null;
    };

interface FieldErrors {
  locality?: 'errorLocalityRequired' | 'errorLocalityChoose';
  street?: 'errorStreetChoose';
}

export function App({ initialLocale, initialView }: { initialLocale: Locale; initialView: View }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [view, setView] = useState<View>(initialView);
  const t = DICTS[locale];

  // ---- snapshot ----
  const [manifestState, setManifestState] = useState<LoadState<LoadedManifest>>({ status: 'loading' });
  const [datasetState, setDatasetState] = useState<LoadState<Dataset>>({ status: 'idle' });
  const [rules, setRules] = useState<PublicRules | null>(null);
  const [tick, setTick] = useState(0);

  const refreshManifest = useCallback(async () => {
    try {
      const m = await loadManifest();
      setManifestState({ status: 'ok', value: m });
    } catch (e) {
      setManifestState((prev) =>
        prev.status === 'ok' ? prev : { status: 'error', offline: e instanceof SnapshotError && e.offline, detail: e instanceof Error ? e.message : String(e) },
      );
    }
  }, []);

  useEffect(() => {
    void refreshManifest();
    loadRules().then(setRules, () => setRules(null));
  }, [refreshManifest]);

  // Re-evaluate validity periodically and whenever the page becomes visible again (spec §15).
  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 60_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        setTick((x) => x + 1);
        void refreshManifest();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onVis);
    };
  }, [refreshManifest]);

  const computeState = useCallback((): ServiceState => {
    if (manifestState.status !== 'ok') return { kind: 'uninitialized' };
    const clock = deriveClock(Date.now(), manifestState.value.serverDate);
    return evaluateState(manifestState.value.manifest, clock, locale);
  }, [manifestState, locale]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const service = useMemo(computeState, [computeState, tick]);
  const manifest = manifestState.status === 'ok' ? manifestState.value.manifest : null;

  useEffect(() => {
    if (service.kind !== 'active' || !manifest) return;
    if (datasetState.status === 'ok' && datasetState.value.releaseId === manifest.releaseId) return;
    if (datasetState.status === 'loading' || datasetState.status === 'error') return; // errors retry only on user request
    setDatasetState({ status: 'loading' });
    loadDataset(manifest).then(
      (d) => setDatasetState({ status: 'ok', value: d }),
      (e) => setDatasetState({ status: 'error', offline: e instanceof SnapshotError && e.offline, detail: e instanceof Error ? e.message : String(e) }),
    );
  }, [service.kind, manifest, datasetState]);

  // ---- document language, direction, title ----
  useEffect(() => {
    document.documentElement.lang = t.htmlLang;
    document.documentElement.dir = t.dir;
    document.title = view === 'search' ? t.docTitle : `${pageTitle(view, t)} · ${t.h1}`;
  }, [t, view]);

  // ---- routing ----
  useEffect(() => {
    const onPop = () => {
      const p = parsePath(window.location.pathname);
      setLocale(p.locale);
      setView(p.view);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const mainHeadingRef = useRef<HTMLHeadingElement>(null);
  const goView = (v: View) => {
    if (!MEMORY_ROUTER) window.history.pushState(null, '', pathFor(locale, v));
    setView(v);
    requestAnimationFrame(() => mainHeadingRef.current?.focus());
  };
  const switchLocale = (l: Locale) => {
    // The address and results stay in memory; nothing about the search goes into the URL (spec §9).
    if (!MEMORY_ROUTER) window.history.replaceState(null, '', pathFor(l, view));
    setLocale(l);
  };

  // ---- search ----
  const [localityText, setLocalityText] = useState('');
  const [localityChosen, setLocalityChosen] = useState<string | null>(null);
  const [street, setStreet] = useState('');
  const [streetCode, setStreetCode] = useState<number | null>(null);
  const [house, setHouse] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<'form' | 'searching' | 'results'>('form');
  const [query, setQuery] = useState<Query | null>(null);
  const [radiusIdx, setRadiusIdx] = useState(0);
  const [filter, setFilter] = useState('');
  const [announce, setAnnounce] = useState('');
  const [streets, setStreets] = useState<{ code: string; data: LocalityStreets } | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const localityRef = useRef<HTMLInputElement>(null);
  const streetRef = useRef<HTMLInputElement>(null);
  const houseRef = useRef<HTMLInputElement>(null);

  const dataset = datasetState.status === 'ok' ? datasetState.value : null;
  const localities: LocalityOption[] = useMemo(
    () =>
      dataset
        ? dataset.localities.map((l) => ({
            code: l.code,
            name: l.name,
            aliases: [(LOCALITY_EN as Record<string, string>)[l.code], ...(LOCALITY_ALIASES[l.code] ?? [])].filter((x): x is string => !!x),
          }))
        : [],
    [dataset],
  );
  const localityName = (code: string) => localities.find((l) => l.code === code)?.name ?? '';
  // The locality is known once the user picked a suggestion or typed a name that matches exactly one locality.
  const localityCode = localityChosen ?? exactLocality(localities, localityText)?.code ?? '';
  const localitySuggestions = useMemo(
    () => (!localityCode && localityText.trim() ? suggestLocalities(localities, localityText, 8) : []),
    [localities, localityText, localityCode],
  );
  const chooseLocality = (l: LocalityOption) => {
    setLocalityText(l.name);
    setLocalityChosen(l.code);
    setStreetCode(null);
    setErrors((e) => ({ ...e, locality: undefined }));
    requestAnimationFrame(() => streetRef.current?.focus());
  };

  // Street list of the chosen locality, loaded on demand (local data; nothing is sent anywhere).
  useEffect(() => {
    if (!localityCode) return;
    let cancelled = false;
    loadLocalityStreets(localityCode).then(
      (data) => !cancelled && setStreets({ code: localityCode, data }),
      () => !cancelled && setStreets({ code: localityCode, data: { list: [], geo: new Map() } }),
    );
    return () => {
      cancelled = true;
    };
  }, [localityCode]);
  const streetList: OfficialStreet[] = streets && streets.code === localityCode ? streets.data.list : [];
  const suggestions = useMemo(
    () => (streetCode === null && street.trim() ? suggestStreets(streetList, street, 8) : []),
    [streetList, street, streetCode],
  );

  const outcome: SearchOutcome | null = useMemo(() => {
    if (!dataset || !query) return null;
    if (query.mode === 'locality') return searchByLocality(dataset.sites, query.localityCode);
    if (query.mode === 'locality-nearby') {
      const loc = dataset.localities.find((l) => l.code === query.localityCode);
      if (!loc?.centre) return { results: [], excludedInstitutional: 0, excludedConflict: 0, withoutCoordinatesInLocality: 0 };
      return searchByPoint(dataset.sites, { point: loc.centre, precise: false, radiusKm: RADIUS_STEPS_KM[radiusIdx]!, localityCode: null });
    }
    return searchNearPoints(dataset.sites, {
      points: query.points,
      precise: query.precise,
      radiusKm: RADIUS_STEPS_KM[radiusIdx]!,
      localityCode: query.localityCode,
    });
  }, [dataset, query, radiusIdx]);

  const showResults = (q: Query) => {
    // Validity is re-checked right before results are shown (spec §15).
    setTick((x) => x + 1);
    let next = q;
    if (q.mode === 'locality' && !q.unlocatedStreet && dataset && searchByLocality(dataset.sites, q.localityCode).results.length === 0) {
      next = { mode: 'locality-nearby', localityCode: q.localityCode };
    }
    setRadiusIdx(0);
    setFilter('');
    setQuery(next);
    setPhase('results');
    focusResults.current = true;
  };
  // Move focus to the results heading once it is actually rendered (not on a timer that can race the render).
  const focusResults = useRef(false);
  useEffect(() => {
    if (focusResults.current && phase === 'results' && resultsHeadingRef.current) {
      focusResults.current = false;
      resultsHeadingRef.current.focus();
    }
  });

  // Local, in-page filter for long locality lists (big cities). Nothing typed here leaves the device.
  const visibleResults = useMemo(() => {
    if (!outcome) return [];
    const q = filter.replace(/\s+/g, ' ').trim();
    if (!q) return outcome.results;
    return outcome.results.filter((p) =>
      p.sites.some((x) => `${x.address.raw} ${x.officialName}`.replace(/\s+/g, ' ').includes(q)),
    );
  }, [outcome, filter]);

  // Widen the radius automatically until there are results (up to the largest step), so the user never has to.
  useEffect(() => {
    if (phase === 'results' && outcome && query && query.mode !== 'locality' && outcome.results.length === 0 && radiusIdx < RADIUS_STEPS_KM.length - 1) {
      setRadiusIdx((r) => r + 1);
    }
  }, [phase, outcome, query, radiusIdx]);

  useEffect(() => {
    if (phase === 'results' && outcome) {
      setAnnounce(outcome.results.length === 1 ? t.resultsCountOne : format(t.resultsCount, { n: outcome.results.length }));
    }
  }, [phase, outcome, t]);

  /** Arrow keys move between suggestion buttons; Escape returns to the field. */
  const suggestionKeys = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const list = [...(e.currentTarget.closest('ul')?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = list.indexOf(e.currentTarget);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = list[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) next.focus();
      else if (e.key === 'ArrowUp') (e.currentTarget.closest('.field')?.querySelector('input') as HTMLInputElement | null)?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      (e.currentTarget.closest('.field')?.querySelector('input') as HTMLInputElement | null)?.focus();
    }
  };
  const chooseStreet = (s: OfficialStreet) => {
    setStreet(s.nameHe);
    setStreetCode(s.code);
    setErrors((e) => ({ ...e, street: undefined }));
    requestAnimationFrame(() => houseRef.current?.focus());
  };

  // The search runs from the button's click (and Enter in a field), never from native form submission:
  // some hosts sandbox the page without allowing form submission, which would silently swallow the submit event.
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch();
  };
  const onFieldKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runSearch();
    }
  };
  const runSearch = async () => {
    if (phase === 'searching') return;
    const errs: FieldErrors = {};
    let locCode = localityCode;
    if (!locCode && localityText.trim()) {
      const sug = suggestLocalities(localities, localityText, 2);
      if (sug.length === 1) {
        locCode = sug[0]!.code;
        setLocalityText(sug[0]!.name);
        setLocalityChosen(locCode);
      }
    }
    if (!locCode) errs.locality = localityText.trim() ? 'errorLocalityChoose' : 'errorLocalityRequired';
    const localityCodeResolved = locCode;
    const typed = street.trim();
    let data: LocalityStreets | null = null;
    let chosen: OfficialStreet | null = null;
    if (localityCodeResolved && typed) {
      setPhase('searching');
      data = await loadLocalityStreets(localityCodeResolved).catch(() => ({ list: [], geo: new Map() }) as LocalityStreets);
      setPhase('form');
      chosen =
        (streetCode !== null ? data.list.find((x) => x.code === streetCode) ?? null : null) ??
        exactStreet(data.list, typed) ??
        (() => {
          const sug = suggestStreets(data!.list, typed, 2);
          return sug.length === 1 ? sug[0]! : null;
        })();
      if (!chosen) errs.street = 'errorStreetChoose';
    }
    setErrors(errs);
    if (errs.locality || errs.street) {
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
    if (!typed || !chosen || !data) {
      showResults({ mode: 'locality', localityCode: localityCodeResolved });
      return;
    }
    setStreet(chosen.nameHe);
    setStreetCode(chosen.code);
    const geo = data.geo.get(chosen.code);
    if (!geo) {
      showResults({ mode: 'locality', localityCode: localityCodeResolved, unlocatedStreet: chosen.nameHe });
      return;
    }
    const h = house.trim() ? normaliseHouse(house) : null;
    const located = h ? locateHouse(geo.numbers, h) : null;
    const label = `${chosen.nameHe}${h ? ` ${h}` : ''}, ${localityName(localityCodeResolved)}`;
    showResults({
      mode: 'street',
      localityCode: localityCodeResolved,
      label,
      points: located ? [located.point] : geo.points,
      precise: !!located,
      houseNotFound: h && !located ? h : null,
      houseApprox: h && located && located.kind !== 'exact' ? h : null,
    });
  };

  const clearSearch = () => {
    setLocalityText('');
    setLocalityChosen(null);
    setStreet('');
    setStreetCode(null);
    setHouse('');
    setErrors({});
    setQuery(null);
    setPhase('form');
    setAnnounce('');
    requestAnimationFrame(() => localityRef.current?.focus());
  };
  const changeAddress = () => {
    setPhase('form');
    setQuery(null);
    requestAnimationFrame(() => streetRef.current?.focus());
  };
  const beforeNavigate = () => {
    const s = computeState();
    setTick((x) => x + 1);
    return s.kind === 'active';
  };

  const active = service.kind === 'active';
  const verifiedAt = service.kind === 'active' ? service.lastVerifiedAt : null;
  const errorList = (
    [
      errors.locality && { field: 'locality', text: t[errors.locality] },
      errors.street && { field: 'street', text: t[errors.street] },
    ].filter(Boolean) as Array<{ field: string; text: string }>
  );

  return (
    <>
      <a className="skip-link" href="#main">
        {t.skipToContent}
      </a>
      <header className="site-header">
        <nav aria-label={t.languageNavLabel}>
          <ul className="lang-list">
            {LOCALES.map((l) => (
              <li key={l}>
                <a
                  href={pathFor(l, view)}
                  lang={DICTS[l].htmlLang}
                  hrefLang={DICTS[l].htmlLang}
                  dir={DICTS[l].dir}
                  aria-current={l === locale ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    switchLocale(l);
                  }}
                >
                  {DICTS[l].langName}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main id="main" tabIndex={-1}>
        <div className="sr-live" aria-live="polite" role="status">
          {announce}
        </div>

        {view === 'search' && (
          <>
            <h1 ref={mainHeadingRef} tabIndex={-1}>
              {t.h1}
            </h1>
            <p className="lead">{t.intro}</p>

            <details className="rules">
              <summary>{t.whoCanVote}</summary>
              <RulesBlock rules={rules} locale={locale} />
            </details>
            <details className="diff">
              <summary>{t.diffTitle}</summary>
              <dl className="diff-body">
                <dt>{t.diffAccessibleTitle}</dt>
                <dd>{t.diffAccessible}</dd>
                <dt>
                  <span aria-hidden="true">★ </span>
                  {t.diffSpecialTitle}
                </dt>
                <dd>{t.diffSpecial}</dd>
                <dd className="diff-note">{t.diffNote}</dd>
              </dl>
            </details>

            <StatusBlock service={service} manifestState={manifestState} datasetState={datasetState} locale={locale} onRetry={() => void refreshManifest()} />

            {active && datasetState.status === 'loading' && <p role="status">{t.loadingData}</p>}

            {active && dataset && phase !== 'results' && (
              <form className="search" role="search" onSubmit={onSubmit} noValidate>
                {errorList.length > 0 && (
                  <div className="error-summary" ref={errorSummaryRef} tabIndex={-1} role="alert">
                    <p>
                      <strong>{t.errorSummaryTitle}</strong>
                    </p>
                    <ul>
                      {errorList.map((er) => (
                        <li key={er.text}>
                          <a href={`#f-${er.field}`}>{er.text}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <fieldset>
                  <legend>
                    <h2>{t.formLegend}</h2>
                  </legend>
                  <div className="field">
                    <label htmlFor="f-locality">{t.localityLabel}</label>
                    <p className="hint" id="f-locality-hint">
                      {t.localityHint}
                    </p>
                    {errors.locality && (
                      <p className="field-error" id="f-locality-error">
                        {t[errors.locality]}
                      </p>
                    )}
                    <input
                      id="f-locality"
                      ref={localityRef}
                      type="text"
                      value={localityText}
                      onChange={(e) => {
                        setLocalityText(e.target.value);
                        setLocalityChosen(null);
                        setStreetCode(null);
                        setErrors((x) => ({ ...x, locality: undefined }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' && localitySuggestions.length) {
                          e.preventDefault();
                          document.querySelector<HTMLButtonElement>('#locality-suggestions button')?.focus();
                        } else onFieldKey(e);
                      }}
                      aria-invalid={errors.locality ? true : undefined}
                      aria-describedby={['f-locality-hint', errors.locality && 'f-locality-error'].filter(Boolean).join(' ')}
                      aria-controls={localitySuggestions.length > 0 ? 'locality-suggestions' : undefined}
                      autoComplete="off"
                      spellCheck={false}
                      enterKeyHint="next"
                    />
                    <p className="visually-hidden" aria-live="polite">
                      {!localityCode && localityText.trim()
                        ? localitySuggestions.length
                          ? format(t.localitySuggestionsCount, { n: localitySuggestions.length })
                          : t.localityNoMatch
                        : ''}
                    </p>
                    {localitySuggestions.length > 0 && (
                      <div className="suggestions">
                        <p id="locality-suggestions-label" className="hint">
                          {t.localitySuggestionsLabel}
                        </p>
                        <ul id="locality-suggestions" aria-labelledby="locality-suggestions-label">
                          {localitySuggestions.map((l) => (
                            <li key={l.code}>
                              <button type="button" className="suggestion" lang="he" dir="rtl" onClick={() => chooseLocality(l)} onKeyDown={suggestionKeys}>
                                {l.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {!localityCode && localityText.trim() && localitySuggestions.length === 0 && <p className="hint">{t.localityNoMatch}</p>}
                  </div>
                  <div className="field">
                    <label htmlFor="f-street">{t.streetLabel}</label>
                    <p className="hint" id="f-street-hint">
                      {t.streetHint}
                    </p>
                    {errors.street && (
                      <p className="field-error" id="f-street-error">
                        {t[errors.street]}
                      </p>
                    )}
                    <input
                      id="f-street"
                      ref={streetRef}
                      type="text"
                      value={street}
                      onChange={(e) => {
                        setStreet(e.target.value);
                        setStreetCode(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' && suggestions.length) {
                          e.preventDefault();
                          document.querySelector<HTMLButtonElement>('#street-suggestions button')?.focus();
                        } else onFieldKey(e);
                      }}
                      autoComplete="off"
                      spellCheck={false}
                      enterKeyHint="next"
                      aria-invalid={errors.street ? true : undefined}
                      aria-describedby={['f-street-hint', errors.street && 'f-street-error'].filter(Boolean).join(' ')}
                      aria-controls={suggestions.length > 0 ? 'street-suggestions' : undefined}
                      lang="he"
                      dir="rtl"
                    />
                    <p className="visually-hidden" aria-live="polite">
                      {streetCode === null && street.trim() && localityCode
                        ? suggestions.length
                          ? format(t.streetSuggestionsCount, { n: suggestions.length })
                          : t.streetNoMatch
                        : ''}
                    </p>
                    {suggestions.length > 0 && (
                      <div className="suggestions">
                        <p id="street-suggestions-label" className="hint">
                          {t.streetSuggestionsLabel}
                        </p>
                        <ul id="street-suggestions" aria-labelledby="street-suggestions-label">
                          {suggestions.map((s) => (
                            <li key={s.code}>
                              <button type="button" className="suggestion" lang="he" dir="rtl" onClick={() => chooseStreet(s)} onKeyDown={suggestionKeys}>
                                {s.nameHe}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {streetCode === null && street.trim() && localityCode && streets?.code === localityCode && suggestions.length === 0 && (
                      <p className="hint">{t.streetNoMatch}</p>
                    )}
                    {street.trim() && !localityCode && <p className="hint">{t.streetNeedsLocality}</p>}
                  </div>
                  <div className="field narrow">
                    <label htmlFor="f-house">{t.houseLabel}</label>
                    <input
                      id="f-house"
                      ref={houseRef}
                      type="text"
                      inputMode="numeric"
                      value={house}
                      onChange={(e) => setHouse(e.target.value)}
                      onKeyDown={onFieldKey}
                      autoComplete="off"
                      dir="ltr"
                      enterKeyHint="search"
                    />
                  </div>
                </fieldset>
                <button type="button" id="search-submit" className="button primary" onClick={() => void runSearch()} aria-disabled={phase === 'searching' || undefined}>
                  {phase === 'searching' ? t.loading : t.submit}
                </button>
                <p className="privacy-note">{t.noIdNeeded}</p>
                <p className="privacy-note">{t.localOnlyNotice}</p>
              </form>
            )}

            {active && phase === 'results' && outcome && query && verifiedAt && (
              <section className="results" aria-labelledby="results-h">
                <h2 id="results-h" ref={resultsHeadingRef} tabIndex={-1}>
                  {t.resultsTitle}
                </h2>
                <p className="searched">
                  {query.mode === 'street' ? (
                    <>
                      {format(t.resultsNear, { address: '' })}
                      <bdi lang="he">{query.label}</bdi>
                    </>
                  ) : (
                    <>
                      {format(t.resultsLocality, { locality: '' })}
                      <bdi lang="he">{localityName(query.localityCode)}</bdi>
                    </>
                  )}
                </p>
                <div className="result-actions">
                  <button type="button" className="button secondary" onClick={changeAddress}>
                    {t.changeAddress}
                  </button>
                  <button type="button" className="button link" onClick={clearSearch}>
                    {t.clearSearch}
                  </button>
                </div>
                <p className="reminder">{t.conditionalReminder}</p>
                {query.mode === 'locality-nearby' && (
                  <p>{format(t.localityNoResults, { locality: localityName(query.localityCode) })}</p>
                )}
                {query.mode === 'locality' && query.unlocatedStreet && (
                  <p className="notice info">{format(t.streetUnlocatedNote, { street: query.unlocatedStreet })}</p>
                )}
                {query.mode === 'street' && query.houseApprox && <p className="note">{format(t.houseApproxNote, { house: query.houseApprox })}</p>}
                {query.mode === 'street' && !query.precise && (
                  <p className="note">{query.houseNotFound ? format(t.houseNotFoundNote, { house: query.houseNotFound }) : t.streetApproxNote}</p>
                )}
                {outcome.results.length === 0 && (
                  <p className="empty">
                    {query.mode === 'locality'
                      ? t.noResultsAtAll
                      : format(t.noResultsInRadius, { km: RADIUS_STEPS_KM[radiusIdx]! })}
                  </p>
                )}
                {query.mode === 'locality' && outcome.results.length > 5 && (
                  <div className="field filter">
                    <label htmlFor="f-filter">{t.filterLabel}</label>
                    <p className="hint" id="f-filter-hint">
                      {t.filterHint}
                    </p>
                    <input
                      id="f-filter"
                      type="search"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                      aria-describedby="f-filter-hint f-filter-count"
                      autoComplete="off"
                      lang="he"
                      dir="rtl"
                    />
                    <p className="hint" id="f-filter-count" aria-live="polite">
                      {visibleResults.length === 0
                        ? t.filterNoMatch
                        : format(t.filterCount, { shown: visibleResults.length, total: outcome.results.length })}
                    </p>
                  </div>
                )}
                <ol className="cards">
                  {visibleResults.map((p, i) => (
                    <li key={p.placeKey}>
                      <PlaceCard
                        place={p}
                        heading={
                          query.mode === 'locality'
                            ? null
                            : i === 0
                              ? query.mode === 'street'
                                ? query.precise
                                  ? t.labelNearest
                                  : t.labelNearestToStreet
                                : t.labelInArea
                              : format(t.labelAlternative, { n: i })
                        }
                        t={t}
                        locale={locale}
                        verifiedAt={verifiedAt}
                        beforeNavigate={beforeNavigate}
                        distanceKind={query.mode === 'street' ? (query.precise ? 'address' : 'street') : 'approx'}
                      />
                    </li>
                  ))}
                </ol>
                {query.mode !== 'locality' && outcome.results.length < 3 && radiusIdx < RADIUS_STEPS_KM.length - 1 && (
                  <button type="button" className="button secondary" onClick={() => setRadiusIdx((r) => r + 1)}>
                    {format(t.expandRadius, { km: RADIUS_STEPS_KM[radiusIdx + 1]! })}
                  </button>
                )}
                {outcome.withoutCoordinatesInLocality > 0 && <p className="note">{format(t.withoutCoordinates, { n: outcome.withoutCoordinatesInLocality })}</p>}
                {outcome.excludedInstitutional > 0 && <p className="note">{format(t.excludedInstitutional, { n: outcome.excludedInstitutional })}</p>}
                {outcome.excludedConflict > 0 && <p className="note">{format(t.excludedConflict, { n: outcome.excludedConflict })}</p>}
                {(outcome.results.length === 0 || outcome.excludedInstitutional > 0) && <OfficialRoute locale={locale} />}
              </section>
            )}

            {!active && <OfficialRoute locale={locale} />}
          </>
        )}

        {view === 'sources' && <SourcesPage t={t} locale={locale} manifest={manifest} service={service} loading={manifestState.status === 'loading'} headingRef={mainHeadingRef} />}
        {view === 'privacy' && <PrivacyPage t={t} headingRef={mainHeadingRef} />}
        {view === 'accessibility' && <AccessibilityPage t={t} locale={locale} headingRef={mainHeadingRef} />}
      </main>

      <footer className="site-footer">
        <nav aria-label={t.footerNavLabel}>
          <ul>
            {view !== 'search' && (
              <li>
                <a href={pathFor(locale, 'search')} onClick={(e) => (e.preventDefault(), goView('search'))}>
                  {t.backToSearch}
                </a>
              </li>
            )}
            {(['sources', 'privacy', 'accessibility'] as const).map((v) => (
              <li key={v}>
                <a href={pathFor(locale, v)} aria-current={view === v ? 'page' : undefined} onClick={(e) => (e.preventDefault(), goView(v))}>
                  {pageTitle(v, t)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </>
  );
}

function pageTitle(v: View, t: (typeof DICTS)[Locale]): string {
  return v === 'sources' ? t.footerSources : v === 'privacy' ? t.footerPrivacy : v === 'accessibility' ? t.footerAccessibility : t.h1;
}

function RulesBlock({ rules, locale }: { rules: PublicRules | null; locale: Locale }) {
  const t = DICTS[locale];
  const text = rules?.version ? rules.texts[locale] : undefined;
  const official = rules?.sources.find((s) => s.role === 'official');
  if (!text) {
    return (
      <div className="rules-body">
        <p>{t.rulesUnavailable}</p>
        <p>
          <a href={OFFICIAL_INFO_URL} rel="noopener noreferrer" referrerPolicy="no-referrer">
            {t.officialInfoLink}
          </a>
        </p>
      </div>
    );
  }
  return (
    <div className="rules-body">
      <ul>
        {text.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {official && (
        <p>
          {t.rulesSourceLabel}{' '}
          <a href={official.url} rel="noopener noreferrer" referrerPolicy="no-referrer">
            {t.officialInfoLink}
          </a>
        </p>
      )}
    </div>
  );
}

function StatusBlock({
  service,
  manifestState,
  datasetState,
  locale,
  onRetry,
}: {
  service: ServiceState;
  manifestState: LoadState<LoadedManifest>;
  datasetState: LoadState<Dataset>;
  locale: Locale;
  onRetry: () => void;
}) {
  const t = DICTS[locale];
  if (manifestState.status === 'loading') return <p role="status">{t.loadingData}</p>;
  if (manifestState.status === 'error' || datasetState.status === 'error') {
    const offline = (manifestState.status === 'error' && manifestState.offline) || (datasetState.status === 'error' && datasetState.offline);
    const detail = (manifestState.status === 'error' && manifestState.detail) || (datasetState.status === 'error' && datasetState.detail) || '';
    return (
      <div className="notice warning" role="alert">
        <p>{offline ? t.statusOffline : t.statusLoadError}</p>
        {detail && (
          <p className="tech-detail">
            <code dir="ltr">{detail}</code>
          </p>
        )}
        <button type="button" className="button secondary" onClick={() => (datasetState.status === 'error' ? window.location.reload() : onRetry())}>
          {t.retry}
        </button>
      </div>
    );
  }
  const date = (iso: string | null) => formatDateTime(iso, locale) ?? t.never;
  switch (service.kind) {
    case 'active':
      // Owner decision: a failed daily refresh attempt is not shown on the page (the data stays valid; see Sources page).
      return null;
    case 'uninitialized':
      return <Notice text={t.statusUninitialized} />;
    case 'blocked':
      return <Notice text={t.statusBlocked} />;
    case 'expired':
      return <Notice text={format(t.statusExpired, { date: date(service.lastVerifiedAt) })} />;
    case 'ended':
      return <Notice text={t.statusEnded} />;
    case 'suspended':
      return <Notice text={t.statusSuspended} />;
    case 'clock-unreliable':
      return <Notice text={t.statusClock} />;
    case 'rules-unavailable-for-locale':
      return <Notice text={t.statusLocaleRules} />;
  }
}

function Notice({ text }: { text: string }) {
  return (
    <div className="notice warning">
      <p>{text}</p>
    </div>
  );
}

function OfficialRoute({ locale }: { locale: Locale }) {
  const t = DICTS[locale];
  return (
    <section className="official" aria-labelledby="official-h">
      <h2 id="official-h">{t.officialRouteTitle}</h2>
      <p>{t.officialRouteText}</p>
      <ul>
        <li>
          <a href={OFFICIAL_LIST_URL} rel="noopener noreferrer" referrerPolicy="no-referrer">
            {t.officialListLink}
          </a>
        </li>
        <li>
          <a href={OFFICIAL_INFO_URL} rel="noopener noreferrer" referrerPolicy="no-referrer">
            {t.officialInfoLink}
          </a>
        </li>
      </ul>
    </section>
  );
}
