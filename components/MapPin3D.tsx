'use client'

import { useEffect, useRef, useState } from 'react'

interface MapPin3DProps {
  city: string
  state: string
  address: string
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

export default function MapPin3D({ city, state, address }: MapPin3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string>('')

  useEffect(() => {
    if (!mountRef.current) return
    if (!MAPBOX_TOKEN) {
      setStatus('error')
      setErrorMsg('Missing NEXT_PUBLIC_MAPBOX_TOKEN')
      return
    }

    let map: import('mapbox-gl').Map | null = null
    let rafId = 0
    let cancelled = false

    const load = async () => {
      const mapboxgl = (await import('mapbox-gl')).default
      if (cancelled) return

      mapboxgl.accessToken = MAPBOX_TOKEN!

      // Geocode the address via Mapbox Geocoding API
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

      map = new mapboxgl.Map({
        container: mountRef.current!,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [lng, lat],
        zoom: 17,
        pitch: 60,
        bearing: -20,
        antialias: true,
        attributionControl: true,
        interactive: true,
      })

      map.on('style.load', () => {
        if (!map) return
        const layers = map.getStyle().layers
        const labelLayerId = layers.find(
          (l) => l.type === 'symbol' && (l.layout as { 'text-field'?: unknown })?.['text-field']
        )?.id

        map.addLayer(
          {
            id: '3d-buildings',
            source: 'composite',
            'source-layer': 'building',
            filter: ['==', 'extrude', 'true'],
            type: 'fill-extrusion',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': [
                'interpolate',
                ['linear'],
                ['get', 'height'],
                0, '#2a3d5c',
                20, '#354d74',
                50, '#4766a0',
                100, '#5a7dc0',
              ],
              'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['zoom'],
                15, 0,
                15.5, ['get', 'height'],
              ],
              'fill-extrusion-base': [
                'interpolate',
                ['linear'],
                ['zoom'],
                15, 0,
                15.5, ['get', 'min_height'],
              ],
              'fill-extrusion-opacity': 0.95,
            },
          },
          labelLayerId
        )

        // Subject property marker
        const el = document.createElement('div')
        el.className = 'mapbox-subject-pin'
        el.innerHTML = `
          <div class="pin-pulse"></div>
          <div class="pin-head">
            <div class="pin-dot"></div>
          </div>
          <div class="pin-stem"></div>
        `
        new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([lng, lat])
          .addTo(map)

        setStatus('ready')

        // Slow rotation
        const tick = () => {
          if (!map) return
          const b = map.getBearing()
          map.setBearing(b + 0.05)
          rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
      })

      map.on('error', (e) => {
        setErrorMsg(e.error?.message ?? 'Map error')
        setStatus('error')
      })
    }

    load().catch((err) => {
      setErrorMsg(err?.message ?? 'Unknown error')
      setStatus('error')
    })

    return () => {
      cancelled = true
      if (rafId) cancelAnimationFrame(rafId)
      map?.remove()
    }
  }, [address, city, state])

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640
  const height = isMobile ? 260 : 420

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border"
      style={{ height, background: '#1a2332' }}
    >
      <style jsx global>{`
        .mapbox-subject-pin {
          position: relative;
          width: 24px;
          height: 56px;
          pointer-events: none;
        }
        .mapbox-subject-pin .pin-pulse {
          position: absolute;
          bottom: -8px;
          left: 50%;
          width: 44px;
          height: 44px;
          margin-left: -22px;
          border-radius: 50%;
          background: rgba(200, 71, 26, 0.35);
          animation: pinPulse 2s ease-out infinite;
        }
        .mapbox-subject-pin .pin-stem {
          position: absolute;
          bottom: 0;
          left: 50%;
          width: 3px;
          height: 28px;
          margin-left: -1.5px;
          background: linear-gradient(to bottom, #c8471a, #991a00);
          border-radius: 2px;
        }
        .mapbox-subject-pin .pin-head {
          position: absolute;
          top: 0;
          left: 50%;
          width: 24px;
          height: 24px;
          margin-left: -12px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #e86838, #c8471a 60%, #991a00);
          box-shadow: 0 0 12px rgba(200, 71, 26, 0.8), 0 2px 6px rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: pinBob 2.2s ease-in-out infinite;
        }
        .mapbox-subject-pin .pin-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 0 4px rgba(255, 255, 255, 0.8);
        }
        @keyframes pinPulse {
          0% { transform: scale(0.4); opacity: 0.7; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes pinBob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .mapboxgl-ctrl-logo, .mapboxgl-ctrl-attrib {
          opacity: 0.6;
        }
      `}</style>

      <div
        className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-white/90 backdrop-blur-sm text-sm font-medium text-gray-900 px-4 py-2 rounded flex items-center gap-2 shadow-lg whitespace-nowrap max-w-[90%] overflow-hidden"
      >
        <span className="w-2 h-2 rounded-full bg-[#c8471a] flex-shrink-0" />
        <span className="truncate">{address}</span>
      </div>

      <div ref={mountRef} className="w-full h-full" />

      <div
        className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none z-[1]"
        style={{ background: 'linear-gradient(to top, rgba(26,35,50,0.9), transparent)' }}
      />

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-xs font-medium tracking-widest uppercase z-[2]">
        {city}, {state}
      </div>

      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
          Loading 3D map…
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm text-center px-6">
          <div>
            <div className="font-medium text-white/90">Map unavailable</div>
            <div className="mt-1 text-xs text-white/50">{errorMsg}</div>
          </div>
        </div>
      )}
    </div>
  )
}
