import fetch from 'node-fetch';
const BASE = 'https://api.meteomatics.com';
function authHeader() {
    const u = process.env.METEOMATICS_USERNAME || '';
    const p = process.env.METEOMATICS_PASSWORD || '';
    if (!u || !p)
        throw new Error('Faltan METEOMATICS_USERNAME/METEOMATICS_PASSWORD en .env');
    const token = Buffer.from(`${u}:${p}`).toString('base64');
    return { Authorization: `Basic ${token}` };
}
/**
 * Llama a Meteomatics.
 * - Instante: pasar `validISO`
 * - Rango: pasar `startISO` y `endISO` + `timestep` en ISO8601 (ej: 'PT1H')
 * - `params` deben incluir unidad: p.ej. 't_2m:C', 'relative_humidity_2m:p', 'wind_speed_10m:ms', 'precip_1h:mm'
 */
export async function getMeteomatics(opts) {
    const { validISO, startISO, endISO, timestep = 'PT1H', params, lat, lon, format = 'json' } = opts;
    if (!params?.length)
        throw new Error('params requerido');
    let timePart;
    if (startISO && endISO)
        timePart = `${startISO}--${endISO}:${timestep}`;
    else if (validISO)
        timePart = validISO;
    else
        throw new Error('Provee validISO o (startISO y endISO)');
    const path = `/${encodeURIComponent(timePart)}/${params.join(',')}/${lat},${lon}/${format}`;
    const url = `${BASE}${path}`;
    const resp = await fetch(url, { headers: authHeader() });
    if (!resp.ok) {
        const text = await resp.text();
        throw Object.assign(new Error(`Meteomatics ${resp.status}: ${text}`), { status: resp.status });
    }
    return format === 'json' ? resp.json() : resp.text();
}
//# sourceMappingURL=meteomatics.js.map