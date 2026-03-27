import type { Feature, FeatureCollection, GeoJSON, Point } from "geojson";

import type { CustomStation } from "./types";

function parseCSV(text: string): CustomStation[] {
    // Expect headers including lat/lng or latitude/longitude; optional name,id
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    if (lines.length === 0) return [];
    const header = lines[0]
        .split(/,|\t|;|\|/)
        .map((h) => h.trim().toLowerCase());
    const latIdx = header.findIndex((h) => ["lat", "latitude"].includes(h));
    const lngIdx = header.findIndex((h) =>
        ["lng", "lon", "long", "longitude"].includes(h),
    );
    const nameIdx = header.findIndex((h) =>
        ["name", "title", "station", "label"].includes(h),
    );
    const idIdx = header.findIndex((h) =>
        ["id", "station_id", "osm_id"].includes(h),
    );
    const delimiter = lines[0].includes("\t")
        ? "\t"
        : lines[0].includes(";")
          ? ";"
          : lines[0].includes("|")
            ? "|"
            : ",";

    const stations: CustomStation[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(delimiter).map((c) => c.trim());
        if (latIdx < 0 || lngIdx < 0) continue;
        const lat = parseFloat(cols[latIdx]);
        const lng = parseFloat(cols[lngIdx]);
        if (!isFinite(lat) || !isFinite(lng)) continue;
        const name = nameIdx >= 0 ? cols[nameIdx] : undefined;
        const id = idIdx >= 0 && cols[idIdx] ? cols[idIdx] : `${lat},${lng}`;
        stations.push({ id, name, lat, lng });
    }
    return stations;
}

function parseGeoJSON(obj: any): CustomStation[] {
    const stations: CustomStation[] = [];
    const pushFromFeature = (f: Feature<Point>) => {
        if (!f.geometry || f.geometry.type !== "Point") return;
        const [lng, lat] = f.geometry.coordinates;
        if (!isFinite(lat) || !isFinite(lng)) return;
        const props: any = f.properties || {};
        const name = props["name:en"] || props.name || props.title;
        const id = props.id || props.osm_id || props["@id"] || `${lat},${lng}`;
        stations.push({ id: String(id), name, lat, lng });
    };
    if (obj.type === "FeatureCollection") {
        (obj as FeatureCollection).features.forEach((f) =>
            pushFromFeature(f as Feature<Point>),
        );
    } else if (obj.type === "Feature") {
        pushFromFeature(obj as Feature<Point>);
    } else if (obj.type === "Point") {
        const [lng, lat] = (obj as GeoJSON & Point).coordinates as [
            number,
            number,
        ];
        stations.push({ id: `${lat},${lng}`, lat, lng });
    }
    return stations;
}

function parseKML(text: string): CustomStation[] {
    // Really light-weight parser for Point Placemarks; works for Google MyMaps export
    const stations: CustomStation[] = [];
    const placemarks = text.split(/<Placemark[\s>]/i).slice(1);
    for (const pm of placemarks) {
        const nameMatch = pm.match(/<name>([\s\S]*?)<\/name>/i);
        const coordsMatch = pm.match(
            /<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/i,
        );
        if (!coordsMatch) continue;
        // coordinates are lng,lat[,alt]
        const coordStr = coordsMatch[1].trim().split(/\s+/)[0];
        const parts = coordStr.split(",");
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (!isFinite(lat) || !isFinite(lng)) continue;
        const name = nameMatch ? nameMatch[1].trim() : undefined;
        const id = `${lat},${lng}`;
        stations.push({ id, name, lat, lng });
    }
    return stations;
}

export function parseCustomStationsFromText(
    text: string,
    contentTypeHint?: string,
): CustomStation[] {
    // Try by hint
    const hint = (contentTypeHint || "").toLowerCase();
    try {
        if (hint.includes("json")) {
            return parseGeoJSON(JSON.parse(text));
        }
        if (
            hint.includes("kml") ||
            text.includes("<kml") ||
            text.includes("<Placemark")
        ) {
            return parseKML(text);
        }
        if (
            hint.includes("csv") ||
            text.includes(",lat") ||
            text.match(/lat[,;\t ]+lon|latitude/i)
        ) {
            return parseCSV(text);
        }
    } catch {
        // Fall through
    }

    // Try generic detection
    try {
        const obj = JSON.parse(text);
        return parseGeoJSON(obj);
    } catch {
        // Not JSON
    }
    if (text.includes("<kml")) {
        return parseKML(text);
    }
    return parseCSV(text);
}

function parseGeoJSONPolygons(obj: any) {
    const features: Feature<Polygon | MultiPolygon>[] = [];

    const pushFeature = (f: any) => {
        if (!f?.geometry) return;
        const { type, coordinates } = f.geometry;
        if (type === "Polygon" || type === "MultiPolygon") {
            features.push({
                type: "Feature",
                geometry: { type, coordinates },
                properties: f.properties || {},
            });
        }
    };

    if (obj?.type === "FeatureCollection" && Array.isArray(obj.features)) {
        obj.features.forEach((f: any) => pushFeature(f));
    } else if (obj?.type === "Feature") {
        pushFeature(obj);
    } else if (obj?.type === "Polygon" || obj?.type === "MultiPolygon") {
        features.push({
            type: "Feature",
            geometry: { type: obj.type, coordinates: obj.coordinates },
            properties: {},
        });
    }

    return { type: "FeatureCollection", features } as FeatureCollection<
        Polygon | MultiPolygon
    >;
}

function parseKMLPolygons(text: string) {
    const features: Feature<Polygon>[] = [];
    const placemarks = text.split(/<Placemark[\s>]/i).slice(1);

    for (const pm of placemarks) {
        const nameMatch = pm.match(/<name>([\s\S]*?)<\/name>/i);
        const name = nameMatch ? nameMatch[1].trim() : undefined;

        const polygonMatches = pm.matchAll(/<Polygon[\s\S]*?<\/Polygon>/gi);
        for (const match of polygonMatches) {
            const polygonText = match[0];
            const coordsMatches = polygonText.matchAll(
                /<coordinates>([\s\S]*?)<\/coordinates>/gi,
            );
            const rings: number[][][] = [];

            for (const cm of coordsMatches) {
                const coordText = cm[1].trim();
                const coords = coordText
                    .split(/\s+/)
                    .map((c) => c.trim())
                    .filter(Boolean)
                    .map((coord) => coord.split(",").map((n) => parseFloat(n)))
                    .filter(
                        (arr) =>
                            arr.length >= 2 &&
                            Number.isFinite(arr[0]) &&
                            Number.isFinite(arr[1]),
                    )
                    .map(([lng, lat]) => [lng, lat]);

                if (coords.length >= 3) {
                    if (
                        coords[0][0] !== coords[coords.length - 1][0] ||
                        coords[0][1] !== coords[coords.length - 1][1]
                    ) {
                        coords.push(coords[0]);
                    }
                    rings.push(coords);
                }
            }

            if (rings.length > 0) {
                features.push({
                    type: "Feature",
                    geometry: { type: "Polygon", coordinates: rings },
                    properties: name ? { name } : {},
                });
            }
        }
    }

    return {
        type: "FeatureCollection",
        features,
    } as FeatureCollection<Polygon>;
}

export function parseMapPolygonsFromText(
    text: string,
    contentTypeHint?: string,
): FeatureCollection<Polygon | MultiPolygon> {
    const hint = (contentTypeHint || "").toLowerCase();

    try {
        if (hint.includes("json")) {
            return parseGeoJSONPolygons(JSON.parse(text));
        }
        if (
            hint.includes("kml") ||
            text.includes("<kml") ||
            text.includes("<Placemark")
        ) {
            return parseKMLPolygons(text);
        }
    } catch {
        // fall through
    }

    try {
        const obj = JSON.parse(text);
        return parseGeoJSONPolygons(obj);
    } catch {
        // Not JSON
    }

    if (text.includes("<kml")) {
        return parseKMLPolygons(text);
    }

    return { type: "FeatureCollection", features: [] };
}

export function normalizeToStationFeatures(stations: CustomStation[]) {
    // Return GeoJSON FeatureCollection of Points carrying properties { id, name }
    const features: Feature<Point>[] = stations.map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        properties: { id: s.id, name: s.name },
    }));
    return { type: "FeatureCollection", features } as FeatureCollection<Point>;
}
