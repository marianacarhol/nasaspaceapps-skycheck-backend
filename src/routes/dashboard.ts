import { Router } from 'express';
import { z } from 'zod';
import { getMeteomatics } from '../services/meteomatics.js';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';

// Tipo mínimo de la respuesta JSON de Meteomatics
type MeteomaticsJSON = {
  data: Array<{
    parameter: string;
    coordinates: Array<{
      lat: number;
      lon: number;
      dates: Array<{ date: string; value: number }>;
    }>;
  }>;
  user?: string;
  dateGenerated?: string;
};

const router = Router();

const Body = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  targetISO: z.string().optional(),
  timezone: z.string().default('America/Mazatlan')
});

function kmh(ms: number) { return Math.round(ms * 3.6); }
function cardinal(deg: number) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW','N'];
  return dirs[Math.round(deg / 22.5)];
}
function uvText(uv: number) {
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Moderate';
  if (uv < 8) return 'High';
  if (uv < 11) return 'Very High';
  return 'Extreme';
}
function pct(count: number, total: number) { return total ? +(count / total).toFixed(2) : 0; }

router.get('/', (_req, res) => {
  res.json({ ok: true, hint: 'Usa POST /dashboard con { lat, lon, targetISO?, timezone? }' });
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Bad Request', details: parsed.error.format() });
    }
    const { lat, lon, targetISO, timezone } = parsed.data;

    // 1) target (local/UTC) → UTC; y día local (00:00..23:59) → UTC
    const targetLocalDate = targetISO ? new Date(targetISO) : new Date();
    const targetUTC = fromZonedTime(targetLocalDate, timezone);
    const targetISO_utc = targetUTC.toISOString();

    const tzDate = toZonedTime(targetUTC, timezone);
    const dayStartLocal = new Date(tzDate); dayStartLocal.setHours(0, 0, 0, 0);
    const dayEndLocal   = new Date(tzDate); dayEndLocal.setHours(23, 59, 59, 999);
    const dayStartUTC = fromZonedTime(dayStartLocal, timezone).toISOString();
    const dayEndUTC   = fromZonedTime(dayEndLocal, timezone).toISOString();

    const horizonDays = (targetUTC.getTime() - Date.now()) / 86_400_000;
    const mode: 'forecast' | 'outlook' = horizonDays <= 10 ? 'forecast' : 'outlook';

    if (mode === 'outlook') {
      // Placeholder OUTLOOK (sin llamar a Meteomatics)
      // Aquí luego metemos: climatología (p50/p25/p75) y “anomalía” suavizada
      return res.json({
        mode,
        location: { lat, lon },
        targetISO: targetISO_utc,
        timezone,
        outlook: {
          confidence: 'low',
          notes: [
            'Extended outlook basado en climatología y tendencias generales.',
            'Los valores son rangos/percentiles, no pronóstico horario.',
            'Para pronóstico horario usa fechas dentro de 10 días.'
          ],
          temp: {
            typical_hi_c: null,  // TODO: p50 de Tmax climática para esa fecha
            typical_lo_c: null,  // TODO: p50 de Tmin climática para esa fecha
            expected_anomaly_c: 0, // TODO: “blend” de anomalía (forecast d+6..10 → decaimiento)
            range_c: { p25: null, p50: null, p75: null } // TODO
          },
          precip: {
            climo_prob_any_mm: null, // TODO: frecuencia climática de precipitación diaria
            note: 'probabilidades climatológicas aproximadas'
          },
          uv: { typical_idx: null, band: null } // TODO: banda UV típica por época del año
        },
        meta: {
          generatedAt: new Date().toISOString(),
          horizonDays: +horizonDays.toFixed(1)
        }
      });
    }

    // === FORECAST (≤ 10 días): ===

    // 2) SERIE DEL DÍA (4 params)
    const seriesParams = [
      't_2m:C',
      'precip_1h:mm',
      'prob_precip_1h:p',
      'uv:idx'
    ];

    const hourly = await getMeteomatics({
      startISO: dayStartUTC,
      endISO: dayEndUTC,
      timestep: 'PT1H',
      params: seriesParams,
      lat, lon,
      format: 'json'
    }) as MeteomaticsJSON;

    const byParam: Record<string, { date: string; value: number }[]> = {};
    for (const s of hourly.data) {
      byParam[s.parameter] = (s.coordinates?.[0]?.dates ?? [])
        .map(d => ({ date: d.date, value: Number(d.value) }));
    }

    function valueAt(param: string, isoUTC: string) {
      const arr = byParam[param] || [];
      const exact = arr.find(p => p.date === isoUTC);
      if (exact) return exact.value;
      const prev = arr.filter(p => new Date(p.date) <= new Date(isoUTC)).pop();
      return prev ? prev.value : NaN;
    }

    const tempNow = valueAt('t_2m:C', targetISO_utc);
    const p1h     = valueAt('precip_1h:mm', targetISO_utc);
    const pr1h    = valueAt('prob_precip_1h:p', targetISO_utc);
    const uvHour  = valueAt('uv:idx', targetISO_utc);

    const temps = byParam['t_2m:C'] ?? [];
    const hiC = temps.length ? Math.max(...temps.map(x => x.value)) : NaN;
    const loC = temps.length ? Math.min(...temps.map(x => x.value)) : NaN;

    const hourlyOut = (byParam['t_2m:C'] || []).map((row, i) => ({
      timeLocal: formatInTimeZone(new Date(row.date), timezone, 'HH:mm'),
      tempC: row.value,
      probPrecip1h_pct: Math.floor(byParam['prob_precip_1h:p']?.[i]?.value ?? 0), // 👈 si prefieres 1 decimal: Number(...toFixed(1))
      precip1h_mm: byParam['precip_1h:mm']?.[i]?.value ?? 0,
      uv_idx: byParam['uv:idx']?.[i]?.value ?? 0
    }));

    // 3) INSTANTÁNEO (6 params)
    const instantParams = [
      'wind_speed_10m:ms',
      'wind_dir_10m:d',
      'wind_gusts_10m_1h:ms',
      'relative_humidity_2m:p',
      'precip_24h:mm',
      'air_quality_pm2p5:idx'
    ];

    const instant = await getMeteomatics({
      validISO: targetISO_utc,
      params: instantParams,
      lat, lon,
      format: 'json'
    }) as MeteomaticsJSON;

    const pick = (p: string) =>
      Number(instant.data.find(d => d.parameter === p)?.coordinates?.[0]?.dates?.[0]?.value ?? NaN);

    const windMs  = pick('wind_speed_10m:ms');
    const windDir = pick('wind_dir_10m:d');
    const gustMs  = pick('wind_gusts_10m_1h:ms');
    const rh      = pick('relative_humidity_2m:p');
    const p24h    = pick('precip_24h:mm');
    const aqiPM25 = pick('air_quality_pm2p5:idx'); // 0..5

    // 4) Probability Check
    const n = temps.length;
    const extremeRain = pct((byParam['precip_1h:mm'] || []).filter(x => x.value >= 7).length, n);
    const dangerousUV = pct((byParam['uv:idx'] || []).filter(x => x.value >= 8).length, n);
    const veryHot     = pct(temps.filter(x => x.value >= 35).length, n);
    const veryCold    = pct(temps.filter(x => x.value <= 5).length,  n);
    const veryWet     = Math.max(
      extremeRain,
      (byParam['prob_precip_1h:p'] || []).length
        ? pct((byParam['prob_precip_1h:p'] || []).filter(x => x.value >= 60).length, n)
        : 0
    );
    const veryHumid   = pct(
      hourlyOut.filter(x => x.probPrecip1h_pct >= 50 || (x.uv_idx < 3 && rh >= 70)).length, n
    );

    // 5) Respuesta forecast
    const payload = {
      mode,
      location: { lat, lon, name: null },
      panel: {
        veryFlag: { veryWet, veryHot, veryCold, veryHumid, extremeRain, dangerousUV },
        tempNowC: tempNow,
        hiC, loC,
        precipLast1h_mm: p1h,
        precipLast24h_mm: p24h,
        humidity_pct: rh,
        uv_index: uvHour,
        uv_level: uvText(uvHour),
        wind: {
          speed_kmh: kmh(windMs),
          direction_deg: windDir,
          direction_cardinal: cardinal(windDir),
          gust_kmh: kmh(gustMs)
        }
      },
      hourly: hourlyOut,
      airQuality: {
        overall_idx: aqiPM25,
        overall_text: ['Great','Good','Moderate','Poor','Very Poor','Extremely Poor'][Math.min(5, Math.max(0, Math.round(aqiPM25)))]
      },
      alerts: [],
      meta: {
        source: 'meteomatics',
        generatedAt: new Date().toISOString(),
        horizonDays: +horizonDays.toFixed(1),
        params: { series: seriesParams, instant: instantParams }
      }
    };

    res.json(payload);
  } catch (e) {
    next(e);
  }
});

export default router;