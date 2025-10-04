import { Router } from 'express';
import { z } from 'zod';
import { getMeteomatics } from '../services/meteomatics.js';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';
const router = Router();
const Body = z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    targetISO: z.string().optional(), // hora objetivo (local o UTC)
    timezone: z.string().default('America/Mazatlan')
});
function kmh(ms) { return Math.round(ms * 3.6); }
function cardinal(deg) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW', 'N'];
    return dirs[Math.round(deg / 22.5)];
}
function uvText(uv) {
    if (uv < 3)
        return 'Low';
    if (uv < 6)
        return 'Moderate';
    if (uv < 8)
        return 'High';
    if (uv < 11)
        return 'Very High';
    return 'Extreme';
}
function overallAQI(idx) {
    return ['Great', 'Good', 'Moderate', 'Poor', 'Very Poor', 'Extremely Poor'][Math.min(5, Math.max(0, Math.round(idx)))];
}
router.post('/', async (req, res, next) => {
    try {
        const parsed = Body.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Bad Request', details: parsed.error.format() });
        }
        const { lat, lon, targetISO, timezone } = parsed.data;
        // 1) target (local o UTC) -> UTC real para consultar instantáneo
        const targetLocalDate = targetISO ? new Date(targetISO) : new Date();
        const targetUTC = fromZonedTime(targetLocalDate, timezone);
        const targetISO_utc = targetUTC.toISOString();
        // 2) calcular el día local (00:00..23:59:59.999) y convertir sus extremos a UTC
        const tzDate = toZonedTime(targetUTC, timezone); // “mismo instante” pero visto en TZ
        const dayStartLocal = new Date(tzDate);
        dayStartLocal.setHours(0, 0, 0, 0);
        const dayEndLocal = new Date(tzDate);
        dayEndLocal.setHours(23, 59, 59, 999);
        const dayStartUTC = fromZonedTime(dayStartLocal, timezone).toISOString();
        const dayEndUTC = fromZonedTime(dayEndLocal, timezone).toISOString();
        // === 3) Instantáneo en targetISO_utc ===
        const instantParams = [
            't_2m:C',
            'wind_speed_10m:ms', 'wind_dir_10m:d', 'wind_gusts_10m_1h:ms',
            'relative_humidity_2m:p',
            'precip_1h:mm', 'precip_24h:mm',
            'prob_precip_1h:p', 'prob_precip_24h:p',
            'uv:idx',
            'air_quality_pm2p5:idx', 'air_quality_pm10:idx', 'air_quality_no2:idx', 'air_quality_o3:idx', 'air_quality_so2:idx'
        ];
        const instant = await getMeteomatics({
            validISO: targetISO_utc,
            params: instantParams,
            lat, lon,
            format: 'json'
        });
        const pick = (p) => Number(instant.data.find(d => d.parameter === p)?.coordinates?.[0]?.dates?.[0]?.value ?? NaN);
        const tempNow = pick('t_2m:C');
        const windMs = pick('wind_speed_10m:ms');
        const windDir = pick('wind_dir_10m:d');
        const gustMs = pick('wind_gusts_10m_1h:ms');
        const rh = pick('relative_humidity_2m:p');
        const p1h = pick('precip_1h:mm');
        const p24h = pick('precip_24h:mm');
        const pr1h = pick('prob_precip_1h:p');
        const pr24h = pick('prob_precip_24h:p');
        const uv = pick('uv:idx');
        const aq = {
            pm2p5_idx: pick('air_quality_pm2p5:idx'),
            pm10_idx: pick('air_quality_pm10:idx'),
            no2_idx: pick('air_quality_no2:idx'),
            o3_idx: pick('air_quality_o3:idx'),
            so2_idx: pick('air_quality_so2:idx'),
        };
        const overall_idx = Math.max(...Object.values(aq).map(v => Number.isFinite(v) ? v : 0));
        // === 4) Serie horaria del día local ===
        const seriesParams = ['t_2m:C', 'precip_1h:mm', 'prob_precip_1h:p', 'uv:idx'];
        const hourly = await getMeteomatics({
            startISO: dayStartUTC,
            endISO: dayEndUTC,
            timestep: 'PT1H',
            params: seriesParams,
            lat, lon,
            format: 'json'
        });
        // Indexar por parámetro
        const byParam = {};
        for (const s of hourly.data) {
            const arr = (s.coordinates?.[0]?.dates ?? [])
                .map(d => ({ date: d.date, value: Number(d.value) }));
            byParam[s.parameter] = arr;
        }
        // Hi / Low (día local)
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
        // === 5) Probability Check (reglas iniciales; ajustables)
        const pct = (count, total) => total ? +(count / total).toFixed(2) : 0;
        const n = temps.length;
        const veryHot = pct(temps.filter(x => x.value >= 35).length, n);
        const veryCold = pct(temps.filter(x => x.value <= 5).length, n);
        const extremeRain = pct((byParam['precip_1h:mm'] || []).filter(x => x.value >= 7).length, n);
        const dangerousUV = pct((byParam['uv:idx'] || []).filter(x => x.value >= 8).length, n);
        const veryWet = Math.max(extremeRain, (byParam['prob_precip_1h:p'] || []).length
            ? pct((byParam['prob_precip_1h:p'] || []).filter(x => x.value >= 60).length, n)
            : 0);
        // placeholder simple para “veryHumid”
        const veryHumid = pct(hourlyOut.filter(x => x.probPrecip1h_pct >= 50 || (x.uv_idx < 3 && rh >= 70)).length, n);
        const payload = {
            location: { lat, lon, name: null },
            panel: {
                veryFlag: { veryWet, veryHot, veryCold, veryHumid, extremeRain, dangerousUV },
                tempNowC: tempNow,
                hiC, loC,
                precipLast1h_mm: p1h,
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
                overall_idx,
                overall_text: overallAQI(overall_idx),
                components: aq
            },
            alerts: [],
            meta: { source: 'meteomatics', generatedAt: new Date().toISOString(), prob_precip_note: 'right-aligned' }
        };
        res.json(payload);
    }
    catch (e) {
        next(e);
    }
});
export default router;
//# sourceMappingURL=dashboard.js.map