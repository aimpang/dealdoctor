// Normalized address key for cross-report aggregation.
// Uppercase + strip everything non-alphanumeric so minor formatting
// differences don't fragment feedback for the same property.
// e.g., "1324 Bradley Dr, Harrisonburg, VA 22801" → "1324BRADLEYDRHARRISONBURGVA22801"

export function addressKey(address: string): string {
  return (address || '').replace(/[^a-z0-9]/gi, '').toUpperCase()
}
