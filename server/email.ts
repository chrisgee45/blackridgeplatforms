import { Resend } from "resend";

/**
 * Returns a configured Resend client + fromEmail, or null if RESEND_API_KEY
 * is not set. Used across the codebase wherever we send transactional email.
 *
 * Configure via env:
 *   RESEND_API_KEY=re_xxx
 *   RESEND_FROM_EMAIL=chris@blackridgeplatforms.com
 */
export function getResendClient(): { client: Resend; fromEmail: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return {
    client: new Resend(apiKey),
    fromEmail: process.env.RESEND_FROM_EMAIL || "chris@blackridgeplatforms.com",
  };
}

/**
 * Public URL of the BlackRidge logo for email signatures. Served as a
 * static asset from client/public/blackridge-logo.png.
 */
const SIGNATURE_LOGO_URL = "https://www.blackridgeplatforms.com/blackridge-logo.png";

const GOLD = "#bd8b22";

/** HTML email signature for Chris / BlackRidge Platforms. */
export function buildEmailSignatureHtml(): string {
  const logoCell = SIGNATURE_LOGO_URL
    ? `<td style="vertical-align:middle;padding-right:18px;border-right:1px solid #e5e7eb;">
         <img src="${SIGNATURE_LOGO_URL}" alt="BlackRidge Platforms" width="130" style="display:block;border:0;" />
       </td>`
    : "";
  const detailPad = SIGNATURE_LOGO_URL ? "padding-left:18px;" : "";
  return `
  <table cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;border-top:2px solid ${GOLD};padding-top:16px;font-family:Arial,Helvetica,sans-serif;">
    <tr>
      ${logoCell}
      <td style="vertical-align:middle;${detailPad}">
        <div style="font-size:16px;font-weight:bold;color:#1a1a1a;">Chris Gee</div>
        <div style="font-size:12px;font-weight:bold;color:${GOLD};margin-top:3px;">Founder &amp; CEO &nbsp;|&nbsp; BlackRidge Platforms</div>
        <div style="font-size:12px;color:#555555;margin-top:9px;">(405) 201-5869</div>
        <div style="font-size:12px;margin-top:3px;"><a href="https://blackridgeplatforms.com" style="color:${GOLD};text-decoration:none;">blackridgeplatforms.com</a></div>
        <div style="font-size:12px;margin-top:3px;"><a href="mailto:chris@blackridgeplatforms.com" style="color:#555555;text-decoration:none;">chris@blackridgeplatforms.com</a></div>
        <div style="font-size:10px;color:#9aa0a6;letter-spacing:1.5px;margin-top:10px;">WEBSITES &nbsp;&bull;&nbsp; PORTALS &nbsp;&bull;&nbsp; CRM &nbsp;&bull;&nbsp; AI SYSTEMS</div>
      </td>
    </tr>
  </table>`;
}

/** Plain-text email signature, for the text/* part of the message. */
export function buildEmailSignatureText(): string {
  return [
    "—",
    "Chris Gee",
    "Founder & CEO | BlackRidge Platforms",
    "(405) 201-5869",
    "blackridgeplatforms.com",
    "chris@blackridgeplatforms.com",
    "WEBSITES • PORTALS • CRM • AI SYSTEMS",
  ].join("\n");
}
