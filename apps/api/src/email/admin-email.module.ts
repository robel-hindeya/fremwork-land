import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, Post, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AdminOnly, CurrentUser, type AuthUser } from '../auth/types';
import { SupabaseService } from '../supabase/supabase.service';
import { EmailModule } from './email.module';
import { EmailService } from './email.service';

export class AdminEmailDto {
  @IsUUID('4') requestId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsEmail({}, { each: true }) emails: string[];
  @IsString() @MinLength(1) @MaxLength(200) subject: string;
  @IsIn(['html', 'text']) format: 'html' | 'text';
  @IsString() @MinLength(1) @MaxLength(100000) body: string;
}

export interface EmailContact { email: string; name: string; sources: string[] }
interface Campaign { id: string; content_hash: string; recipient_count: number; accepted_count: number; status: string; error_code: string | null }

@Injectable()
export class AdminEmailService {
  constructor(private readonly supabase: SupabaseService, private readonly email: EmailService) {}

  private async rows(table: string, columns: string) {
    const rows: Record<string, string | null>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.supabase.db.from(table).select(columns).order('id').range(offset, offset + 999);
      if (error) throw new ServiceUnavailableException('The contact list is unavailable. No email has been sent.');
      const page = data as unknown as Record<string, string | null>[];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }

  async contacts(): Promise<EmailContact[]> {
    const groups = await Promise.all([
      this.rows('profiles', 'email,full_name'), this.rows('waitlist_entries', 'email,name'), this.rows('event_registrations', 'email,name'),
    ]);
    const contacts = new Map<string, EmailContact>();
    groups.forEach((rows, i) => rows.forEach((row) => {
      const address = (row.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return;
      const source = ['Registered user', 'Waitlist', 'Event attendee'][i];
      const existing = contacts.get(address);
      if (existing) { if (!existing.sources.includes(source)) existing.sources.push(source); }
      else contacts.set(address, { email: address, name: row.full_name || row.name || '', sources: [source] });
    }));
    return [...contacts.values()].sort((a, b) => a.email.localeCompare(b.email));
  }

  private result(row: Campaign) {
    return { requestId: row.id, status: row.status, total: row.recipient_count, accepted: row.accepted_count,
      uncertain: Boolean(row.error_code), message: row.status === 'completed'
        ? `${row.accepted_count} emails accepted by the email provider. Inbox delivery is not yet confirmed.`
        : row.status === 'sending' ? 'Sending is in progress. Check status before starting another send.'
        : `Sending stopped after ${row.accepted_count} confirmed acceptances. The last batch may have been accepted. Check provider logs before sending again.` };
  }

  async status(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('Invalid email request ID.');
    const { data, error } = await this.supabase.db.from('admin_email_campaigns').select('*').eq('id', id).maybeSingle();
    if (error) throw new ServiceUnavailableException('Email status is unavailable.');
    if (!data) throw new NotFoundException('This email request has not been recorded. Retry the same request to check safely.');
    return this.result(data as Campaign);
  }

  async send(dto: AdminEmailDto, user: AuthUser) {
    // Validate here too, so direct service calls cannot bypass transport validation.
    const emails = [...new Set((dto.emails || []).map((email) => String(email).trim().toLowerCase()))].sort();
    const subject = typeof dto.subject === 'string' ? dto.subject.trim() : '';
    if (!subject || subject.length > 200 || /[\r\n]/.test(subject) || typeof dto.body !== 'string' || !dto.body.trim()
      || Buffer.byteLength(dto.body, 'utf8') > 100000 || !['html', 'text'].includes(dto.format)
      || !emails.length || emails.length > 1000 || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.requestId)) {
      throw new BadRequestException('Choose 1–1,000 contacts, a subject and a message up to 100 KB.');
    }
    const hash = createHash('sha256').update(JSON.stringify({ emails, subject, body: dto.body, format: dto.format })).digest('hex');
    const { data: prior, error: lookupError } = await this.supabase.db.from('admin_email_campaigns').select('*').eq('id', dto.requestId).maybeSingle();
    if (lookupError) throw new ServiceUnavailableException('Email sending is not ready. Apply the admin email migration first.');
    if (prior) {
      if (prior.content_hash !== hash) throw new ConflictException('This request ID was already used for another message.');
      return this.result(prior as Campaign);
    }
    if (!this.email.configured) throw new ServiceUnavailableException('Email sending is not configured. Set RESEND_API_KEY and verify EMAIL_FROM.');
    const known = new Set((await this.contacts()).map((contact) => contact.email));
    if (emails.some((address) => !known.has(address))) throw new BadRequestException('A recipient is no longer in the contact list. Refresh the list and review again.');
    const campaign = { id: dto.requestId, created_by: user.id, subject, content_hash: hash, recipient_count: emails.length,
      recipients: emails, accepted_count: 0, status: 'sending', error_code: null };
    const { error: insertError } = await this.supabase.db.from('admin_email_campaigns').insert(campaign);
    if (insertError) {
      if (insertError.code === '23505') throw new ConflictException('This send is already being processed. Check its status.');
      throw new ServiceUnavailableException('The email audit could not be saved. No email has been sent.');
    }
    for (let i = 0; i < emails.length; i += 100) {
      try {
        const batch = emails.slice(i, i + 100).map((to) => ({ to, subject, ...(dto.format === 'html' ? { html: dto.body } : { text: dto.body }) }));
        await this.email.sendBatch(batch, `admin-email/${dto.requestId}/${i / 100}`);
        campaign.accepted_count += batch.length;
        const { error } = await this.supabase.db.from('admin_email_campaigns').update({ accepted_count: campaign.accepted_count }).eq('id', campaign.id);
        if (error) throw new Error('audit_update_failed');
        if (i + 100 < emails.length) await new Promise((resolve) => setTimeout(resolve, 600));
      } catch {
        campaign.status = 'failed';
        const { error } = await this.supabase.db.from('admin_email_campaigns').update({ status: 'failed', accepted_count: campaign.accepted_count, error_code: 'provider_or_audit_unconfirmed' }).eq('id', campaign.id);
        if (error) throw new ServiceUnavailableException('Email results could not be recorded. Some messages may have been accepted. Do not start another send; check provider logs.');
        return this.result({ ...campaign, error_code: 'provider_or_audit_unconfirmed' });
      }
    }
    campaign.status = 'completed';
    const { error } = await this.supabase.db.from('admin_email_campaigns').update({ status: 'completed' }).eq('id', campaign.id);
    if (error) throw new ServiceUnavailableException('Messages were accepted but final status could not be saved. Check provider logs before sending again.');
    return this.result(campaign);
  }
}

@Controller('admin/emails')
@AdminOnly()
export class AdminEmailController {
  constructor(private readonly emails: AdminEmailService) {}
  @Get('recipients') recipients() { return this.emails.contacts(); }
  @Get(':id') status(@Param('id') id: string) { return this.emails.status(id); }
  @Post() send(@Body() dto: AdminEmailDto, @CurrentUser() user: AuthUser) { return this.emails.send(dto, user); }
}

@Module({ imports: [EmailModule], providers: [AdminEmailService], controllers: [AdminEmailController] })
export class AdminEmailModule {}
