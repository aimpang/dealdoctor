'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { SearchIcon, LoaderIcon, MapPinIcon } from 'lucide-react'

interface AddressInputProps {
  onResult: (data: any) => void
  onError: (error: string) => void
}

export function AddressInput({ onResult, onError }: AddressInputProps) {
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address.trim() || loading) return

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
          onChange={(e) => setAddress(e.target.value)}
          placeholder="742 Evergreen Terrace, Austin, TX 78701"
          className={cn(
            "flex-1 bg-transparent px-3 py-4 text-base text-foreground outline-none",
            "placeholder:text-muted-foreground/60",
            "font-sans"
          )}
          disabled={loading}
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
      <p className="mt-3 text-center text-xs text-muted-foreground">
        US addresses only &middot; First look is free &middot; No signup required
      </p>
    </form>
  )
}
