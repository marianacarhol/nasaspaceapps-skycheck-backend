export type RiskCategory = 'very_hot' | 'very_cold' | 'very_windy' | 'very_wet' | 'very_uncomfortable';

export interface RiskQuery {
  lat: number;
  lon: number;
  date?: string;        // ISO date (YYYY-MM-DD) o rango
  start?: string;       // ISO datetime
  end?: string;         // ISO datetime
  timestep?: string;    // e.g. '1h'
}

export interface RiskResult {
  location: { lat: number; lon: number };
  window: { start: string; end: string; timestep: string };
  probabilities: Record<RiskCategory, number>; // 0..1
  details: any; // para depurar (podemos quitar en prod)
}

export type MeteomaticsJSON = {
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

export type AlertSeverity = 'info' | 'warning' | 'danger';

export interface Alert {
  id: string;                  // ej. "uv_high"
  severity: AlertSeverity;     // 'info' | 'warning' | 'danger'
  title: string;               // corto
  message?: string;            // detalle
  startsAt?: string;           // opcional
  endsAt?: string;             // opcional
  evidence?: Record<string, number | string>;
}
