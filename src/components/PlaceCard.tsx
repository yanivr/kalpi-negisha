import { useId } from 'react';
import type { PlaceResult } from '../domain/match';
import { compareStationNumbers } from '../domain/match';
import { roundDistance } from '../domain/geo';
import { isAllowedExternalUrl, navigationLinks } from '../domain/navigation';
import { format, formatDate, formatNumber, type Dict, type Locale } from '../i18n';

interface Props {
  place: PlaceResult;
  heading: string | null;
  t: Dict;
  locale: Locale;
  verifiedAt: string;
  /** Called right before a navigation link opens; returning false cancels it (data no longer valid). */
  beforeNavigate: () => boolean;
  /** How the distance is measured: from the exact address, from the user's street line, or approximate. */
  distanceKind?: 'address' | 'street' | 'approx';
}

export function PlaceCard({ place, heading, t, locale, verifiedAt, beforeNavigate, distanceKind = 'approx' }: Props) {
  const id = useId();
  const site = place.site;
  const nav = navigationLinks(site);
  const numbers = [...new Set(place.specialStations.map((s) => s.officialNumber))].sort(compareStationNumbers);
  const instructions = [...new Set(place.specialStations.map((s) => s.accessInstructions).filter((x): x is string => !!x))];

  let distanceText: string | null = null;
  if (place.distanceMeters !== null) {
    const r = roundDistance(place.distanceMeters);
    const d = `${formatNumber(r.value, locale)} ${r.unit === 'km' ? t.unitKm : t.unitM}`;
    distanceText = format(distanceKind === 'address' ? t.distanceAir : distanceKind === 'street' ? t.distanceFromStreet : t.distanceApprox, { distance: d });
  }

  const onNav = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!beforeNavigate()) e.preventDefault();
  };
  const links =
    nav.target === 'coordinates'
      ? [
          { href: nav.waze, label: t.navWaze },
          { href: nav.google, label: t.navGoogle },
        ]
      : [
          { href: nav.waze, label: t.navSearchWaze },
          { href: nav.google, label: t.navSearchGoogle },
        ];

  return (
    <article className="card" aria-labelledby={`${id}-name`}>
      {heading && <p className="card-label">{heading}</p>}
      <h3 id={`${id}-name`} lang="he" dir="rtl">
        {site.officialName}
      </h3>
      <p className="address">
        <bdi lang="he" dir="rtl">
          {site.address.raw}, {site.localityName}
        </bdi>
      </p>
      <p className="classification">{t.classification}</p>
      <p>
        {t.stationsAtPlace}{' '}
        {numbers.map((n, i) => (
          <span key={n}>
            {i > 0 && ', '}
            <bdi dir="ltr" className="num">
              {n}
            </bdi>
          </span>
        ))}
      </p>
      {instructions.length > 0 ? (
        <div className="instructions">
          <p>
            {t.accessInstructions} {t.accessInstructionsOriginal}
          </p>
          <ul>
            {instructions.map((s) => (
              <li key={s} lang="he" dir="rtl">
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted-strong">{t.noAccessDetails}</p>
      )}
      {distanceText && <p>{distanceText}</p>}
      <div className="nav-links">
        {links
          .filter((l) => isAllowedExternalUrl(l.href))
          .map((l) => (
            <a
              key={l.href}
              className="button secondary"
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              onClick={onNav}
            >
              {l.label} <span className="visually-hidden">{t.opensNewWindow}</span>
            </a>
          ))}
      </div>
      <p className="note">
        {t.navNotVerified} {nav.target === 'coordinates' ? t.navBuildingPoint : t.navAddressOnly}
      </p>
      <p className="source">{format(t.sourceLine, { date: formatDate(verifiedAt, locale) ?? '' })}</p>
    </article>
  );
}
