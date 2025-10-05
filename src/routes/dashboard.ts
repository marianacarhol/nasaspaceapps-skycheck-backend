import { Router } from 'express';
import { z } from 'zod';
import { getMeteomatics } from '../services/meteomatics.js';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { computeAlerts } from '../utils/alerts.js';

function hasOffset(iso?: string) {
  return !!iso && /([Zz]|[+\-]\d{2}:\d{2})$/.test(iso);
}

// ====== Tipos mínimos de Meteomatics ======
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

// ====== Configuración ======
const router = Router();
const MS_PER_DAY = 86_400_000;
const DEFAULT_TZ = 'America/Mazatlan';

const MAX_FORECAST_DAYS = Number(process.env.METEOMATICS_MAX_FORECAST_DAYS || 14);

const AQ_MAX_FORECAST_DAYS = 5; // Meteomatics suele cortar ~5 días PM2.5


const SERIES_PARAMS = ['t_2m:C', 'precip_1h:mm', 'prob_precip_1h:p', 'uv:idx'] as const;

const INSTANT_PARAMS_BASE = [
  'wind_speed_10m:ms',
  'wind_dir_10m:d',
  'wind_gusts_10m_1h:ms',
  'relative_humidity_2m:p',
  'precip_24h:mm',
] as const;

const AQ_PARAM = 'air_quality_pm2p5:idx';


// ====== Validación del body ======
const Body = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  targetISO: z.string().optional(),            // puede venir local o UTC
  timezone: z.string().default(DEFAULT_TZ)
});

// ====== Utils front-end-like ======
function kmh(ms: number){ return Math.round(ms * 3.6); }
function cardinal(deg: number){
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW','N'];
  return dirs[Math.round(deg/22.5)];
}
function uvText(uv:number){
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Moderate';
  if (uv < 8) return 'High';
  if (uv < 11) return 'Very High';
  return 'Extreme';
}
function overallAQI(idx: number){
  return ['Great','Good','Moderate','Poor','Very Poor','Extremely Poor'][Math.min(5, Math.max(0, Math.round(idx)))];
}

// ====== Helpers estadísticos para climatología ======
function median(nums: number[]) {
  const arr = nums.filter(n => Number.isFinite(n)).sort((a,b)=>a-b);
  const n = arr.length;
  if (!n) return NaN;
  const mid = Math.floor(n/2);
  return n % 2 ? arr[mid] : (arr[mid-1] + arr[mid]) / 2;
}
function percentile(nums: number[], p: number) {
  const arr = nums.filter(n => Number.isFinite(n)).sort((a,b)=>a-b);
  if (!arr.length) return NaN;
  const idx = (arr.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return arr[lo];
  return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
}
function groupByHour(points: {date: string; value: number}[]) {
  const buckets: Record<number, number[]> = {};
  for (const pt of points) {
    const h = new Date(pt.date).getUTCHours();
    (buckets[h] ||= []).push(pt.value);
  }
  return buckets;
}

// ====== Fallback: Climatología (para fechas fuera del horizonte) ======
async function buildClimatology(opts: {
  lat: number; lon: number;
  targetUTC: Date;
  timezone: string;
  yearsBack?: number;
  halfWindowDays?: number;
}) {
  const { lat, lon, targetUTC, timezone, yearsBack = 5, halfWindowDays = 7 } = opts;

  const targetMonth = targetUTC.getUTCMonth();
  const targetDate  = targetUTC.getUTCDate();

  const params = ['t_2m:C','precip_1h:mm','relative_humidity_2m:p','wind_speed_10m:ms','uv:idx'] as const;

  const allByParam: Record<string, {date:string; value:number}[]> = {};
  for (const p of params) allByParam[p] = [];

  const baseYear = targetUTC.getUTCFullYear();
  for (let y = 1; y <= yearsBack; y++) {
    const year = baseYear - y;
    const center = new Date(Date.UTC(year, targetMonth, targetDate, 12, 0, 0, 0));
    const start  = new Date(center.getTime() - halfWindowDays * MS_PER_DAY);
    const end    = new Date(center.getTime() + halfWindowDays * MS_PER_DAY);

    const resp = await getMeteomatics({
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      timestep: 'PT1H',
      params: params as unknown as string[],
      lat, lon, format: 'json'
    }) as MeteomaticsJSON;

    for (const d of resp?.data ?? []) {
      for (const row of d.coordinates?.[0]?.dates ?? []) {
        allByParam[d.parameter].push({ date: row.date, value: Number(row.value) });
      }
    }
  }

  const byHour: Record<string, number[]> = {};
  for (const [param, points] of Object.entries(allByParam)) {
    const buckets = groupByHour(points);
    for (let h = 0; h < 24; h++) byHour[`${param}|${h}`] = buckets[h] ?? [];
  }

  const hourlyOut: {
    timeLocal: string;
    tempC: number;
    probPrecip1h_pct: number;
    precip1h_mm: number;
    uv_idx: number;
  }[] = [];

  const tempsForHiLo: number[] = [];
  for (let h = 0; h < 24; h++) {
    const dLocal = new Date(targetUTC);
    dLocal.setUTCHours(h, 0, 0, 0);
    const timeLocal = formatInTimeZone(dLocal, timezone, 'HH:mm');

    const t_med = median(byHour[`t_2m:C|${h}`] || []);
    const pr_arr = byHour[`precip_1h:mm|${h}`] || [];
    const prob_rain_pct = pr_arr.length ? Math.round(100 * (pr_arr.filter(x => x > 0.1).length / pr_arr.length)) : 0;
    const precip_med = median(pr_arr);
    const uv_med = median(byHour[`uv:idx|${h}`] || []);

    if (Number.isFinite(t_med)) tempsForHiLo.push(t_med);

    hourlyOut.push({
      timeLocal,
      tempC: Number.isFinite(t_med) ? t_med : NaN,
      probPrecip1h_pct: prob_rain_pct,
      precip1h_mm: Number.isFinite(precip_med) ? precip_med : 0,
      uv_idx: Number.isFinite(uv_med) ? uv_med : 0,
    });
  }

  const hiC = tempsForHiLo.length ? percentile(tempsForHiLo, 0.90) : NaN;
  const loC = tempsForHiLo.length ? percentile(tempsForHiLo, 0.10) : NaN;

  const hourUTC = targetUTC.getUTCHours();
  const tempNowC = hourlyOut.length ? hourlyOut[Math.min(23, hourUTC)].tempC : NaN;
  const uv = hourlyOut.length ? hourlyOut[Math.min(23, hourUTC)].uv_idx : 0;

  const humidityAll = (allByParam['relative_humidity_2m:p'] ?? []).map(x => x.value);
  const windAll = (allByParam['wind_speed_10m:ms'] ?? []).map(x => x.value);

  return {
    mode: 'climatology' as const,
    panel: {
      tempNowC,
      hiC, loC,
      precipLast1h_mm: hourlyOut[Math.min(23, hourUTC)]?.precip1h_mm ?? 0,
      precipLast24h_mm: NaN,
      humidity_pct: median(humidityAll),
      uv_index: uv,
      uv_level: uvText(uv),
      wind: {
        speed_kmh: Math.round((median(windAll) || 0) * 3.6),
        direction_deg: NaN,
        direction_cardinal: '—',
        gust_kmh: NaN,
      },
      veryFlag: {
        veryWet: +(hourlyOut.filter(x => x.probPrecip1h_pct >= 60).length / 24).toFixed(2),
        veryHot: +(tempsForHiLo.filter(x => x >= 35).length / (tempsForHiLo.length || 1)).toFixed(2),
        veryCold: +(tempsForHiLo.filter(x => x <= 5).length / (tempsForHiLo.length || 1)).toFixed(2),
        veryHumid: +(hourlyOut.filter(x => x.uv_idx < 3 && false).length / 24).toFixed(2),
        extremeRain: +(hourlyOut.filter(x => x.precip1h_mm >= 7).length / 24).toFixed(2),
        dangerousUV: +(hourlyOut.filter(x => x.uv_idx >= 8).length / 24).toFixed(2),
      }
    },
    hourly: hourlyOut,
  };
}

// ====== Handler principal ======
router.post('/', async (req, res, next) => {
  try {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Bad Request', details: parsed.error.format() });
    }
    const { lat, lon, targetISO, timezone } = parsed.data;

    let targetUTC: Date;
    if (targetISO && hasOffset(targetISO)) {
      // ya viene con zona (Z o ±hh:mm) → es un instante real; NO reconvertir
      targetUTC = new Date(targetISO);
    } else {
      // string “naive” sin zona → interpretarlo como hora LOCAL en `timezone`
      const targetLocal = targetISO ? new Date(targetISO) : new Date();
      targetUTC = fromZonedTime(targetLocal, timezone);
    }
    const targetISO_utc = targetUTC.toISOString();

    const horizonDays = (targetUTC.getTime() - Date.now()) / MS_PER_DAY;

    const instantParams: string[] = [...INSTANT_PARAMS_BASE];
    if (horizonDays <= AQ_MAX_FORECAST_DAYS) {
      instantParams.push(AQ_PARAM); // sólo pedimos AQ si estamos dentro del límite
    }

    // Climatología si excede el horizonte
    if (horizonDays > MAX_FORECAST_DAYS) {
      const clim = await buildClimatology({ lat, lon, targetUTC, timezone, yearsBack: 5, halfWindowDays: 7 });

      const alerts = computeAlerts({
        hiC: clim.panel.hiC,
        loC: clim.panel.loC,
        uv: clim.panel.uv_index,
        gust_kmh: Number.isFinite(clim.panel.wind.gust_kmh) ? clim.panel.wind.gust_kmh : undefined,
        hourly: clim.hourly,
        aqi_pm25_idx: undefined
      });

      return res.json({
        mode: 'climatology',
        location: { lat, lon, name: null },
        panel: clim.panel,
        hourly: clim.hourly,
        airQuality: { overall_idx: 0, overall_text: '—', hourly: [] },
        alerts,
        meta: { source: 'meteomatics:climatology', generatedAt: new Date().toISOString(), horizonDays: +horizonDays.toFixed(1) }
      });
    }

    // Día local (para serie y H/L)
    const tzDate = toZonedTime(targetUTC, timezone);
    const dayStartLocal = new Date(tzDate); dayStartLocal.setHours(0, 0, 0, 0);
    const dayEndLocal   = new Date(tzDate); dayEndLocal.setHours(23, 59, 59, 999);
    const dayStartUTC = fromZonedTime(dayStartLocal, timezone).toISOString();
    const dayEndUTC   = fromZonedTime(dayEndLocal, timezone).toISOString();

    // === 4) Instantáneo (dinámico con retry si falla por mezcla/AQ) ===
    let instant: MeteomaticsJSON | null = null;

    try {
      instant = await getMeteomatics({
        validISO: targetISO_utc,
        params: instantParams,
        lat, lon, format: 'json'
      }) as MeteomaticsJSON;
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      // Si Meteomatics dice "mix request failed" o "not available at time", reintenta sin AQ
      if (/not available at time|mix request failed/i.test(msg)) {
        const filtered = instantParams.filter(p => !/air_quality|pm2p5/i.test(p));
        if (filtered.length !== instantParams.length) {
          instant = await getMeteomatics({
            validISO: targetISO_utc,
            params: filtered,
            lat, lon, format: 'json'
          }) as MeteomaticsJSON;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    const pick = (p: string) =>
      Number(
        instant?.data?.find(d => d.parameter === p)?.coordinates?.[0]?.dates?.[0]?.value ?? NaN
      );

    const windMs   = pick('wind_speed_10m:ms');
    const windDir  = pick('wind_dir_10m:d');
    const gustMs   = pick('wind_gusts_10m_1h:ms');
    const rh       = pick('relative_humidity_2m:p');
    const p24h     = pick('precip_24h:mm');

    // AQ puede venir vacío (porque lo quitamos si estamos fuera del horizonte o falló el mix)
    const pm25IdxRaw = pick('air_quality_pm2p5:idx');
    const pm25Idx    = Number.isFinite(pm25IdxRaw) ? pm25IdxRaw : NaN;

    // Serie del día (5 params, incluye AQ)
    const hourlyJson = await getMeteomatics({
      startISO: dayStartUTC,
      endISO: dayEndUTC,
      timestep: 'PT1H',
      params: [...SERIES_PARAMS],
      lat, lon, format: 'json'
    }) as MeteomaticsJSON;

    const byParam: Record<string, { date: string; value: number }[]> = {};
    for (const s of (hourlyJson.data || [])) {
      byParam[s.parameter] = (s.coordinates?.[0]?.dates ?? [])
        .map(d => ({ date: d.date, value: Number(d.value) }));
    }

    // “temp ahora” como slot más cercano al target
    let tempNowC = NaN;
    {
      const temps = byParam['t_2m:C'] ?? [];
      let best = Infinity;
      for (const row of temps) {
        const diff = Math.abs(new Date(row.date).getTime() - targetUTC.getTime());
        if (diff < best) { best = diff; tempNowC = row.value; }
      }
    }

    // Hi/Low del día local
    const temps = byParam['t_2m:C'] ?? [];
    const hiC = temps.length ? Math.max(...temps.map(x => x.value)) : NaN;
    const loC = temps.length ? Math.min(...temps.map(x => x.value)) : NaN;

    const hourlyOut = (byParam['t_2m:C'] || []).map((row, i) => ({
      timeLocal: formatInTimeZone(new Date(row.date), timezone, 'HH:mm'),
      tempC: row.value,
      probPrecip1h_pct: Math.round(byParam['prob_precip_1h:p']?.[i]?.value ?? 0),
      precip1h_mm: byParam['precip_1h:mm']?.[i]?.value ?? 0,
      uv_idx: byParam['uv:idx']?.[i]?.value ?? 0,
      aqi_idx: byParam['air_quality_pm2p5:idx']?.[i]?.value   // ← NUEVO (puede venir undefined)
    }));

    // precip 1h del slot más cercano
    let precipLast1h = 0;
    {
      const arr = byParam['precip_1h:mm'] ?? [];
      let best = Infinity;
      for (const row of arr) {
        const diff = Math.abs(new Date(row.date).getTime() - targetUTC.getTime());
        if (diff < best) { best = diff; precipLast1h = row.value; }
      }
    }

    // uv / prob del slot más cercano
    let uv = 0;
    {
      const arr = byParam['uv:idx'] ?? [];
      let best = Infinity;
      for (const row of arr) {
        const diff = Math.abs(new Date(row.date).getTime() - targetUTC.getTime());
        if (diff < best) { best = diff; uv = row.value; }
      }
    }

    // === Air Quality ===
    const aqArr = byParam['air_quality_pm2p5:idx'] ?? [];
    // serie horaria para la tablita (0..5)
    const airHourly = aqArr.map(row => ({
      timeLocal: formatInTimeZone(new Date(row.date), timezone, 'HH:mm'),
      pm25_idx: Number(row.value) || 0,
    }));
    // índice "actual" (slot más cercano)
    let overall_idx = 0;
    {
      let best = Infinity;
      for (const row of aqArr) {
        const diff = Math.abs(new Date(row.date).getTime() - targetUTC.getTime());
        if (diff < best) { best = diff; overall_idx = Number(row.value) || 0; }
      }
    }

    // Flags simples
    const n = temps.length || 1;
    const pct = (count:number,total:number)=> total? +(count/total).toFixed(2) : 0;
    const extremeRain = pct((byParam['precip_1h:mm'] || []).filter(x => x.value >= 7).length, n);
    const dangerousUV = pct((byParam['uv:idx'] || []).filter(x => x.value >= 8).length, n);
    const veryHot     = pct(temps.filter(x => x.value >= 35).length, n);
    const veryCold    = pct(temps.filter(x => x.value <= 5).length, n);
    const veryWet     = Math.max(
      extremeRain,
      (byParam['prob_precip_1h:p'] || []).length
        ? pct((byParam['prob_precip_1h:p'] || []).filter(x => x.value >= 60).length, n)
        : 0
    );
    const veryHumid   = pct(
      hourlyOut.filter(x => x.probPrecip1h_pct >= 50 || (x.uv_idx < 3 && (rh >= 70))).length, n
    );

    // ALERTAS
    const alerts = computeAlerts({
      hiC, loC, uv,
      gust_kmh: kmh(gustMs),
      hourly: hourlyOut,
      aqi_pm25_idx: overall_idx
    });

    // Payload final
    res.json({
      mode: horizonDays >= -0.5 ? 'forecast' : 'history',
      location: { lat, lon, name: null },
      panel: {
        veryFlag: { veryWet, veryHot, veryCold, veryHumid, extremeRain, dangerousUV },
        tempNowC,
        hiC, loC,
        precipLast1h_mm: precipLast1h,
        precipLast24h_mm: p24h,
        humidity_pct: rh,
        uv_index: uv,
        uv_level: uvText(uv),
        wind: {
          speed_kmh: kmh(windMs),
          direction_deg: windDir,
          direction_cardinal: cardinal(windDir),
          gust_kmh: kmh(gustMs),
        }
      },
      hourly: hourlyOut,
      airQuality: {
      overall_idx: Number.isFinite(pm25Idx) ? pm25Idx : null,
      overall_text: Number.isFinite(pm25Idx) ? overallAQI(pm25Idx) : 'N/A',
    },
      alerts,
      meta: {
        source: 'meteomatics',
        generatedAt: new Date().toISOString(),
        horizonDays: +horizonDays.toFixed(1),
        params: { series: SERIES_PARAMS, instant: INSTANT_PARAMS_BASE }
      }
    });
  } catch (e) {
    next(e);
  }
});

export default router;