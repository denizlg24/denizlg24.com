import { Resend } from "resend";

if (!process.env.RESEND_API_KEY) {
  throw new Error("RESEND_API_KEY is not defined");
}

export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendContactConfirmation({
  to,
  name,
  ticketId,
  message,
}: {
  to: string;
  name: string;
  ticketId: string;
  message: string;
}) {
  try {
    const { data, error } = await resend.emails.send({
      from: "Portfolio Contact <denizgunes@oceaninformatix.com>",
      to: [to],
      subject: `Contact Form Submission Confirmed - Ticket #${ticketId}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Contact Confirmation</title>
          </head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
              <tr>
                <td style="padding: 40px 30px;">
                  <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111111;">
                    Thanks for reaching out!
                  </h1>
                  
                  <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #666666;">
                    Hey ${name},
                  </p>
                  
                  <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #666666;">
                    I've received your message and wanted to send you a quick confirmation. 
                    I'll get back to you as soon as I can!
                  </p>
                  
                  <div style="margin: 32px 0; padding: 20px; background-color: #f8f8f8; border-radius: 8px;">
                    <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #111111;">
                      Your Ticket ID:
                    </p>
                    <p style="margin: 0; font-size: 18px; font-family: 'Courier New', monospace; font-weight: 700; color: #111111;">
                      ${ticketId}
                    </p>
                  </div>
                  
                  <div style="margin: 24px 0; padding: 20px; background-color: #f8f8f8; border-left: 4px solid #111111; border-radius: 4px;">
                    <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #111111;">
                      Your Message:
                    </p>
                    <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #666666;">
                      ${message}
                    </p>
                  </div>
                  
                  <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.6; color: #999999;">
                    If you have any questions or need to reference this submission, 
                    please use the ticket ID above.
                  </p>
                  
                  <hr style="margin: 32px 0; border: none; border-top: 1px solid #e5e5e5;">
                  
                  <p style="margin: 0; font-size: 13px; color: #999999;">
                    This is an automated confirmation email. Please do not reply to this message.
                  </p>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error("Error sending email:", error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (error) {
    console.error("Error sending email:", error);
    return { success: false, error };
  }
}
