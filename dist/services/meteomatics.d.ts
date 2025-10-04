/**
 * Llama a Meteomatics.
 * - Instante: pasar `validISO`
 * - Rango: pasar `startISO` y `endISO` + `timestep` en ISO8601 (ej: 'PT1H')
 * - `params` deben incluir unidad: p.ej. 't_2m:C', 'relative_humidity_2m:p', 'wind_speed_10m:ms', 'precip_1h:mm'
 */
export declare function getMeteomatics(opts: {
    validISO?: string;
    startISO?: string;
    endISO?: string;
    timestep?: string;
    params: string[];
    lat: number;
    lon: number;
    format?: 'json' | 'csv' | 'xml';
}): Promise<unknown>;
//# sourceMappingURL=meteomatics.d.ts.map