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

export async function sendNewFeedbackNotification(
  userName: string,
  postTitle: string,
  postType: 'FEATURE_REQUEST' | 'BUG',
  description: string
): Promise<void> {
  const client = getResend();
  if (!client) return;

  const from = process.env.FROM_EMAIL;
  const adminEmail = process.env.FEEDBACK_NOTIFY_EMAIL;
  if (!from || !adminEmail) return;

  const typeLabel = postType === 'FEATURE_REQUEST' ? 'Feature Request' : 'Bug Report';
  const typeEmoji = postType === 'FEATURE_REQUEST' ? '\u{1F4A1}' : '\u{1F41B}';
  const safeTitle = escapeHtml(postTitle);
  const safeName = escapeHtml(userName);
  const safeDesc = escapeHtml(description).replace(/\n/g, '<br>');

  await client.emails.send({
    from,
    to: adminEmail,
    replyTo: process.env.REPLY_TO_EMAIL || from,
    subject: `${typeEmoji} New ${typeLabel}: ${postTitle}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px 40px; text-align: center;">
              <div style="font-size: 36px; margin-bottom: 8px;">${typeEmoji}</div>
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">New ${typeLabel}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 40px;">
              <p style="margin: 0 0 20px; color: #374151; font-size: 15px; line-height: 1.6;">
                <strong>${safeName}</strong> submitted a new ${typeLabel.toLowerCase()}:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0; padding: 16px 20px;">
                    <div style="font-size: 16px; color: #111827; font-weight: 600; margin-bottom: 8px;">${safeTitle}</div>
                    <div style="font-size: 14px; color: #374151; line-height: 1.5;">${safeDesc}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; border-top: 1px solid #f3f4f6;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                Review this feedback in the admin panel.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  });
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
  const typeEmoji = postType === 'FEATURE_REQUEST' ? '\u{1F4A1}' : '\u{1F41B}';
  const safeTitle = escapeHtml(postTitle);

  await client.emails.send({
    from,
    to,
    replyTo: process.env.REPLY_TO_EMAIL || from,
    subject: `${typeEmoji} Your ${typeLabel} has been completed`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px 40px; text-align: center;">
              <div style="font-size: 36px; margin-bottom: 8px;">\u2705</div>
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">Feedback Completed</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px 40px;">
              <p style="margin: 0 0 20px; color: #374151; font-size: 15px; line-height: 1.6;">
                Great news! The team has addressed your ${typeLabel}:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 0 8px 8px 0; padding: 16px 20px;">
                    <div style="font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">${typeEmoji} ${typeLabel}</div>
                    <div style="font-size: 16px; color: #111827; font-weight: 600;">${safeTitle}</div>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
                Thank you for taking the time to share your feedback — it helps us make the product better for everyone.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; border-top: 1px solid #f3f4f6;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                You received this because you submitted feedback. No action needed.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  });
}
