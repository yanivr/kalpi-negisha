import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DICTS, LOCALES, format, formatDateTime, isLocale, type Locale } from './i18n';
import { deriveClock, evaluateState, type ServiceState } from './domain/freshness';
import type { Dataset } from './domain/schema';
import { RADIUS_STEPS_KM, searchByLocality, searchByPoint, type SearchOutcome } from './domain/match';
import { loadDataset, loadManifest, loadRules, SnapshotError, type LoadedManifest, type PublicRules } from './services/snapshot';
import { geocodeAddress, geocodingEnabled, needsConfirmation, type GeocodeCandidate } from './services/geocode';
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
  | { mode: 'locality'; localityCode: string }
  | { mode: 'point'; label: string; candidate: GeocodeCandidate; localityCode: string }
  | { mode: 'locality-nearby'; localityCode: string };

interface FieldErrors {
  locality?: 'errorLocalityRequired';
  street?: 'errorHouseWithoutStreet';
  form?: 'errorAddressNotFound' | 'errorGeocodeUnavailable';
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
  const [localityCode, setLocalityCode] = useState('');
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<'form' | 'searching' | 'choose' | 'results'>('form');
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [query, setQuery] = useState<Query | null>(null);
  const [radiusIdx, setRadiusIdx] = useState(0);
  const [filter, setFilter] = useState('');
  const [announce, setAnnounce] = useState('');
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const chooseHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const localityRef = useRef<HTMLSelectElement>(null);

  const dataset = datasetState.status === 'ok' ? datasetState.value : null;
  const localities = useMemo(
    () => (dataset ? [...dataset.localities].sort((a, b) => a.name.localeCompare(b.name, 'he')) : []),
    [dataset],
  );
  const localityName = (code: string) => localities.find((l) => l.code === code)?.name ?? '';

  const outcome: SearchOutcome | null = useMemo(() => {
    if (!dataset || !query) return null;
    if (query.mode === 'locality') {
      const r = searchByLocality(dataset.sites, query.localityCode);
      return r;
    }
    if (query.mode === 'locality-nearby') {
      const loc = dataset.localities.find((l) => l.code === query.localityCode);
      if (!loc?.centre) return { results: [], excludedInstitutional: 0, excludedConflict: 0, withoutCoordinatesInLocality: 0 };
      return searchByPoint(dataset.sites, { point: loc.centre, precise: false, radiusKm: RADIUS_STEPS_KM[radiusIdx]!, localityCode: null });
    }
    return searchByPoint(dataset.sites, {
      point: query.candidate.point,
      precise: query.candidate.precise,
      radiusKm: RADIUS_STEPS_KM[radiusIdx]!,
      localityCode: query.localityCode,
    });
  }, [dataset, query, radiusIdx]);

  const showResults = (q: Query) => {
    // Validity is re-checked right before results are shown (spec §15).
    setTick((x) => x + 1);
    let next = q;
    if (q.mode === 'locality' && dataset && searchByLocality(dataset.sites, q.localityCode).results.length === 0) {
      next = { mode: 'locality-nearby', localityCode: q.localityCode };
    }
    setRadiusIdx(0);
    setFilter('');
    setQuery(next);
    setPhase('results');
    requestAnimationFrame(() => resultsHeadingRef.current?.focus());
  };

  // Local, in-page filter for long locality lists (big cities). Nothing typed here leaves the device.
  const visibleResults = useMemo(() => {
    if (!outcome) return [];
    const q = filter.replace(/\s+/g, ' ').trim();
    if (!q) return outcome.results;
    return outcome.results.filter((p) =>
      p.sites.some((x) => `${x.address.raw} ${x.officialName}`.replace(/\s+/g, ' ').includes(q)),
    );
  }, [outcome, filter]);

  useEffect(() => {
    if (phase === 'results' && outcome) {
      setAnnounce(outcome.results.length === 1 ? t.resultsCountOne : format(t.resultsCount, { n: outcome.results.length }));
    }
  }, [phase, outcome, t]);

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
    if (!localityCode) errs.locality = 'errorLocalityRequired';
    if (geocodingEnabled && house.trim() && !street.trim()) errs.street = 'errorHouseWithoutStreet';
    setErrors(errs);
    if (errs.locality || errs.street) {
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
    if (!geocodingEnabled || !street.trim()) {
      showResults({ mode: 'locality', localityCode });
      return;
    }
    setPhase('searching');
    setAnnounce(t.loading);
    const res = await geocodeAddress({ locality: localityName(localityCode), street: street.trim(), house: house.trim() });
    if (res.kind === 'ok') {
      if (!needsConfirmation(res.candidates)) {
        const c = res.candidates[0]!;
        showResults({ mode: 'point', label: c.label, candidate: c, localityCode });
      } else {
        setCandidates(res.candidates);
        setPhase('choose');
        requestAnimationFrame(() => chooseHeadingRef.current?.focus());
      }
      return;
    }
    setPhase('form');
    setErrors({ form: res.kind === 'not-found' ? 'errorAddressNotFound' : 'errorGeocodeUnavailable' });
    requestAnimationFrame(() => errorSummaryRef.current?.focus());
  };

  const clearSearch = () => {
    setLocalityCode('');
    setStreet('');
    setHouse('');
    setErrors({});
    setCandidates([]);
    setQuery(null);
    setPhase('form');
    setAnnounce('');
    requestAnimationFrame(() => localityRef.current?.focus());
  };
  const changeAddress = () => {
    setPhase('form');
    setQuery(null);
    requestAnimationFrame(() => localityRef.current?.focus());
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
      errors.form && { field: errors.form === 'errorAddressNotFound' ? 'street' : 'locality', text: t[errors.form] },
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

            <StatusBlock service={service} manifestState={manifestState} datasetState={datasetState} locale={locale} onRetry={() => void refreshManifest()} />

            {active && datasetState.status === 'loading' && <p role="status">{t.loadingData}</p>}

            {active && dataset && phase !== 'results' && phase !== 'choose' && (
              <form className="search" onSubmit={onSubmit} noValidate>
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
                    {errors.form && (
                      <button type="button" className="button secondary" onClick={() => showResults({ mode: 'locality', localityCode })}>
                        {t.searchByLocalityOnly}
                      </button>
                    )}
                  </div>
                )}
                <fieldset>
                  <legend>
                    <h2>{t.formLegend}</h2>
                  </legend>
                  <div className="field">
                    <label htmlFor="f-locality">{t.localityLabel}</label>
                    {t.localityHint && (
                      <p className="hint" id="f-locality-hint">
                        {t.localityHint}
                      </p>
                    )}
                    {errors.locality && (
                      <p className="field-error" id="f-locality-error">
                        {t[errors.locality]}
                      </p>
                    )}
                    <select
                      id="f-locality"
                      ref={localityRef}
                      value={localityCode}
                      onChange={(e) => setLocalityCode(e.target.value)}
                      onKeyDown={onFieldKey}
                      aria-invalid={errors.locality ? true : undefined}
                      aria-describedby={[t.localityHint && 'f-locality-hint', errors.locality && 'f-locality-error'].filter(Boolean).join(' ') || undefined}
                      autoComplete="off"
                    >
                      <option value="">{t.localityChoose}</option>
                      {localities.map((l) => (
                        <option key={l.code} value={l.code} lang="he">
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {geocodingEnabled && (
                    <>
                      <div className="field">
                        <label htmlFor="f-street">{t.streetLabel}</label>
                        {errors.street && (
                          <p className="field-error" id="f-street-error">
                            {t[errors.street]}
                          </p>
                        )}
                        <input
                          id="f-street"
                          type="text"
                          value={street}
                          onChange={(e) => setStreet(e.target.value)}
                          onKeyDown={onFieldKey}
                          autoComplete="off"
                          aria-invalid={errors.street ? true : undefined}
                          aria-describedby={errors.street ? 'f-street-error' : undefined}
                          dir="auto"
                        />
                      </div>
                      <div className="field narrow">
                        <label htmlFor="f-house">{t.houseLabel}</label>
                        <input id="f-house" type="text" inputMode="numeric" value={house} onChange={(e) => setHouse(e.target.value)} onKeyDown={onFieldKey} autoComplete="off" dir="ltr" />
                      </div>
                    </>
                  )}
                </fieldset>
                <button type="button" id="search-submit" className="button primary" onClick={() => void runSearch()} aria-disabled={phase === 'searching' || undefined}>
                  {phase === 'searching' ? t.loading : t.submit}
                </button>
                <p className="privacy-note">{t.noIdNeeded}</p>
                <p className="privacy-note">{geocodingEnabled ? t.googleNotice : t.localOnlyNotice}</p>
              </form>
            )}

            {active && phase === 'choose' && (
              <section className="choose" aria-labelledby="choose-h">
                <h2 id="choose-h" ref={chooseHeadingRef} tabIndex={-1}>
                  {t.chooseAddressTitle}
                </h2>
                <ul className="choice-list">
                  {candidates.map((c) => (
                    <li key={`${c.label}-${c.point.lat}`}>
                      <button
                        type="button"
                        className="button secondary wide"
                        onClick={() => showResults({ mode: 'point', label: c.label, candidate: c, localityCode })}
                      >
                        <bdi>{c.label}</bdi>
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="button link" onClick={changeAddress}>
                  {t.chooseAddressNone}
                </button>
                <p className="attribution">{t.googleAttribution}</p>
              </section>
            )}

            {active && phase === 'results' && outcome && query && verifiedAt && (
              <section className="results" aria-labelledby="results-h">
                <h2 id="results-h" ref={resultsHeadingRef} tabIndex={-1}>
                  {t.resultsTitle}
                </h2>
                <p className="searched">
                  {query.mode === 'point' ? (
                    <>
                      {format(t.resultsNear, { address: '' })}
                      <bdi>{query.label}</bdi>
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
                              ? p.distanceReliable
                                ? t.labelNearest
                                : t.labelInArea
                              : format(t.labelAlternative, { n: i })
                        }
                        t={t}
                        locale={locale}
                        verifiedAt={verifiedAt}
                        beforeNavigate={beforeNavigate}
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
                {query.mode === 'point' && <p className="attribution">{t.googleAttribution}</p>}
                {(outcome.results.length === 0 || outcome.excludedInstitutional > 0) && <OfficialRoute locale={locale} />}
              </section>
            )}

            {!active && <OfficialRoute locale={locale} />}
          </>
        )}

        {view === 'sources' && <SourcesPage t={t} locale={locale} manifest={manifest} service={service} headingRef={mainHeadingRef} />}
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
      return service.degraded ? (
        <div className="notice info">
          <p>{format(t.statusDegraded, { date: date(service.lastVerifiedAt) })}</p>
        </div>
      ) : null;
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
