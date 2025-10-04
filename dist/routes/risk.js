import { Router } from 'express';
import { z } from 'zod';
import { getMeteomatics } from '../services/meteomatics';
import { parseMeteomaticsJson } from '../utils/meteomatics';
const router = Router();
const RiskSchema = z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    // si no te pasan nada, por default pedimos próximas 24h cada 1h
    start: z.string().datetime().optional(), // ISO 8601
    end: z.string().datetime().optional(),
    timestep: z.string().default('PT1H'),
    // permite que el front pida parámetros (hasta que fijen el Figma)
    params: z.array(z.string()).default([
        't_2m:C',
        'relative_humidity_2m:p',
        'wind_speed_10m:ms',
        'precip_1h:mm'
    ]),
});
router.post('/', async (req, res, next) => {
    try {
        const parsed = RiskSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Bad Request', details: parsed.error.format() });
        }
        const { lat, lon, start, end, timestep, params } = parsed.data;
        const now = new Date();
        const startISO = start ?? now.toISOString();
        const endISO = end ?? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
        const raw = await getMeteomatics({
            startISO: startISO,
            endISO: endISO,
            timestep,
            params,
            lat, lon,
            format: 'json',
        });
        const series = parseMeteomaticsJson(raw);
        // respuesta neutra (sin “probabilidades” todavía)
        res.json({
            location: { lat, lon },
            window: { start: startISO, end: endISO, timestep },
            params,
            series, // [{ parameter, points:[{date,value}] }]
            meta: {
                sourceUser: raw?.user ?? null,
                generatedAt: raw?.dateGenerated ?? null,
                countParams: series.length,
            }
        });
    }
    catch (err) {
        next(err);
    }
});
export default router;
//# sourceMappingURL=risk.js.map