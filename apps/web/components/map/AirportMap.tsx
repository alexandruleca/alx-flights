'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { GeoJSON, MapContainer, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { MapAircraft, MapPayload, ZoneKind, Zones } from '@alx/contracts';
import { Segmented, type Option } from '../Segmented';
import { AircraftMarker } from './AircraftMarker';
import { MapLegend } from './MapLegend';
import 'leaflet/dist/leaflet.css';

type MapRange = 'field' | 5 | 10 | 15 | 25;

const RANGES: Option<MapRange>[] = [
  { value: 'field', label: 'Field', title: 'Runway, apron and stands' },
  ...([5, 10, 15, 25] as const).map((km) => ({
    value: km,
    label: `${km} km`,
    title: `${km} km around the airport`,
  })),
];

const MAX_ZOOM = 17;

const ZONE_STYLE: Record<ZoneKind, L.PathOptions> = {
  RUNWAY: { color: '#f0d78c', weight: 1.5, fillColor: '#c9a227', fillOpacity: 0.45 },
  APRON: { color: '#7d8b99', weight: 1, fillColor: '#3a4655', fillOpacity: 0.45 },
  APPROACH: {
    color: '#59a8ff',
    weight: 1,
    dashArray: '4 6',
    fillColor: '#59a8ff',
    fillOpacity: 0.04,
  },
  STAND: { color: '#7ddea0', weight: 1, fillColor: '#1f6b45', fillOpacity: 0.5 },
};

/** Leaflet's own GeoJSON type, at the one boundary where we hand zones over. */
function asGeoJson(zones: Zones | Zones['features']): GeoJSON.GeoJsonObject {
  const collection = Array.isArray(zones) ? { type: 'FeatureCollection', features: zones } : zones;
  return collection as unknown as GeoJSON.GeoJsonObject;
}

/** What a range button shows: the airfield, or a radius around the airport. */
function rangeBounds(range: MapRange, data: MapPayload): L.LatLngBounds | null {
  if (!data.airport) return null;
  const airport = L.latLng(data.airport.lat, data.airport.lon);
  if (range !== 'field') return airport.toBounds(range * 2000);
  const field = data.zones?.features.filter((f) => f.properties.kind !== 'APPROACH') ?? [];
  const bounds = field.length ? L.geoJSON(asGeoJson(field)).getBounds() : null;
  return bounds?.isValid() ? bounds.pad(0.2) : airport.toBounds(1000);
}

/** Show a range — around the followed aircraft when one is selected, else the airport. */
function showRange(
  map: L.Map,
  bounds: L.LatLngBounds,
  follow: MapAircraft | null,
  animate: boolean,
): void {
  if (follow) {
    const zoom = Math.min(map.getBoundsZoom(bounds), MAX_ZOOM);
    map.setView([follow.lat, follow.lon], zoom, { animate });
  } else {
    map.fitBounds(bounds, { maxZoom: MAX_ZOOM, animate });
  }
}

/** Frame the airfield once, as soon as the airport is known. */
function InitialView({ data }: { data: MapPayload }) {
  const map = useMap();
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current) return;
    const bounds = rangeBounds('field', data);
    if (!bounds) return;
    showRange(map, bounds, null, false);
    framed.current = true;
  }, [map, data]);
  return null;
}

/** Keep the selected aircraft centered as it moves. */
function FollowSelected({ target }: { target: MapAircraft | null }) {
  const map = useMap();
  const lat = target?.lat;
  const lon = target?.lon;
  useEffect(() => {
    if (lat != null && lon != null) map.panTo([lat, lon], { animate: true, duration: 0.5 });
  }, [map, lat, lon]);
  return null;
}

function ClearOnMapClick({ onClear }: { onClear: () => void }) {
  useMapEvents({ click: onClear });
  return null;
}

export function AirportMap({
  data,
  selectedIcao,
  onSelect,
}: {
  data: MapPayload;
  selectedIcao: string | null;
  /** Markers select their flight; a click on the map clears. */
  onSelect: (flightId: string | null) => void;
}) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [range, setRange] = useState<MapRange>('field');
  const selected = data.aircraft.find((a) => a.icao24 === selectedIcao) ?? null;

  const center = useMemo<[number, number]>(
    () => (data.airport ? [data.airport.lat, data.airport.lon] : [40, 20]),
    [data.airport],
  );
  // Zones only change with a new hello; re-key GeoJSON so Leaflet redraws them.
  const zonesKey = data.zones?.features.map((f) => f.properties.name).join('|') ?? 'none';

  const pickRange = (next: MapRange) => {
    const bounds = rangeBounds(next, data);
    if (!map || !bounds) return;
    showRange(map, bounds, selected, true);
    setRange(next);
  };

  return (
    <div className="map-wrap">
      {data.airport && (
        <Segmented
          label="Map range"
          className="on-map"
          options={RANGES}
          value={range}
          onChange={pickRange}
        />
      )}
      <MapContainer
        ref={setMap}
        center={center}
        zoom={16}
        className="airport-map"
        zoomControl={false}
        scrollWheelZoom
      >
        {/* OSM raster tiles (no API key), darkened in CSS to sit under the desk. */}
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          className="dark-tiles"
          maxZoom={19}
        />
        <ZoomControl position="bottomright" />
        <InitialView data={data} />
        <FollowSelected target={selected} />
        <ClearOnMapClick onClear={() => onSelect(null)} />
        {data.zones && (
          <GeoJSON
            key={zonesKey}
            data={asGeoJson(data.zones)}
            style={(f) => ZONE_STYLE[f?.properties?.kind as ZoneKind]}
            onEachFeature={(feature, layer) => {
              const { kind, name } = feature.properties as { kind: ZoneKind; name: string };
              if (kind === 'STAND') {
                layer.bindTooltip(name, {
                  permanent: true,
                  direction: 'center',
                  className: 'stand-label',
                });
              } else {
                layer.bindTooltip(`${kind} ${name}`);
              }
            }}
          />
        )}
        {data.aircraft.map((aircraft) => (
          <AircraftMarker
            key={aircraft.icao24}
            aircraft={aircraft}
            selected={aircraft.icao24 === selectedIcao}
            onSelect={onSelect}
          />
        ))}
      </MapContainer>
      <MapLegend aircraft={data.aircraft} />
    </div>
  );
}
