import { getMeteomatics } from '../services/meteomatics.js';
import 'dotenv/config';
async function main() {
    const now = new Date();
    const start = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(); // 3h atrás
    const end = now.toISOString();
    const lat = 29.0892; // Ajusta si quieres
    const lon = -110.9613;
    const data = await getMeteomatics({
        startISO: start,
        endISO: end,
        timestep: 'PT1H',
        params: ['t_2m:C', 'relative_humidity_2m:p', 'wind_speed_10m:ms', 'precip_1h:mm'],
        lat, lon, format: 'json'
    });
    console.log(JSON.stringify(data, null, 2));
}
main().catch(e => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=pingMeteomatics.js.map