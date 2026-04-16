import { RETRIEVE_URL, SUPPORT_EMAIL } from './seo'

interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string
}

const DEFAULT_EMAIL_FROM = 'DealDoctor <onboarding@resend.dev>'
const CONFIGURED_EMAIL_FROM = process.env.EMAIL_FROM?.trim() || ''
const FROM_DEFAULT = CONFIGURED_EMAIL_FROM || DEFAULT_EMAIL_FROM
const REPLY_TO = process.env.EMAIL_REPLY_TO

export async function sendEmail(
  params: SendEmailParams
): Promise<{ sent: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY
  const invalidProductionSender =
    process.env.NODE_ENV === 'production' &&
    (!CONFIGURED_EMAIL_FROM || CONFIGURED_EMAIL_FROM.includes('resend.dev'))

  if (!key) {
    console.warn('[email] RESEND_API_KEY not set - skipping email:', params.subject)
    return { sent: false, error: 'RESEND_API_KEY not configured' }
  }
  if (invalidProductionSender) {
    console.error('[email] EMAIL_FROM must be configured with a verified sender in production')
    return { sent: false, error: 'EMAIL_FROM not configured for production delivery' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_DEFAULT,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
        ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[email] Resend error', res.status, body)
      return { sent: false, error: `Resend ${res.status}` }
    }
    const data = await res.json()
    return { sent: true, id: data?.id }
  } catch (err: any) {
    console.error('[email] Resend fetch failed', err?.message)
    return { sent: false, error: err?.message || 'fetch failed' }
  }
}

export function buildMagicLinkEmail(params: {
  linkExpiryLabel: string
  magicLinkUrl: string
  entitlementDescription: string
  originalReportUrl?: string
}) {
  const { linkExpiryLabel, magicLinkUrl, entitlementDescription, originalReportUrl } = params
  const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#18181b;">
  <div style="font-size:20px;font-weight:700;margin-bottom:24px;">Deal<span style="color:#f97316;">Doctor</span></div>
  <h1 style="font-size:22px;margin:0 0 12px;">Restore your DealDoctor access</h1>
  <p style="font-size:14px;line-height:1.6;color:#52525b;">Click the button below to restore your purchase on this device. This link is unique to you, expires in ${linkExpiryLabel}, and should not be forwarded.</p>
  <p style="margin:24px 0;"><a href="${magicLinkUrl}" style="display:inline-block;background:#f97316;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Restore access</a></p>
  <p style="font-size:13px;color:#71717a;">${entitlementDescription}</p>
  ${originalReportUrl ? `<p style="font-size:13px;color:#71717a;margin-top:16px;">Your original report is at <a href="${originalReportUrl}" style="color:#f97316;">${originalReportUrl}</a></p>` : ''}
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:32px 0 16px;">
  <p style="font-size:11px;color:#a1a1aa;">If you did not request this, just ignore this email. Your current access is unchanged.</p>
</body></html>`
  const text = `Restore your DealDoctor access\n\nThis link expires in ${linkExpiryLabel}.\n\n${magicLinkUrl}\n\n${entitlementDescription}\n\n${originalReportUrl ? `Original report: ${originalReportUrl}` : ''}`
  return { html, text }
}

export function buildPurchaseReceiptEmail(params: {
  plan: 'single' | '5pack' | 'unlimited'
  claimLinkExpiryLabel: string
  reportUrl: string
  magicLinkUrl: string
  address: string
  recoveryCode?: string | null
}) {
  const { plan, claimLinkExpiryLabel, reportUrl, magicLinkUrl, address, recoveryCode } = params
  const planLabel =
    plan === 'single' ? 'Single Report' : plan === '5pack' ? '5-Pack Bundle' : 'Pro Unlimited'
  const entitlement =
    plan === 'single'
      ? 'You have access to this one report.'
      : plan === '5pack'
      ? 'You have 4 more reports available whenever you are ready - they never expire.'
      : 'Unlimited reports for the next 30 days. Renews automatically.'

  const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#18181b;">
  <div style="font-size:20px;font-weight:700;margin-bottom:24px;">Deal<span style="color:#f97316;">Doctor</span></div>
  <h1 style="font-size:22px;margin:0 0 8px;">Your report is ready</h1>
  <p style="font-size:14px;color:#52525b;margin:0 0 24px;">Purchase: <b>${planLabel}</b></p>

  <p style="margin:0 0 8px;font-size:14px;font-weight:600;">${address}</p>
  <p style="margin:0 0 24px;"><a href="${reportUrl}" style="display:inline-block;background:#f97316;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Open your report</a></p>

  <p style="font-size:13px;color:#71717a;">${entitlement}</p>

  <hr style="border:none;border-top:1px solid #e4e4e7;margin:32px 0 16px;">
  <p style="font-size:12px;color:#52525b;line-height:1.6;"><b>Need to open on another device?</b><br>Use this restore link to re-establish your session. It expires in ${claimLinkExpiryLabel}: <a href="${magicLinkUrl}" style="color:#f97316;">Restore access</a></p>
  ${recoveryCode ? `
  <p style="font-size:12px;color:#52525b;line-height:1.6;margin-top:16px;"><b>Lost this email?</b><br>Save this recovery code in a password manager - paste it at <a href="${RETRIEVE_URL}" style="color:#f97316;">${RETRIEVE_URL}</a> on any device to get back in:</p>
  <p style="margin:8px 0 0;padding:12px 16px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;font-family:ui-monospace,monospace;font-size:15px;font-weight:700;letter-spacing:1px;color:#713f12;text-align:center;">${recoveryCode}</p>
  ` : ''}
  <p style="font-size:11px;color:#a1a1aa;margin-top:24px;">Questions or refunds within 7 days? Reply to this email or contact ${SUPPORT_EMAIL}.</p>
</body></html>`
  const text = `Your DealDoctor report is ready\n\n${planLabel} - ${address}\n\nOpen: ${reportUrl}\n\n${entitlement}\n\nRestore access on another device (expires in ${claimLinkExpiryLabel}): ${magicLinkUrl}${recoveryCode ? `\n\nLost this email? Recovery code: ${recoveryCode}\n(Paste at /retrieve on any device)` : ''}`
  return { html, text }
}
