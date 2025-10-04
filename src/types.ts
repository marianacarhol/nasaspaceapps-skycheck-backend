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