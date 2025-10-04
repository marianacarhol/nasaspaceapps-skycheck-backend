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
  targetISO: z.string().optional(),                // hora objetivo (local o UTC)
  timezone: z.string().default('America/Mazatlan') // tu zona por defecto
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

    // ============================
    // 2) SERIE DEL DÍA (4 params)
    // ============================
    const seriesParams = [
      't_2m:C',              // temperatura horaria (sirve para H/L y temp "actual")
      'precip_1h:mm',        // precip acumulada última hora
      'prob_precip_1h:p',    // prob de precip última hora (right-aligned)
      'uv:idx'               // índice UV horario
    ];

    const hourly = await getMeteomatics({
      startISO: dayStartUTC,
      endISO: dayEndUTC,
      timestep: 'PT1H',
      params: seriesParams,
      lat, lon,
      format: 'json'
    }) as MeteomaticsJSON;

    // Indexar por parámetro → [{date,value}]
    const byParam: Record<string, { date: string; value: number }[]> = {};
    for (const s of hourly.data) {
      byParam[s.parameter] = (s.coordinates?.[0]?.dates ?? [])
        .map(d => ({ date: d.date, value: Number(d.value) }));
    }

    // Helper: valor en la hora target (igual o anterior más cercana)
    function valueAt(param: string, isoUTC: string) {
      const arr = byParam[param] || [];
      const exact = arr.find(p => p.date === isoUTC);
      if (exact) return exact.value;
      const prev = arr.filter(p => new Date(p.date) <= new Date(isoUTC)).pop();
      return prev ? prev.value : NaN;
    }

    // Temp/precip/uv/prob en la hora target (desde la serie)
    const tempNow = valueAt('t_2m:C', targetISO_utc);
    const p1h     = valueAt('precip_1h:mm', targetISO_utc);
    const pr1h    = valueAt('prob_precip_1h:p', targetISO_utc);
    const uvHour  = valueAt('uv:idx', targetISO_utc);

    // Hi / Low del DÍA (sobre la serie t_2m del día local)
    const temps = byParam['t_2m:C'] ?? [];
    const hiC = temps.length ? Math.max(...temps.map(x => x.value)) : NaN;
    const loC = temps.length ? Math.min(...temps.map(x => x.value)) : NaN;

    // Serie amigable para UI (hora local formateada)
    const hourlyOut = (byParam['t_2m:C'] || []).map((row, i) => ({
      timeLocal: formatInTimeZone(new Date(row.date), timezone, 'HH:mm'),
      tempC: row.value,
      probPrecip1h_pct: Math.round(byParam['prob_precip_1h:p']?.[i]?.value ?? 0),
      precip1h_mm: byParam['precip_1h:mm']?.[i]?.value ?? 0,
      uv_idx: byParam['uv:idx']?.[i]?.value ?? 0
    }));

    // =================================
    // 3) INSTANTÁNEO (6 params) → total 10
    // =================================
    const instantParams = [
      'wind_speed_10m:ms',
      'wind_dir_10m:d',
      'wind_gusts_10m_1h:ms',
      'relative_humidity_2m:p',
      'precip_24h:mm',
      'air_quality_pm2p5:idx' // usamos PM2.5 como "overall" por ahora
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

    // ============================
    // 4) Probability Check (UI)
    // ============================
    // Reglas simples (ajustables):
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
    // “Very humid” (placeholder): prob lluvia ≥50% o UV bajo con HR alta en la hora target
    const veryHumid   = pct(
      hourlyOut.filter(x => x.probPrecip1h_pct >= 50 || (x.uv_idx < 3 && rh >= 70)).length, n
    );

    // ============================
    // 5) Respuesta para la UI
    // ============================
    const payload = {
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
      meta: { source: 'meteomatics', generatedAt: new Date().toISOString(), params: { series: seriesParams, instant: instantParams } }
    };

    res.json(payload);
  } catch (e) {
    next(e);
  }
});

export default router;
