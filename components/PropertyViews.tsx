'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface PropertyViewsProps {
  address: string
  city: string
  state: string
  lat?: number
  lng?: number
}

// Three Mapbox Static Images covering satellite close-up, satellite wide
// (neighborhood context), and a street-level map with a property pin. Free
// with our existing NEXT_PUBLIC_MAPBOX_TOKEN (50k static-image loads/mo).
//
// We can't pull MLS listing photos (no free API), but aerial + map context
// is what an investor actually needs for diligence: lot shape, adjacent
// buildings, street access, neighborhood feel. DealCheck-style listing
// photos will require an MLS license down the road.

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

function buildStaticImageUrl(params: {
  style: string
  lat: number
  lng: number
  zoom: number
  width?: number
  height?: number
  pin?: boolean
}): string {
  const { style, lat, lng, zoom, width = 640, height = 360, pin = false } = params
  const marker = pin
    ? `pin-l-home+f97316(${lng},${lat})/`
    : ''
  return `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${marker}${lng},${lat},${zoom},0/${width}x${height}@2x?access_token=${MAPBOX_TOKEN}`
}

export function PropertyViews({ address, city, state, lat, lng }: PropertyViewsProps) {
  const [failed, setFailed] = useState<Record<string, boolean>>({})

  if (!MAPBOX_TOKEN || lat == null || lng == null) return null

  const views = [
    {
      id: 'satellite-close',
      label: 'Aerial · Property',
      src: buildStaticImageUrl({
        style: 'satellite-v9',
        lat,
        lng,
        zoom: 19,
        pin: true,
      }),
      alt: `Aerial view of ${address}`,
    },
    {
      id: 'satellite-wide',
      label: 'Aerial · Neighborhood',
      src: buildStaticImageUrl({
        style: 'satellite-streets-v12',
        lat,
        lng,
        zoom: 16,
        pin: true,
      }),
      alt: `Neighborhood aerial around ${city}, ${state}`,
    },
    {
      id: 'map-street',
      label: 'Street Map',
      src: buildStaticImageUrl({
        style: 'streets-v12',
        lat,
        lng,
        zoom: 15,
        pin: true,
      }),
      alt: `Street map with property pin near ${city}, ${state}`,
    },
  ]

  return (
    <section className="rounded-lg border border-border/70 bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Property Views
        </p>
        <p className="text-[10px] text-muted-foreground">
          Aerial + map via Mapbox · no MLS photos
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {views.map((v) => (
          <figure key={v.id} className="flex flex-col">
            {failed[v.id] ? (
              <div
                className={cn(
                  'flex h-40 items-center justify-center rounded-md border bg-muted/40',
                  'text-center text-[11px] text-muted-foreground'
                )}
              >
                {v.label}
                <br />
                unavailable
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={v.src}
                alt={v.alt}
                loading="lazy"
                className="aspect-video w-full rounded-md border border-border/60 object-cover"
                onError={() => setFailed((s) => ({ ...s, [v.id]: true }))}
              />
            )}
            <figcaption className="mt-1.5 text-[10px] font-medium text-muted-foreground">
              {v.label}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
