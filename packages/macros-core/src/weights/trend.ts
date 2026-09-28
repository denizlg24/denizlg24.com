export const WEIGHT_TREND_ALGORITHM_VERSION = "kalman-local-linear-v1";

const DAY_MS = 86_400_000;
const BOOTSTRAP_OBSERVATION_COUNT = 5;
const OUTLIER_SIGMA_LIMIT = 3;

// Daily scale readings commonly move by 0.5–1 kg from water and gut content.
// The level process noise allows the underlying weight to bend over weeks,
// while the much smaller slope noise prevents it from chasing day-to-day scale
// noise. These values produce an effective response window of roughly 2 weeks.
const MEASUREMENT_VARIANCE_KG2 = 0.65 ** 2;
const LEVEL_PROCESS_VARIANCE_KG2 = 0.015 ** 2;
const SLOPE_PROCESS_VARIANCE_KG2_PER_DAY2 = 0.002 ** 2;
const INITIAL_SLOPE_VARIANCE_KG2_PER_DAY2 = 0.05 ** 2;

export interface WeightObservation {
  date: string;
  weightKg: number;
}

export interface WeightTrendPoint {
  date: string;
  trendWeightKg: number;
  scaleWeightKg: number | null;
  varianceKg2: number;
  slopeKgPerWeek: number | null;
  hasObservation: boolean;
  algorithmVersion: typeof WEIGHT_TREND_ALGORITHM_VERSION;
}

interface Covariance {
  levelLevel: number;
  levelSlope: number;
  slopeLevel: number;
  slopeSlope: number;
}

function parseIsoDate(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;

  return new Date(timestamp).toISOString().slice(0, 10) === date
    ? timestamp
    : null;
}

function formatIsoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function predict(
  level: number,
  slope: number,
  covariance: Covariance,
): { level: number; slope: number; covariance: Covariance } {
  const slopeNoise = SLOPE_PROCESS_VARIANCE_KG2_PER_DAY2;

  return {
    level: level + slope,
    slope,
    covariance: {
      levelLevel:
        covariance.levelLevel +
        covariance.levelSlope +
        covariance.slopeLevel +
        covariance.slopeSlope +
        LEVEL_PROCESS_VARIANCE_KG2 +
        slopeNoise / 4,
      levelSlope:
        covariance.levelSlope + covariance.slopeSlope + slopeNoise / 2,
      slopeLevel:
        covariance.slopeLevel + covariance.slopeSlope + slopeNoise / 2,
      slopeSlope: covariance.slopeSlope + slopeNoise,
    },
  };
}

function update(
  level: number,
  slope: number,
  covariance: Covariance,
  observation: number,
): { level: number; slope: number; covariance: Covariance } {
  const innovationVariance = covariance.levelLevel + MEASUREMENT_VARIANCE_KG2;
  const innovationLimit = OUTLIER_SIGMA_LIMIT * Math.sqrt(innovationVariance);
  const rawInnovation = observation - level;
  const innovation = Math.max(
    -innovationLimit,
    Math.min(innovationLimit, rawInnovation),
  );
  const levelGain = covariance.levelLevel / innovationVariance;
  const slopeGain = covariance.slopeLevel / innovationVariance;

  const nextLevel = level + levelGain * innovation;
  const nextSlope = slope + slopeGain * innovation;
  const nextLevelLevel = (1 - levelGain) * covariance.levelLevel;
  const nextLevelSlope = (1 - levelGain) * covariance.levelSlope;
  const nextSlopeLevel =
    covariance.slopeLevel - slopeGain * covariance.levelLevel;
  const nextSlopeSlope =
    covariance.slopeSlope - slopeGain * covariance.levelSlope;
  const symmetricCrossCovariance = (nextLevelSlope + nextSlopeLevel) / 2;

  return {
    level: nextLevel,
    slope: nextSlope,
    covariance: {
      levelLevel: Math.max(0, nextLevelLevel),
      levelSlope: symmetricCrossCovariance,
      slopeLevel: symmetricCrossCovariance,
      slopeSlope: Math.max(0, nextSlopeSlope),
    },
  };
}

export function computeWeightTrend(
  observations: readonly WeightObservation[],
  endDate?: string,
): WeightTrendPoint[] {
  const observationsByTimestamp = new Map<number, number>();

  for (const observation of observations) {
    const timestamp = parseIsoDate(observation.date);
    if (
      timestamp != null &&
      Number.isFinite(observation.weightKg) &&
      observation.weightKg > 0
    ) {
      observationsByTimestamp.set(timestamp, observation.weightKg);
    }
  }

  const sortedTimestamps = [...observationsByTimestamp.keys()].sort(
    (left, right) => left - right,
  );
  const firstTimestamp = sortedTimestamps.at(0);
  if (firstTimestamp == null) return [];

  const requestedEndTimestamp = endDate ? parseIsoDate(endDate) : null;
  const lastObservationTimestamp = sortedTimestamps.at(-1) ?? firstTimestamp;
  const lastTimestamp = requestedEndTimestamp ?? lastObservationTimestamp;
  if (lastTimestamp < firstTimestamp) return [];

  const firstWeight = observationsByTimestamp.get(firstTimestamp);
  if (firstWeight == null) return [];

  let level = firstWeight;
  let slope = 0;
  let observationCount = 0;
  let lastObservedWeight = firstWeight;
  let covariance: Covariance = {
    levelLevel: MEASUREMENT_VARIANCE_KG2,
    levelSlope: 0,
    slopeLevel: 0,
    slopeSlope: INITIAL_SLOPE_VARIANCE_KG2_PER_DAY2,
  };
  const points: WeightTrendPoint[] = [];

  for (
    let timestamp = firstTimestamp;
    timestamp <= lastTimestamp;
    timestamp += DAY_MS
  ) {
    if (timestamp > firstTimestamp) {
      ({ level, slope, covariance } = predict(level, slope, covariance));
    }

    const observation = observationsByTimestamp.get(timestamp);
    if (observation != null) {
      observationCount += 1;
      lastObservedWeight = observation;
      ({ level, slope, covariance } = update(
        level,
        slope,
        covariance,
        observation,
      ));
    }

    const isBootstrapping = observationCount < BOOTSTRAP_OBSERVATION_COUNT;
    points.push({
      date: formatIsoDate(timestamp),
      trendWeightKg: isBootstrapping ? lastObservedWeight : level,
      scaleWeightKg: observation ?? null,
      varianceKg2: covariance.levelLevel,
      slopeKgPerWeek: isBootstrapping ? null : slope * 7,
      hasObservation: observation != null,
      algorithmVersion: WEIGHT_TREND_ALGORITHM_VERSION,
    });
  }

  return points;
}
