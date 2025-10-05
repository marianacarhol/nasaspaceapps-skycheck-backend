// src/routes/geocode.ts
import { Router } from "express";
import fetch from "node-fetch";

const router = Router();

// Usa un UA propio para cumplir la política de Nominatim
const UA = process.env.NOMINATIM_USER_AGENT || "SkyCheck/1.0 (+https://example.com/contact)";

type OSMSearch = {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
  class?: string;
  type?: string;
}[];

router.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Number(req.query.limit || 5);

    if (!q) return res.status(400).json({ error: "Missing q" });

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", q);
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", String(limit));

    const resp = await fetch(url.toString(), {
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw Object.assign(new Error(`Nominatim ${resp.status}: ${text}`), { status: resp.status });
    }

    const data = (await resp.json()) as OSMSearch;

    // Normalizamos a un formato simple para tu front
    const results = data.map((r) => ({
      name: r.display_name,
      lat: Number(r.lat),
      lon: Number(r.lon),
      category: r.class || "",
      type: r.type || "",
      score: r.importance ?? 0,
    }));

    res.json({ ok: true, count: results.length, results });
  } catch (e) {
    next(e);
  }
});

// opcional: reverse geocoding /geocode/reverse?lat=..&lon=..
router.get("/reverse", async (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: "Invalid lat/lon" });
    }

    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("zoom", "10");
    url.searchParams.set("addressdetails", "1");

    const resp = await fetch(url.toString(), {
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw Object.assign(new Error(`Nominatim ${resp.status}: ${text}`), { status: resp.status });
    }

    const data = await resp.json() as any;
    res.json({
      ok: true,
      result: {
        name: data?.display_name ?? "",
        lat,
        lon,
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;