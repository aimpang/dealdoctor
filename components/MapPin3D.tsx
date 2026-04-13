'use client'

import { useEffect, useRef, useState } from 'react'

interface MapPin3DProps {
  city: string
  state: string
  address: string
}

// Rendering engine: MapLibre GL (open-source fork of Mapbox GL, same API).
// Basemap: OpenFreeMap — free OSM-derived vector tiles on a public CDN,
// no API key required, no watermark or logo. Only visible credit is the
// legally-mandatory "© OpenStreetMap contributors" attribution (required
// for any OSM-based map and displayed as a small "i" icon in compact mode).
//
// Geocoding still uses Mapbox (server-side REST API, no visible watermark).

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

export default function MapPin3D({ city, state, address }: MapPin3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string>('')

  useEffect(() => {
    if (!mountRef.current) return
    if (!MAPBOX_TOKEN) {
      setStatus('error')
      setErrorMsg('Missing NEXT_PUBLIC_MAPBOX_TOKEN (used for geocoding only)')
      return
    }

    let map: import('maplibre-gl').Map | null = null
    let cancelled = false

    const load = async () => {
      const maplibregl = (await import('maplibre-gl')).default
      if (cancelled) return

      // Geocode via Mapbox REST — same backend as before; user never sees it.
      const query = encodeURIComponent(`${address}, ${city}, ${state}`)
      const geoRes = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`
      )
      if (!geoRes.ok) {
        setStatus('error')
        setErrorMsg('Geocoding failed')
        return
      }
      const geo = await geoRes.json()
      if (cancelled) return
      const feature = geo.features?.[0]
      if (!feature) {
        setStatus('error')
        setErrorMsg('Address not found on map')
        return
      }
      const [lng, lat] = feature.center as [number, number]

      map = new maplibregl.Map({
        container: mountRef.current!,
        style: BASEMAP_STYLE,
        center: [lng, lat],
        zoom: 17,
        pitch: 60,
        bearing: -20,
        attributionControl: { compact: true }, // small "i" icon instead of full bar
        canvasContextAttributes: { antialias: true },
        interactive: true,
      })

      map.on('load', () => {
        if (!map) return

        // OpenFreeMap / OpenMapTiles schema exposes buildings under the
        // `openmaptiles` source, `building` source-layer, with a `render_height`
        // attribute for building heights. Extrude them with a color ramp that
        // complements the positron basemap.
        map.addLayer({
          id: '3d-buildings',
          source: 'openmaptiles',
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
              0, '#d4d4d8',
              10, '#a1a1aa',
              25, '#737b8a',
              50, '#525968',
              100, '#3f4553',
            ],
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              14, 0,
              15, ['coalesce', ['get', 'render_height'], ['get', 'height'], 0],
            ],
            'fill-extrusion-base': [
              'coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0,
            ],
            'fill-extrusion-opacity': 0.88,
          },
        })

        // Subject-property pin — pulsing orange dot at the geocoded coord.
        const el = document.createElement('div')
        el.style.cssText = `
          width: 18px; height: 18px; border-radius: 999px;
          background: #f97316; border: 3px solid #ffffff;
          box-shadow: 0 0 0 2px #f97316, 0 2px 8px rgba(249, 115, 22, 0.45);
          animation: dd-pin-pulse 1.8s ease-in-out infinite;
        `
        new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map)

        setStatus('ready')
      })

      map.on('error', (e: any) => {
        console.warn('[map]', e?.error?.message || e)
      })
    }

    load()

    return () => {
      cancelled = true
      if (map) map.remove()
    }
  }, [address, city, state])

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border bg-card"
      style={{ aspectRatio: '21 / 9', minHeight: 260 }}
    >
      <style jsx>{`
        @keyframes dd-pin-pulse {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 2px #f97316, 0 2px 8px rgba(249, 115, 22, 0.45);
          }
          50% {
            transform: scale(1.25);
            box-shadow: 0 0 0 8px rgba(249, 115, 22, 0.15), 0 2px 10px rgba(249, 115, 22, 0.6);
          }
        }
      `}</style>

      <div ref={mountRef} className="absolute inset-0" />

      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-sm">
          <div className="text-xs text-muted-foreground">Loading map…</div>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-xs text-muted-foreground">
            Map unavailable — {errorMsg || 'unknown error'}
          </div>
        </div>
      )}
    </div>
  )
}
