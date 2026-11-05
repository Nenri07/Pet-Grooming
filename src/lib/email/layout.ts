/**
 * Email-safe building blocks: table layout, inline styles, system/Georgia
 * fonts, 600px max width, no flex/grid. Every value comes from the theme.
 */
import { EMAIL_COPY, EMAIL_THEME as T } from './theme';

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Display name safe for a From header: no quotes, angle brackets or line breaks. */
export function cleanDisplayName(name: string | undefined | null): string {
  return (name ?? '').replace(/["<>\r\n\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function formatMoney(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  }
}

/** Plain-text version of an HTML email (links kept as "text (url)"). */
export function toPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<div style="display:none[\s\S]*?<\/div>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, '').trim();
      return label && label !== href ? `${label} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|tr|h1|h2|h3|div|table)>/gi, '\n')
    .replace(/<\/td>\s*<td[^>]*>/gi, ': ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

/** Two-column detail rows (label / value). */
export function detailRows(rows: Array<[string, string] | null | false | undefined>): string {
  const cells = rows
    .filter((r): r is [string, string] => Array.isArray(r) && Boolean(r[1]))
    .map(
      ([label, value]) => `<tr>
  <td style="padding:8px 0;border-bottom:1px solid ${T.colors.border};font-family:${T.fonts.body};font-size:13px;color:${T.colors.muted};width:42%;vertical-align:top;">${escapeHtml(label)}</td>
  <td style="padding:8px 0;border-bottom:1px solid ${T.colors.border};font-family:${T.fonts.body};font-size:14px;color:${T.colors.ink};font-weight:600;text-align:right;vertical-align:top;">${escapeHtml(value)}</td>
</tr>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${cells}</table>`;
}

/** Highlighted total line (e.g. "Balance due on the day"). */
export function totalRow(label: string, value: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:12px;background:${T.colors.soft};border-radius:10px;">
<tr>
  <td style="padding:12px 14px;font-family:${T.fonts.body};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${T.colors.brand};font-weight:700;">${escapeHtml(label)}</td>
  <td style="padding:12px 14px;font-family:${T.fonts.body};font-size:18px;color:${T.colors.ink};font-weight:700;text-align:right;">${escapeHtml(value)}</td>
</tr></table>`;
}

/** Bulletproof button (table-based, works in Outlook). */
export function button(href: string, label: string, variant: 'primary' | 'secondary' = 'primary'): string {
  const bg = variant === 'primary' ? T.colors.brand : T.colors.card;
  const fg = variant === 'primary' ? T.colors.brandText : T.colors.brand;
  const border = variant === 'primary' ? T.colors.brand : T.colors.border;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;"><tr>
<td style="border-radius:999px;background:${bg};border:1px solid ${border};">
  <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 22px;font-family:${T.fonts.body};font-size:14px;font-weight:600;color:${fg};text-decoration:none;border-radius:999px;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

export function paragraph(html: string, muted = false): string {
  return `<p style="margin:0 0 14px;font-family:${T.fonts.body};font-size:${muted ? 13 : 15}px;line-height:1.6;color:${muted ? T.colors.muted : T.colors.ink};">${html}</p>`;
}

/**
 * Full email document. `brand` is the name in the header (the groomer's
 * business for client emails, "Pawxis" for platform emails).
 */
export function layout(opts: {
  brand: string;
  heading: string;
  body: string;
  preheader?: string;
  footer?: string;
}): string {
  const brand = escapeHtml(opts.brand);
  const footer = escapeHtml(opts.footer ?? EMAIL_COPY.platformFooter);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:${T.colors.page};">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.colors.page};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${T.width}px;background:${T.colors.card};border:1px solid ${T.colors.border};border-radius:${T.radius}px;">
    <tr><td style="height:5px;background:${T.colors.brand};border-radius:${T.radius}px ${T.radius}px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:24px 28px 8px;font-family:${T.fonts.heading};font-size:20px;font-weight:700;color:${T.colors.ink};">${brand}</td></tr>
    <tr><td style="padding:4px 28px 28px;">
      <h1 style="margin:8px 0 16px;font-family:${T.fonts.heading};font-size:24px;line-height:1.25;font-weight:700;color:${T.colors.ink};">${escapeHtml(opts.heading)}</h1>
      ${opts.body}
    </td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${T.width}px;">
    <tr><td style="padding:16px 8px;text-align:center;font-family:${T.fonts.body};font-size:12px;line-height:1.5;color:${T.colors.faint};">${footer}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
