import { useEffect, useState, type RefObject } from 'react';
import type { ServiceState } from '../domain/freshness';
import type { ReleaseManifest } from '../domain/schema';
import { format, formatDate, formatDateTime, formatNumber, type Dict, type Locale } from '../i18n';
import { loadReport, type PublicReport } from '../services/snapshot';
import { A11Y_STATEMENT_DATE, CONTACT, OFFICIAL_INFO_URL, OFFICIAL_LIST_URL } from '../config';

interface HeadingProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
}

export function SourcesPage({ t, locale, manifest, service, headingRef }: { t: Dict; locale: Locale; manifest: ReleaseManifest | null; service: ServiceState } & HeadingProps) {
  const [report, setReport] = useState<PublicReport | null>(null);
  useEffect(() => {
    loadReport().then(setReport, () => setReport(null));
  }, []);
  const dt = (iso: string | null | undefined) => formatDateTime(iso ?? null, locale) ?? t.never;
  const statusShort =
    service.kind === 'active'
      ? service.degraded
        ? t.statusDegradedShort
        : t.statusHealthyShort
      : service.kind === 'uninitialized'
        ? t.statusUninitializedShort
        : t.statusBlockedShort;

  return (
    <section aria-labelledby="sources-h">
      <h1 id="sources-h" ref={headingRef} tabIndex={-1}>
        {t.sourcesTitle}
      </h1>
      <p>{t.sourcesIntro}</p>
      <p>
        <a href={OFFICIAL_LIST_URL} rel="noopener noreferrer" referrerPolicy="no-referrer">
          {t.officialListLink}
        </a>
      </p>
      <dl className="facts">
        <dt>{t.currentStatus}</dt>
        <dd>{statusShort}</dd>
        <dt>{t.lastAttempt}</dt>
        <dd>{dt(manifest?.lastAttemptAt)}</dd>
        <dt>{t.lastVerified}</dt>
        <dd>{dt(manifest?.lastDatasetVerifiedAt)}</dd>
        <dt>{t.lastChanged}</dt>
        <dd>{dt(manifest?.lastContentChangedAt)}</dd>
        <dt>{t.rulesVerified}</dt>
        <dd>{dt(manifest?.lastRulesVerifiedAt)}</dd>
        {manifest?.coverage && (
          <>
            <dt>{t.coverage}</dt>
            <dd>
              {format(t.coverageText, {
                stations: formatNumber(manifest.coverage.specialStations, locale),
                sites: formatNumber(manifest.coverage.specialSites, locale),
                localities: formatNumber(manifest.coverage.localities, locale),
              })}
            </dd>
          </>
        )}
      </dl>
      {report?.verifiedHow && <p>{report.verifiedHow === 'manual-files' ? t.howManual : t.howAutomatic}</p>}
      {report && Object.keys(report.sources).length > 0 && (
        <>
          <h2>{t.filesTitle}</h2>
          <ul className="files">
            {Object.entries(report.sources).map(([id, s]) => (
              <li key={id}>
                <span lang="he" dir="rtl">
                  {s.title ?? id}
                </span>{' '}
                — {format(t.fileUpdated, { date: formatDate(s.modifiedAt, locale) ?? '' })} ·{' '}
                <code dir="ltr" className="hash">
                  SHA-256 {report.sourceChecksums[id]?.slice(0, 16)}…
                </code>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2>{t.limitationsTitle}</h2>
      <ul>
        {t.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

export function PrivacyPage({ t, headingRef }: { t: Dict } & HeadingProps) {
  return (
    <section aria-labelledby="privacy-h">
      <h1 id="privacy-h" ref={headingRef} tabIndex={-1}>
        {t.privacyTitle}
      </h1>
      <ul>
        {t.privacyPoints.map((p) => (
          <li key={p}>{p}</li>
        ))}
        <li>{t.privacyNoGoogle}</li>
      </ul>
    </section>
  );
}

export function AccessibilityPage({ t, locale, headingRef }: { t: Dict; locale: Locale } & HeadingProps) {
  return (
    <section aria-labelledby="a11y-h">
      <h1 id="a11y-h" ref={headingRef} tabIndex={-1}>
        {t.a11yTitle}
      </h1>
      <p>{t.a11yGoal}</p>
      <p>{format(t.a11yTested, { tested: t.a11yTestedList })}</p>
      <p>{format(t.a11yNotTested, { untested: t.a11yUntestedList })}</p>
      {CONTACT.email && CONTACT.phone && (
        <p>
          {renderContact(t.a11yContact, CONTACT.email, CONTACT.phone, CONTACT.phoneE164 ?? CONTACT.phone)}
        </p>
      )}
      {A11Y_STATEMENT_DATE && <p>{format(t.a11yUpdated, { date: formatDate(A11Y_STATEMENT_DATE, locale) ?? A11Y_STATEMENT_DATE })}</p>}
      <p>
        <a href={OFFICIAL_INFO_URL} rel="noopener noreferrer" referrerPolicy="no-referrer">
          {t.officialInfoLink}
        </a>
      </p>
    </section>
  );
}

/** Inserts real links for {email} and {phone} into the translated sentence without using HTML injection. */
function renderContact(template: string, email: string, phone: string, tel: string) {
  const parts = template.split(/(\{email\}|\{phone\})/);
  return parts.map((p, i) =>
    p === '{email}' ? (
      <a key={i} href={`mailto:${email}`} dir="ltr">
        {email}
      </a>
    ) : p === '{phone}' ? (
      <a key={i} href={`tel:${tel}`} dir="ltr">
        <bdi>{phone}</bdi>
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
