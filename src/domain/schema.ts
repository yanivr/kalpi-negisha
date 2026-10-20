import { z } from 'zod';

/**
 * Data model (spec §13). Polling site, station, source and evidence are kept separate.
 * Station numbers are strings exactly as normalised from the official source; never numbers.
 */

export const TriState = z.enum(['yes', 'no', 'unknown']);
export type TriState = z.infer<typeof TriState>;

export const StationKind = z.enum(['accessible_special', 'accessible_assigned', 'other', 'unknown']);
export type StationKind = z.infer<typeof StationKind>;

export const Evidence = z.object({
  sourceId: z.string().min(1),
  sourceVersion: z.string().min(1),
  sourceUrl: z.string().nullable(),
  recordLocator: z.string().min(1),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  publishedAt: z.string().nullable(),
  checkedAt: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

/** Compact evidence reference used inside the shipped dataset (full evidence lives in the release report). */
export const EvidenceRef = z.object({
  sourceId: z.string().min(1),
  recordLocator: z.string().min(1),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const PointAccuracy = z.enum(['entrance', 'building', 'approximate']);
export type PointAccuracy = z.infer<typeof PointAccuracy>;

export const Station = z.object({
  officialNumber: z.string().regex(/^\d+(\.\d+)?$/),
  kind: StationKind,
  active: TriState,
  /** Official per-station access instructions for people with limited mobility, verbatim, or null. */
  accessInstructions: z.string().nullable(),
  evidence: EvidenceRef,
});
export type Station = z.infer<typeof Station>;

export const PlacePublicAccess = z.object({
  value: TriState,
  /** Machine reason, e.g. "regular-station-public-building" or "institution-type:בית אבות". */
  reason: z.string(),
});

export const PollingSite = z.object({
  siteId: z.string().min(1),
  officialCompoundId: z.string().nullable(),
  electionId: z.string().min(1),
  localityCode: z.string().min(1),
  localityName: z.string().min(1),
  officialName: z.string().min(1),
  placeType: z.string().nullable(),
  address: z.object({
    locality: z.string(),
    street: z.string().nullable(),
    house: z.string().nullable(),
    raw: z.string(),
  }),
  point: z
    .object({
      lat: z.number().min(29).max(34),
      lon: z.number().min(34).max(36.5),
      accuracy: PointAccuracy,
      evidence: EvidenceRef,
    })
    .nullable(),
  publicAccess: PlacePublicAccess,
  stations: z.array(Station).min(1),
  /** Reasons this site must not be recommended (local conflicts). Empty array = no known conflict. */
  blockedReasons: z.array(z.string()),
  evidence: z.array(EvidenceRef).min(1),
});
export type PollingSite = z.infer<typeof PollingSite>;

export const SourceSummary = z.object({
  sourceId: z.string(),
  title: z.string(),
  publisher: z.string(),
  url: z.string().nullable(),
  acquisition: z.enum(['automatic', 'manual']),
  contentSha256: z.string(),
  fileCreatedAt: z.string().nullable(),
  fileModifiedAt: z.string().nullable(),
  rows: z.number().int(),
});
export type SourceSummary = z.infer<typeof SourceSummary>;

export const Dataset = z.object({
  schemaVersion: z.literal('1'),
  releaseId: z.string(),
  electionId: z.string(),
  /** Null in the shipped file so identical sources produce an identical, content-addressed file. */
  generatedAt: z.string().nullable(),
  sources: z.array(SourceSummary),
  localities: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      /** Median of the official compound coordinates of the locality — approximate, used only for "nearby" when the locality has no result. */
      centre: z.object({ lat: z.number(), lon: z.number() }).nullable(),
    }),
  ),
  sites: z.array(PollingSite),
});
export type Dataset = z.infer<typeof Dataset>;

export const ManifestStatus = z.enum(['healthy', 'degraded', 'blocked', 'uninitialized']);
export type ManifestStatus = z.infer<typeof ManifestStatus>;

export const ReleaseManifest = z.object({
  schemaVersion: z.literal('1'),
  releaseId: z.string(),
  electionId: z.string(),
  electionDate: z.string(),
  electionPhase: z.enum(['upcoming', 'voting', 'ended', 'suspended']),
  pollsCloseAt: z.string(),
  lastAttemptAt: z.string(),
  lastDatasetVerifiedAt: z.string().nullable(),
  lastRulesVerifiedAt: z.string().nullable(),
  lastContentChangedAt: z.string().nullable(),
  /** 'ttl': expiresAt is enforced. 'no-expiry': product-owner decision — no time-based expiry; changes in the source still block. */
  freshnessPolicy: z.enum(['ttl', 'no-expiry']),
  expiresAt: z.string().nullable(),
  /** Result of the latest refresh attempt, shown to users when it did not complete. */
  lastAttemptResult: z.enum(['verified-unchanged', 'verified-changed', 'failed', 'not-attempted']),
  status: ManifestStatus,
  nationwideCoverage: z.enum(['verified', 'unverified']),
  ruleVersion: z.string().nullable(),
  localeRuleVersions: z.record(z.string(), z.string().nullable()),
  datasetFile: z.string().nullable(),
  datasetSha256: z.string().nullable(),
  recordCounts: z.object({
    sourceRows: z.number().int(),
    acceptedRows: z.number().int(),
    quarantinedRows: z.number().int(),
  }),
  coverage: z
    .object({
      specialStations: z.number().int(),
      specialSites: z.number().int(),
      localities: z.number().int(),
      recommendableSites: z.number().int(),
    })
    .nullable(),
  reasons: z.array(z.string()),
});
export type ReleaseManifest = z.infer<typeof ReleaseManifest>;
