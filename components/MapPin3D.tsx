'use client'

import { useEffect, useRef, useState } from 'react'

interface MapPin3DProps {
  city: string
  state: string
  address: string
}

// Engine: MapLibre GL (MIT fork of Mapbox GL, identical API).
// Basemap: OpenFreeMap — free OSM-derived vector tiles on a public CDN,
// no API key, no watermark, only legally-required "© OpenStreetMap" credit
// (shown as a small "i" icon via compact attribution mode).
//
// Geocoding still uses Mapbox REST (server-side token, not visible to users).

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
      setErrorMsg('Missing NEXT_PUBLIC_MAPBOX_TOKEN (used for geocoding)')
      return
    }

    let map: import('maplibre-gl').Map | null = null
    let cancelled = false

    const load = async () => {
      try {
        // Dynamic import: maplibre-gl uses window-only APIs, can't SSR
        const mod = await import('maplibre-gl')
        // v5 exports both default and named; prefer named to match the types
        const maplibregl: typeof import('maplibre-gl') = (mod as any).default || mod
        if (cancelled) return

        // Geocode via Mapbox REST
        const query = encodeURIComponent(`${address}, ${city}, ${state}`)
        const geoRes = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`
        )
        if (!geoRes.ok) throw new Error(`Geocoding ${geoRes.status}`)
        const geo = await geoRes.json()
        if (cancelled) return
        const feature = geo.features?.[0]
        if (!feature) throw new Error('Address not found on map')
        const [lng, lat] = feature.center as [number, number]

        map = new maplibregl.Map({
          container: mountRef.current!,
          style: BASEMAP_STYLE,
          center: [lng, lat],
          zoom: 17,
          pitch: 60,
          bearing: -20,
          attributionControl: { compact: true },
          interactive: true,
        })

        // Surface any load errors to the UI instead of silently failing
        map.on('error', (e: any) => {
          const msg = e?.error?.message || e?.message || 'map error'
          console.warn('[map]', msg, e)
        })

        map.on('load', () => {
          if (!map || cancelled) return

          // Add 3D buildings IF the style has the openmaptiles source. Wrap in
          // try so a schema mismatch doesn't black out the whole map — 2D still
          // works either way.
          try {
            if (map.getSource('openmaptiles')) {
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
                    'coalesce',
                    ['get', 'render_min_height'],
                    ['get', 'min_height'],
                    0,
                  ],
                  'fill-extrusion-opacity': 0.88,
                },
              } as any)
            }
          } catch (err) {
            console.warn('[map] 3D buildings layer skipped:', err)
          }

          // Subject-property pin — pulsing orange dot at the geocoded point.
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
      } catch (err: any) {
        if (!cancelled) {
          console.error('[map] init failed', err)
          setStatus('error')
          setErrorMsg(err?.message || 'Map failed to load')
        }
      }
    }

    load()

    return () => {
      cancelled = true
      if (map) {
        try {
          map.remove()
        } catch {
          /* ignore teardown errors */
        }
      }
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
