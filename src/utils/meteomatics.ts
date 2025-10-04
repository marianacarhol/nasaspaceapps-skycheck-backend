export type MeteoPoint = { date: string; value: number };
export type MeteoSeries = { parameter: string; points: MeteoPoint[] };

export function parseMeteomaticsJson(json: any): MeteoSeries[] {
  const out: MeteoSeries[] = [];
  for (const d of json?.data ?? []) {
    const coords = d.coordinates?.[0];
    const points = (coords?.dates ?? []).map((x: any) => ({
      date: String(x.date),
      value: Number(x.value)
    }));
    out.push({ parameter: String(d.parameter), points });
  }
  return out;
}