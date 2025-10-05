import { formatInTimeZone } from 'date-fns-tz';

export type AlertLevel = 'info' | 'warning' | 'danger';

export interface AlertItem {
  text: string;
  level?: AlertLevel;
  href?: string;
  source?: string;
}

/** Estructuras compatibles con lo que ya tienes en /dashboard */
export interface HourPoint {
  timeLocal: string;          // 'HH:mm'
  tempC: number;
  probPrecip1h_pct: number;   // 0..100
  precip1h_mm: number;
  uv_idx: number;
}
export interface PanelSummary {
  tempNowC: number;
  hiC: number;
  loC: number;
  precipLast1h_mm: number;
  precipLast24h_mm: number;
  humidity_pct: number;       // RH 0..100
  uv_index: number;
  uv_level: string;
  wind: {
    speed_kmh: number;
    direction_deg: number;
    direction_cardinal: string;
    gust_kmh: number;
  }
}

/** Umbrales (ajústalos a gusto) */
const TH = {
  UV_WARNING: 8,            // "very high"
  UV_INFO: 6,
  HEAT_WARN: 35,            // hiC >= 35
  HEAT_DANGER: 40,          // hiC >= 40
  COLD_WARN: 5,             // loC <= 5°C
  COLD_DANGER: -5,          // loC <= -5°C
  WIND_GUST_WARN: 60,       // km/h
  WIND_GUST_DANGER: 80,     // km/h
  RAIN_PROB_WARN: 60,       // %
  RAIN_PROB_DANGER: 80,     // %
  RAIN_RATE_WARN_MM: 3,     // mm en 1h
  RAIN_RATE_DANGER_MM: 7,   // mm en 1h
  HUMIDEX_WARN: 35,         // sensación térmica
  HUMIDEX_DANGER: 40,
  PM25_IDX_WARN: 3,         // 0..5 (meteomatics *idx*)
  PM25_IDX_DANGER: 4,
};

/** Humidex (aprox): usa T (°C) + RH (%) → índice de sensación */
function humidexApprox(tC: number, rhPct: number): number {
  if (!Number.isFinite(tC) || !Number.isFinite(rhPct)) return tC;
  // Magnus + aproximación de dew point y formula humidex
  const a = 17.27, b = 237.7;
  const alpha = ((a * tC) / (b + tC)) + Math.log(rhPct / 100);
  const dew = (b * alpha) / (a - alpha);
  const e = 6.11 * Math.exp(5417.7530 * ((1/273.16) - (1/(dew + 273.15))));
  const h = tC + (5/9) * (e - 10);
  return h;
}

/** Encuentra rangos horarios consecutivos (p.ej., 13:00–15:00) donde la condición es true */
function findConsecutiveWindows<H extends HourPoint>(
  hours: H[],
  predicate: (h: H) => boolean
): { startIdx: number; endIdx: number }[] {
  const out: { startIdx: number; endIdx: number }[] = [];
  let runStart = -1;
  hours.forEach((h, i) => {
    const ok = predicate(h);
    if (ok && runStart === -1) runStart = i;
    if ((!ok || i === hours.length - 1) && runStart !== -1) {
      const endIdx = ok ? i : i - 1;
      out.push({ startIdx: runStart, endIdx });
      runStart = -1;
    }
  });
  return out;
}

function joinRange(hours: HourPoint[], a: number, b: number) {
  const s = hours[a]?.timeLocal ?? '';
  const e = hours[b]?.timeLocal ?? '';
  return s === e ? s : `${s}–${e}`;
}

/** Construye alertas a partir del panel + serie horaria del *día local* */
export function buildAlerts(opts: {
  panel: PanelSummary;
  hourly: HourPoint[];
  timezone: string;
  targetUTC: Date;
  pm25Index?: number;             // si lo tienes (0..5), pásalo
}): AlertItem[] {
  const { panel, hourly, timezone, targetUTC, pm25Index } = opts;
  const alerts: AlertItem[] = [];
  const src = 'Meteomatics';

  // 1) UV
  const uvDangerWindows = findConsecutiveWindows(hourly, h => h.uv_idx >= TH.UV_WARNING);
  if (uvDangerWindows.length) {
    const ranges = uvDangerWindows.map(w => joinRange(hourly, w.startIdx, w.endIdx)).join(', ');
    alerts.push({
      level: 'warning',
      source: src,
      text: `Very high UV (${TH.UV_WARNING}+) around ${ranges}. Use sunscreen & shade.`,
    });
  } else {
    const uvInfoWindows = findConsecutiveWindows(hourly, h => h.uv_idx >= TH.UV_INFO);
    if (uvInfoWindows.length) {
      const ranges = uvInfoWindows.map(w => joinRange(hourly, w.startIdx, w.endIdx)).join(', ');
      alerts.push({
        level: 'info',
        source: src,
        text: `High UV (${TH.UV_INFO}+) around ${ranges}.`,
      });
    }
  }

  // 2) Calor/Frío por Hi/Low del día
  if (Number.isFinite(panel.hiC)) {
    if (panel.hiC >= TH.HEAT_DANGER) {
      alerts.push({ level: 'danger', source: src, text: `Extreme heat today (High ~ ${Math.round(panel.hiC)}°C).` });
    } else if (panel.hiC >= TH.HEAT_WARN) {
      alerts.push({ level: 'warning', source: src, text: `Very hot today (High ~ ${Math.round(panel.hiC)}°C).` });
    }
  }
  if (Number.isFinite(panel.loC)) {
    if (panel.loC <= TH.COLD_DANGER) {
      alerts.push({ level: 'danger', source: src, text: `Severe cold tonight (Low ~ ${Math.round(panel.loC)}°C).` });
    } else if (panel.loC <= TH.COLD_WARN) {
      alerts.push({ level: 'warning', source: src, text: `Cold conditions (Low ~ ${Math.round(panel.loC)}°C).` });
    }
  }

  // 3) Lluvia por probabilidad/rate (busca ventanas)
  const rainDanger = findConsecutiveWindows(hourly, h =>
    h.probPrecip1h_pct >= TH.RAIN_PROB_DANGER || h.precip1h_mm >= TH.RAIN_RATE_DANGER_MM
  );
  if (rainDanger.length) {
    const ranges = rainDanger.map(w => joinRange(hourly, w.startIdx, w.endIdx)).join(', ');
    alerts.push({
      level: 'danger',
      source: src,
      text: `Heavy rain risk (${TH.RAIN_PROB_DANGER}%+ or ${TH.RAIN_RATE_DANGER_MM}mm/h+) around ${ranges}.`,
    });
  } else {
    const rainWarn = findConsecutiveWindows(hourly, h =>
      h.probPrecip1h_pct >= TH.RAIN_PROB_WARN || h.precip1h_mm >= TH.RAIN_RATE_WARN_MM
    );
    if (rainWarn.length) {
      const ranges = rainWarn.map(w => joinRange(hourly, w.startIdx, w.endIdx)).join(', ');
      alerts.push({
        level: 'warning',
        source: src,
        text: `Rain likely (${TH.RAIN_PROB_WARN}%+) around ${ranges}.`,
      });
    }
  }

  // 4) Viento (ráfagas)
  if (panel.wind.gust_kmh >= TH.WIND_GUST_DANGER) {
    alerts.push({ level: 'danger', source: src, text: `Damaging wind gusts ${panel.wind.gust_kmh} km/h.` });
  } else if (panel.wind.gust_kmh >= TH.WIND_GUST_WARN) {
    alerts.push({ level: 'warning', source: src, text: `Strong wind gusts ${panel.wind.gust_kmh} km/h.` });
  }

  // 5) Sensación térmica con humedad (humidex)
  const humidex = humidexApprox(panel.tempNowC, panel.humidity_pct);
  if (Number.isFinite(humidex)) {
    if (humidex >= TH.HUMIDEX_DANGER) {
      alerts.push({ level: 'danger', source: src, text: `Dangerous heat stress (Humidex ~ ${Math.round(humidex)}).` });
    } else if (humidex >= TH.HUMIDEX_WARN) {
      alerts.push({ level: 'warning', source: src, text: `Heat stress (Humidex ~ ${Math.round(humidex)}).` });
    }
  }

  // 6) Calidad del aire (si la tienes como idx 0..5)
  if (Number.isFinite(pm25Index ?? NaN)) {
    if ((pm25Index as number) >= TH.PM25_IDX_DANGER) {
      alerts.push({ level: 'danger', source: src, text: `Air quality: Very Poor (PM2.5 index ${(pm25Index as number).toFixed(0)}).` });
    } else if ((pm25Index as number) >= TH.PM25_IDX_WARN) {
      alerts.push({ level: 'warning', source: src, text: `Air quality: Poor (PM2.5 index ${(pm25Index as number).toFixed(0)}).` });
    }
  }

  // 7) Etiqueta de fecha local (opcional, para depurar)
  const localLabel = formatInTimeZone(targetUTC, timezone, "MMM d, yyyy");
  if (!alerts.length) {
    alerts.push({ level: 'info', source: src, text: `No significant weather alerts for ${localLabel}.` });
  }

  // Pequeña deduplicación por texto
  const seen = new Set<string>();
  return alerts.filter(a => {
    const key = `${a.level}|${a.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
