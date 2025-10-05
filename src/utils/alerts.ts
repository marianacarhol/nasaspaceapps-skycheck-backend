// src/utils/alerts.ts
export type AlertLevel = 'info' | 'warning' | 'danger';

export interface AlertItem {
  text: string;
  level?: AlertLevel;
  href?: string;
  source?: string;
}

export type HourPoint = {
  timeLocal: string;          // 'HH:mm'
  tempC: number;
  probPrecip1h_pct: number;   // 0..100
  precip1h_mm: number;
  uv_idx: number;
};

const TH = {
  UV_INFO: 6,
  UV_WARN: 8,
  HEAT_WARN: 35,
  HEAT_DANGER: 40,
  COLD_WARN: 5,
  COLD_DANGER: -5,
  RAIN_PROB_WARN: 60,
  RAIN_PROB_DANGER: 80,
  RAIN_RATE_WARN: 3,      // mm/h
  RAIN_RATE_DANGER: 7,    // mm/h
  GUST_WARN: 60,          // km/h
  GUST_DANGER: 80,        // km/h
  PM25_WARN: 3,           // 0..5 idx
  PM25_DANGER: 4
};

function windows(hours: HourPoint[], pred: (h: HourPoint)=>boolean){
  const out: {a:number;b:number}[] = [];
  let start = -1;
  hours.forEach((h,i)=>{
    const ok = pred(h);
    if (ok && start===-1) start = i;
    if ((!ok || i===hours.length-1) && start!==-1){
      const end = ok ? i : i-1;
      out.push({a:start,b:end});
      start = -1;
    }
  });
  return out;
}
const join = (hs:HourPoint[], a:number,b:number) => {
  const s = hs[a]?.timeLocal ?? '';
  const e = hs[b]?.timeLocal ?? '';
  return s===e ? s : `${s}–${e}`;
};

export function computeAlerts(opts: {
  hiC?: number;
  loC?: number;
  uv?: number;
  gust_kmh?: number;
  aqi_pm25_idx?: number;
  hourly: HourPoint[];
}): AlertItem[] {
  const { hiC, loC, uv, gust_kmh, aqi_pm25_idx, hourly } = opts;
  const alerts: AlertItem[] = [];
  const src = 'Meteomatics';

  // UV (ventanas en el día)
  const uvDanger = windows(hourly, h => h.uv_idx >= TH.UV_WARN);
  if (uvDanger.length){
    alerts.push({
      level:'warning', source:src,
      text:`Very high UV (${TH.UV_WARN}+) ${uvDanger.map(w=>join(hourly,w.a,w.b)).join(', ')}.`
    });
  } else {
    const uvInfo = windows(hourly, h => h.uv_idx >= TH.UV_INFO);
    if (uvInfo.length){
      alerts.push({
        level:'info', source:src,
        text:`High UV (${TH.UV_INFO}+) ${uvInfo.map(w=>join(hourly,w.a,w.b)).join(', ')}.`
      });
    }
  }

  // Calor / frío (hi/low diarios)
  if (Number.isFinite(hiC)){
    if ((hiC as number) >= TH.HEAT_DANGER)
      alerts.push({ level:'danger', source:src, text:`Extreme heat today (High ~ ${Math.round(hiC as number)}°C).`});
    else if ((hiC as number) >= TH.HEAT_WARN)
      alerts.push({ level:'warning', source:src, text:`Very hot today (High ~ ${Math.round(hiC as number)}°C).`});
  }
  if (Number.isFinite(loC)){
    if ((loC as number) <= TH.COLD_DANGER)
      alerts.push({ level:'danger', source:src, text:`Severe cold (Low ~ ${Math.round(loC as number)}°C).`});
    else if ((loC as number) <= TH.COLD_WARN)
      alerts.push({ level:'warning', source:src, text:`Cold conditions (Low ~ ${Math.round(loC as number)}°C).`});
  }

  // Lluvia (probabilidad y tasa)
  const rainDanger = windows(hourly, h => h.probPrecip1h_pct >= TH.RAIN_PROB_DANGER || h.precip1h_mm >= TH.RAIN_RATE_DANGER);
  if (rainDanger.length){
    alerts.push({
      level:'danger', source:src,
      text:`Heavy rain risk (${TH.RAIN_PROB_DANGER}%+ or ${TH.RAIN_RATE_DANGER} mm/h+) ${rainDanger.map(w=>join(hourly,w.a,w.b)).join(', ')}.`
    });
  } else {
    const rainWarn = windows(hourly, h => h.probPrecip1h_pct >= TH.RAIN_PROB_WARN || h.precip1h_mm >= TH.RAIN_RATE_WARN);
    if (rainWarn.length){
      alerts.push({
        level:'warning', source:src,
        text:`Rain likely (${TH.RAIN_PROB_WARN}%+) ${rainWarn.map(w=>join(hourly,w.a,w.b)).join(', ')}.`
      });
    }
  }

  // Viento (ráfagas)
  if (Number.isFinite(gust_kmh)){
    if ((gust_kmh as number) >= TH.GUST_DANGER)
      alerts.push({ level:'danger', source:src, text:`Damaging wind gusts ${(gust_kmh as number)} km/h.`});
    else if ((gust_kmh as number) >= TH.GUST_WARN)
      alerts.push({ level:'warning', source:src, text:`Strong wind gusts ${(gust_kmh as number)} km/h.`});
  }

  // Calidad del aire (PM2.5 idx 0..5)
  if (Number.isFinite(aqi_pm25_idx)){
    if ((aqi_pm25_idx as number) >= TH.PM25_DANGER)
      alerts.push({ level:'danger', source:src, text:`Air quality: Very Poor (PM2.5 index ${(aqi_pm25_idx as number).toFixed(0)}).`});
    else if ((aqi_pm25_idx as number) >= TH.PM25_WARN)
      alerts.push({ level:'warning', source:src, text:`Air quality: Poor (PM2.5 index ${(aqi_pm25_idx as number).toFixed(0)}).`});
  }

  // Dedup por texto
  const seen = new Set<string>();
  return alerts.filter(a => {
    const k = `${a.level}|${a.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}