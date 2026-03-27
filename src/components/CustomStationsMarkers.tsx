import { useStore } from "@nanostores/react";
import * as L from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

import { customStations, showStationsAsCircles, showStationNames, useCustomStations } from "@/lib/context";

export const CustomStationsMarkers = () => {
    const map = useMap();
    const $useCustomStations = useStore(useCustomStations);
    const $customStations = useStore(customStations);
    const $showStationsAsCircles = useStore(showStationsAsCircles);
    const $showStationNames = useStore(showStationNames);

    useEffect(() => {
        if (!$useCustomStations || !$customStations.length) return;

        const layers: (L.Marker | L.Circle)[] = [];

        $customStations.forEach((station) => {
            if ($showStationsAsCircles) {
                // Show 500m radius circles
                const circle = L.circle([station.lat, station.lng], {
                    radius: 500, // 500 meters
                    fillColor: "#ff5b00",
                    color: "#fff",
                    weight: 2,
                    opacity: 0.8,
                    fillOpacity: 0.2,
                });

                if (station.name && $showStationNames) {
                    circle.bindPopup(station.name);
                }

                circle.addTo(map);
                layers.push(circle);
            } else {
                // Show markers
                const marker = L.circleMarker([station.lat, station.lng], {
                    radius: 6,
                    fillColor: "#ff5b00",
                    color: "#fff",
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.9,
                });

                if (station.name && $showStationNames) {
                    marker.bindPopup(station.name);
                }

                marker.addTo(map);
                layers.push(marker);
            }
        });

        return () => {
            layers.forEach((layer) => {
                map.removeLayer(layer);
            });
        };
    }, [$useCustomStations, $customStations, $showStationsAsCircles, $showStationNames, map]);

    return null;
};