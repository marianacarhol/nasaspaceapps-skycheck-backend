export function parseMeteomaticsJson(json) {
    const out = [];
    for (const d of json?.data ?? []) {
        const coords = d.coordinates?.[0];
        const points = (coords?.dates ?? []).map((x) => ({
            date: String(x.date),
            value: Number(x.value)
        }));
        out.push({ parameter: String(d.parameter), points });
    }
    return out;
}
//# sourceMappingURL=meteomatics.js.map