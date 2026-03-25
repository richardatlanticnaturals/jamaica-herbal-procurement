import nodemailer from "nodemailer";

interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

function createTransporter() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    throw new Error(
      "Missing Gmail credentials. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env"
    );
  }

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // STARTTLS
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });
}

export async function sendEmail({
  to,
  subject,
  html,
  attachments,
}: SendEmailParams): Promise<SendEmailResult> {
  try {
    const transporter = createTransporter();

    const mailOptions: nodemailer.SendMailOptions = {
      from: `"Jamaica Herbal" <${GMAIL_USER}>`,
      to,
      subject,
      html,
    };

    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      }));
    }

    const info = await transporter.sendMail(mailOptions);

    console.log(`Email sent to ${to}: ${info.messageId}`);

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown email error";
    console.error(`Failed to send email to ${to}:`, message);

    return {
      success: false,
      error: message,
    };
  }
}
