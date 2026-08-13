import { LogService } from './logService.ts';
import { dbService } from './dbService.ts';
import { OKX_BLUE } from '../constants/colors.ts';

type MailTransportConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
};

type MailOptions = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

type MailSendResult = {
  messageId?: string;
};

type MailTransporter = {
  sendMail(mailOptions: MailOptions): Promise<MailSendResult>;
};

type NodemailerModule = {
  createTransport(config: MailTransportConfig): MailTransporter;
};

type ResendSuccessResponse = {
  id?: string;
};

type ResendErrorResponse = {
  message?: string;
  error?: string;
  name?: string;
};

export class EmailService {
  private static async loadNodemailer(): Promise<NodemailerModule | null> {
    try {
      const loaded = await import('nodemailer') as NodemailerModule | { default: NodemailerModule };
      return 'default' in loaded ? loaded.default : loaded;
    } catch {
      return null;
    }
  }

  private static getResendApiKey(): string | null {
    const savedKey = dbService.getConfig('resend_api_key')?.trim();
    return savedKey || null;
  }

  private static formatFromAddress(fromEmail: string) {
    const trimmed = fromEmail.trim();
    if (!trimmed) return '"TodoQuant AI" <onboarding@resend.dev>';
    if (trimmed.includes('<') && trimmed.includes('>')) return trimmed;
    return `"TodoQuant AI" <${trimmed}>`;
  }

  private static renderHtml(subject: string, content: string) {
    const normalizedContent = content.replace(/^[\s\uFEFF\xA0]+/u, '');
    return `
      <div style="font-family: sans-serif; padding: 20px; color: #333;">
        <h2 style="color: ${OKX_BLUE};">TodoQuant 策略通知</h2>
        <div style="background: #f4f7f9; padding: 15px; border-radius: 8px;">
          <p><strong>主题:</strong> ${subject}</p>
          <div style="white-space: pre-wrap; font-size: 14px; line-height: 1.6;"><strong>内容:</strong> ${normalizedContent}</div>
        </div>
      </div>
    `;
  }

  private static async getSmtpTransport() {
    const user = (dbService.getConfig('email_user') || '').trim();
    const pass = (dbService.getConfig('email_pass') || '').trim();
    const host = (dbService.getConfig('email_host') || 'smtp.resend.com').trim();
    const portStr = dbService.getConfig('email_port') || '465';
    const port = Number.parseInt(portStr, 10);
    const fromEmail = (dbService.getConfig('email_from') || user || '').trim();

    if (!user || !pass || !fromEmail) {
      return null;
    }

    const nodemailer = await this.loadNodemailer();
    if (!nodemailer) {
      return null;
    }

    return {
      transporter: nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
      }),
      fromEmail
    };
  }

  private static async readResendError(response: Response) {
    try {
      const errorBody = await response.json() as ResendErrorResponse;
      const detail = errorBody.message || errorBody.error || errorBody.name || response.statusText;
      return `Resend API ${response.status}: ${detail}`;
    } catch {
      const text = await response.text();
      return `Resend API ${response.status}: ${text || response.statusText}`;
    }
  }

  private static async sendViaResendApi(to: string, subject: string, content: string) {
    const apiKey = this.getResendApiKey();
    if (!apiKey) {
      throw new Error('未配置 Resend API Key');
    }

    const fromEmail = dbService.getConfig('email_from')?.trim() || 'onboarding@resend.dev';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: this.formatFromAddress(fromEmail),
        to: [to],
        subject,
        text: content,
        html: this.renderHtml(subject, content)
      })
    });

    if (!response.ok) {
      throw new Error(await this.readResendError(response));
    }

    const result = await response.json() as ResendSuccessResponse;
  }

  private static async sendViaSmtp(to: string, subject: string, content: string) {
    const smtp = await this.getSmtpTransport();
    if (!smtp) {
      throw new Error('未配置邮件发送能力，请检查系统设置中的 Resend API Key 或 SMTP 配置');
    }

    const info = await smtp.transporter.sendMail({
      from: `"TodoQuant AI" <${smtp.fromEmail}>`,
      to,
      subject,
      text: content,
      html: this.renderHtml(subject, content)
    });
  }

  public static async sendNotification(to: string, subject: string, content: string) {
    try {
      if (this.getResendApiKey()) {
        await this.sendViaResendApi(to, subject, content);
      } else {
        await this.sendViaSmtp(to, subject, content);
      }

      return true;
    } catch (e: unknown) {
      const error = e as Error;
      console.error('发送邮件失败', error);
      LogService.logKey('system', 'email.send.failed', { msg: error.message }, 'error');
      return false;
    }
  }
}
