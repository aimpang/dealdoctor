'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { ActivityIcon, ClockIcon } from 'lucide-react'

interface Stats {
  totalReports: number
  paidReports: number
  reportsThisWeek: number
}

export function LiveCounter() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => {})
  }, [])

  // Show nothing until we have real data — no fake placeholder numbers
  if (!stats || stats.totalReports === 0) return null

  return (
    <div
      className={cn(
        'mx-auto mt-6 flex max-w-md flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-full border bg-background/80 px-4 py-2 text-xs text-muted-foreground backdrop-blur-sm',
        'animate-in fade-in duration-700'
      )}
    >
      <span className="flex items-center gap-1.5">
        <ActivityIcon className="h-3 w-3 text-emerald-500" />
        <span className="font-semibold text-foreground">
          {stats.totalReports.toLocaleString()}
        </span>{' '}
        reports generated
      </span>
      {stats.reportsThisWeek > 0 && (
        <span className="flex items-center gap-1.5">
          <ClockIcon className="h-3 w-3 text-primary" />
          <span className="font-semibold text-foreground">
            {stats.reportsThisWeek.toLocaleString()}
          </span>{' '}
          this week
        </span>
      )}
    </div>
  )
}
