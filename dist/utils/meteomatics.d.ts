export type MeteoPoint = {
    date: string;
    value: number;
};
export type MeteoSeries = {
    parameter: string;
    points: MeteoPoint[];
};
export declare function parseMeteomaticsJson(json: any): MeteoSeries[];
//# sourceMappingURL=meteomatics.d.ts.map