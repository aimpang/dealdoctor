'use client'

import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { SearchIcon, LoaderIcon, MapPinIcon } from 'lucide-react'

interface AddressInputProps {
  onResult: (data: any) => void
  onError: (error: string) => void
}

interface Suggestion {
  display: string
  street: string
  city: string
  state: string
  zip: string
}

export function AddressInput({ onResult, onError }: AddressInputProps) {
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close suggestions on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Fetch suggestions from Photon API (OpenStreetMap, free, no key)
  const fetchSuggestions = async (query: string) => {
    if (query.length < 5) {
      setSuggestions([])
      return
    }

    try {
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en&lat=39.8283&lon=-98.5795&osm_tag=building&osm_tag=place:house&osm_tag=place:address`
      )
      if (!res.ok) return

      const data = await res.json()
      const results: Suggestion[] = data.features
        ?.filter((f: any) => {
          const props = f.properties
          // Only US results with a street
          return props.country === 'United States' && props.street
        })
        .map((f: any) => {
          const p = f.properties
          const street = p.housenumber ? `${p.housenumber} ${p.street}` : p.street
          const city = p.city || p.town || p.village || ''
          const state = p.state || ''
          const zip = p.postcode || ''
          return {
            display: `${street}, ${city}, ${state}${zip ? ' ' + zip : ''}`,
            street,
            city,
            state,
            zip,
          }
        })
        .slice(0, 5) || []

      setSuggestions(results)
      setShowSuggestions(results.length > 0)
      setSelectedIndex(-1)
    } catch {
      // Silently fail — autocomplete is a nice-to-have
    }
  }

  const handleInputChange = (value: string) => {
    setAddress(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300)
  }

  const selectSuggestion = (suggestion: Suggestion) => {
    setAddress(suggestion.display)
    setShowSuggestions(false)
    setSuggestions([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault()
      selectSuggestion(suggestions[selectedIndex])
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address.trim() || loading) return

    setShowSuggestions(false)
    setLoading(true)
    onError('')

    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address.trim() }),
      })

      const data = await res.json()

      if (!res.ok) {
        onError(data.error || 'Something went wrong')
        return
      }

      onResult(data)
    } catch {
      onError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl">
      <div ref={wrapperRef} className="relative">
        <div
          className={cn(
            "group relative flex items-center rounded-xl border-2 border-border bg-card transition-all duration-300",
            "focus-within:border-primary focus-within:shadow-lg focus-within:shadow-primary/10",
            "hover:border-primary/50"
          )}
        >
          <div className="pointer-events-none pl-4">
            <MapPinIcon className="h-5 w-5 text-muted-foreground transition-colors group-focus-within:text-primary" />
          </div>
          <input
            type="text"
            value={address}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder="742 Evergreen Terrace, Austin, TX 78701"
            className={cn(
              "flex-1 bg-transparent px-3 py-4 text-base text-foreground outline-none",
              "placeholder:text-muted-foreground/60",
              "font-sans"
            )}
            disabled={loading}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={loading || !address.trim()}
            className={cn(
              "mr-2 flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground",
              "transition-all duration-200",
              "hover:bg-primary/90 hover:shadow-md",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "active:scale-95"
            )}
          >
            {loading ? (
              <LoaderIcon className="h-4 w-4 animate-spin" />
            ) : (
              <SearchIcon className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{loading ? 'Analyzing...' : 'Analyze'}</span>
          </button>
        </div>

        {/* Autocomplete dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-xl border bg-card shadow-lg overflow-hidden">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => selectSuggestion(s)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors",
                  i === selectedIndex
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-muted text-foreground"
                )}
              >
                <MapPinIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{s.display}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        US addresses only &middot; First look is free &middot; No signup required
      </p>
    </form>
  )
}
