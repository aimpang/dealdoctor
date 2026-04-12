'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { isSaved, saveDeal, removeDeal, SavedDeal } from '@/lib/portfolio'
import { BookmarkIcon, CheckIcon } from 'lucide-react'

interface Props {
  deal: Omit<SavedDeal, 'savedAt'>
}

export function PortfolioButton({ deal }: Props) {
  const [saved, setSaved] = useState(false)

  // Check saved state after hydration so server/client don't disagree
  useEffect(() => {
    setSaved(isSaved(deal.uuid))
  }, [deal.uuid])

  const handleClick = () => {
    if (saved) {
      removeDeal(deal.uuid)
      setSaved(false)
    } else {
      saveDeal({ ...deal, savedAt: new Date().toISOString() })
      setSaved(true)
    }
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
        saved
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
      aria-pressed={saved}
    >
      {saved ? (
        <>
          <CheckIcon className="h-3.5 w-3.5" />
          Saved to Portfolio
        </>
      ) : (
        <>
          <BookmarkIcon className="h-3.5 w-3.5" />
          Save to Portfolio
        </>
      )}
    </button>
  )
}
