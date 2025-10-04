export type RiskCategory = 'very_hot' | 'very_cold' | 'very_windy' | 'very_wet' | 'very_uncomfortable';
export interface RiskQuery {
    lat: number;
    lon: number;
    date?: string;
    start?: string;
    end?: string;
    timestep?: string;
}
export interface RiskResult {
    location: {
        lat: number;
        lon: number;
    };
    window: {
        start: string;
        end: string;
        timestep: string;
    };
    probabilities: Record<RiskCategory, number>;
    details: any;
}
//# sourceMappingURL=types.d.ts.map