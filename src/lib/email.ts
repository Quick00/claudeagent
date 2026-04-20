import { Resend } from 'resend';

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendFeedbackDoneEmail(
  to: string,
  postTitle: string,
  postType: 'FEATURE_REQUEST' | 'BUG'
): Promise<void> {
  const client = getResend();
  if (!client) return;

  const from = process.env.FROM_EMAIL;
  if (!from) return;

  const typeLabel = postType === 'FEATURE_REQUEST' ? 'feature request' : 'bug report';
  const safeTitle = escapeHtml(postTitle);

  await client.emails.send({
    from,
    to,
    replyTo: process.env.REPLY_TO_EMAIL || from,
    subject: 'Your feedback has been completed',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #111;">Your ${typeLabel} has been addressed</h2>
        <p style="color: #333; font-size: 16px; line-height: 1.5;">
          The team has completed your ${typeLabel}: <strong>${safeTitle}</strong>.
        </p>
        <p style="color: #666; font-size: 14px;">
          Thank you for your feedback — it helps us improve the product.
        </p>
      </div>
    `,
  });
}
