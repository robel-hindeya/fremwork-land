import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export interface SendRegistrationOptions {
  to: string;
  name: string;
  dates?: string;
  title?: string;
}

@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private templateCache: string | null = null;

  constructor(private readonly config: ConfigService) {}

  private getApiKey(): string {
    return (
      this.config.get<string>('RESEND_API_KEY') ||
      process.env.RESEND_API_KEY ||
      ''
    );
  }

  private getFromEmail(): string {
    return (
      this.config.get<string>('EMAIL_FROM') ||
      process.env.EMAIL_FROM ||
      'Fremwork Support <support@fremwork.com>'
    );
  }

  get configured(): boolean { return Boolean(this.getApiKey()); }

  /** One message per address: recipients never see each other's email addresses. */
  async sendBatch(messages: { to: string; subject: string; html?: string; text?: string }[], key: string): Promise<void> {
    if (!this.configured) throw new Error('email_not_configured');
    const response = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${this.getApiKey()}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(messages.map((message) => ({ ...message, from: this.getFromEmail(), to: [message.to] }))),
    });
    if (!response.ok) throw new Error(`provider_${response.status}`);
    const result = await response.json() as { data?: { id: string }[] };
    if (!Array.isArray(result.data) || result.data.length !== messages.length || result.data.some((item) => !item.id)) {
      throw new Error('provider_unconfirmed');
    }
  }

  private loadTemplate(): string {
    if (this.templateCache) return this.templateCache;

    const possiblePaths = [
      path.join(__dirname, '../templates/registration-email.html'),
      path.join(__dirname, 'templates/registration-email.html'),
      path.join(process.cwd(), 'src/templates/registration-email.html'),
      path.join(process.cwd(), 'apps/api/src/templates/registration-email.html'),
      path.join(process.cwd(), 'supabase/templates/registration-email.html'),
      '/home/hammerspacecraft/Downloads/Telegram Desktop/fremwork-registration-email.html',
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          this.templateCache = fs.readFileSync(p, 'utf-8');
          return this.templateCache;
        } catch (e) {
          this.log.warn(`Failed reading template at ${p}: ${e}`);
        }
      }
    }

    return '';
  }

  async sendRegistrationEmail(opts: SendRegistrationOptions): Promise<boolean> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.log.warn('RESEND_API_KEY is not set. Skipping registration email.');
      return false;
    }

    const template = this.loadTemplate();
    if (!template) {
      this.log.error('Registration email template could not be loaded.');
      return false;
    }

    const participantName = opts.name || 'Participant';
    const dates = opts.dates || 'Upcoming';

    const html = template
      .replace(/{{\s*participant_name\s*}}/g, participantName)
      .replace(/{{\s*dates\s*}}/g, dates);

    const text = `Welcome ${participantName},\n\nYou are registered for ${opts.title || 'the Fremwork 3-Day Vibe Coding Training'}.\nDates: ${dates}\nDaily time: 09:00–13:40 EAT\n\nGet ready before Day 1:\n- A laptop or desktop and a stable internet connection\n- An AI tool account of your choice and a GitHub account\n- One small project idea you care about\n\nSee you online,\nFremwork Team\nhttps://fremwork.com`;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.getFromEmail(),
          to: [opts.to],
          subject: opts.title ? `You're in — ${opts.title}` : "You're in — Fremwork 3-Day Vibe Coding Training",
          html,
          text,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        this.log.error(`Resend API error (${res.status}): ${body}`);
        return false;
      }

      const data = await res.json();
      this.log.log(`Registration email sent to ${opts.to} (id: ${data.id})`);
      return true;
    } catch (err) {
      this.log.error(`Failed to send email to ${opts.to}: ${err}`);
      return false;
    }
  }

  async sendAlertEmail(opts: { to: string; subject: string; text: string }): Promise<boolean> {
    const apiKey = this.getApiKey();
    if (!apiKey) return false;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.getFromEmail(),
          to: [opts.to],
          subject: opts.subject,
          text: opts.text,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
