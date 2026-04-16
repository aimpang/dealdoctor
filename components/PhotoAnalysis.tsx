'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  CameraIcon,
  UploadCloudIcon,
  XIcon,
  LoaderIcon,
  AlertTriangleIcon,
  InfoIcon,
  ShieldAlertIcon,
} from 'lucide-react'

const MAX_IMAGES = 5
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

type Severity = 'low' | 'medium' | 'high'
interface Finding {
  severity: Severity
  category: string
  observation: string
}
interface PhotoResult {
  index: number
  findings: Finding[]
}
interface Findings {
  photos: PhotoResult[]
}

interface Props {
  uuid: string
  initialFindings?: Findings | null
}

const severityStyle: Record<Severity, { text: string; bg: string; border: string; Icon: any }> = {
  low: { text: 'text-muted-foreground', bg: 'bg-muted/40', border: 'border-border', Icon: InfoIcon },
  medium: {
    text: 'text-amber-600',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    Icon: AlertTriangleIcon,
  },
  high: {
    text: 'text-red-600',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    Icon: ShieldAlertIcon,
  },
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

export function PhotoAnalysis({ uuid, initialFindings }: Props) {
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [findings, setFindings] = useState<Findings | null>(initialFindings ?? null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [files])

  const addFiles = (incoming: FileList | File[]) => {
    setError('')
    const arr = Array.from(incoming)
    const valid: File[] = []
    for (const f of arr) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        setError('Only JPEG, PNG, or WebP accepted.')
        continue
      }
      if (f.size > MAX_BYTES) {
        setError(`"${f.name}" is over 10MB.`)
        continue
      }
      valid.push(f)
    }
    setFiles((prev) => {
      const merged = [...prev, ...valid]
      if (merged.length > MAX_IMAGES) {
        setError(`Max ${MAX_IMAGES} photos — extras dropped.`)
      }
      return merged.slice(0, MAX_IMAGES)
    })
  }

  const removeAt = (i: number) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== i))
  }

  const handleAnalyze = async () => {
    if (files.length === 0) return
    setLoading(true)
    setError('')
    try {
      const images = await Promise.all(
        files.map(async (f) => ({
          mimeType: f.type,
          data: await fileToBase64(f),
        }))
      )
      const res = await fetch('/api/photos/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid, images }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Analysis failed')
        return
      }
      setFindings(data)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const totalFindings = findings?.photos.reduce((sum, p) => sum + p.findings.length, 0) ?? 0
  const highCount = findings?.photos.reduce(
    (sum, p) => sum + p.findings.filter((f) => f.severity === 'high').length,
    0
  ) ?? 0

  return (
    <div className="no-print rounded-xl border bg-card p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CameraIcon className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Photo Red-Flag Review</h3>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
          Included
        </span>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        Drop up to {MAX_IMAGES} listing photos. The AI flags observable condition concerns —
        missing shingles, water staining, foundation cracks, and similar. Best with exterior shots
        plus a few interiors.
      </p>

      {/* Drop zone / file input */}
      {!findings && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              if (e.dataTransfer.files) addFiles(e.dataTransfer.files)
            }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            )}
          >
            <UploadCloudIcon className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Drop photos or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              JPEG / PNG / WebP · up to 10MB each · max {MAX_IMAGES}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>

          {previews.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {previews.map((src, i) => (
                <div
                  key={i}
                  className="group relative aspect-square overflow-hidden rounded-lg border"
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    className="absolute right-1 top-1 rounded-full bg-background/80 p-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
                    aria-label="Remove"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button
            onClick={handleAnalyze}
            disabled={files.length === 0 || loading}
            className="mt-4 w-full gap-2 font-bold"
          >
            {loading ? (
              <>
                <LoaderIcon className="h-4 w-4 animate-spin" />
                Analyzing {files.length} photo{files.length === 1 ? '' : 's'}…
              </>
            ) : (
              <>Analyze {files.length || ''} photo{files.length === 1 ? '' : 's'}</>
            )}
          </Button>
        </>
      )}

      {/* Findings */}
      {findings && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border bg-background/50 p-3">
            <p className="text-sm text-foreground">
              <span className="font-bold">{totalFindings}</span>{' '}
              {totalFindings === 1 ? 'concern' : 'concerns'} across {findings.photos.length}{' '}
              photo{findings.photos.length === 1 ? '' : 's'}
              {highCount > 0 && (
                <span className="ml-2 text-red-600">
                  · {highCount} high severity
                </span>
              )}
            </p>
            <button
              onClick={() => {
                setFindings(null)
                setFiles([])
              }}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Review different photos
            </button>
          </div>

          {findings.photos.map((p) => (
            <div key={p.index} className="rounded-lg border p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Photo {p.index + 1}
              </p>
              {p.findings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No visible concerns.</p>
              ) : (
                <ul className="space-y-2">
                  {p.findings.map((f, i) => {
                    const s = severityStyle[f.severity] ?? severityStyle.low
                    return (
                      <li
                        key={i}
                        className={cn('flex items-start gap-2 rounded-md border p-3', s.bg, s.border)}
                      >
                        <s.Icon className={cn('mt-0.5 h-4 w-4 shrink-0', s.text)} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className={cn('text-[10px] font-bold uppercase tracking-wider', s.text)}>
                              {f.severity}
                            </span>
                            <span className="text-[10px] text-muted-foreground">· {f.category}</span>
                          </div>
                          <p className="mt-0.5 text-sm text-foreground">{f.observation}</p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ))}

          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Not a home inspection.</span>{' '}
            AI image review flags only observable concerns from listing photos. It cannot see
            behind walls, test systems, or assess anything not in frame. Always order a licensed
            inspection before closing.
          </p>
        </div>
      )}
    </div>
  )
}
