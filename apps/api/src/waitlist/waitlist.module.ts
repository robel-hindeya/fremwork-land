import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Injectable, Logger, Module, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { SupabaseService } from '../supabase/supabase.service';
import { SettingsModule, SettingsService } from '../settings/settings.module';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { AdminOnly } from '../auth/types';
import { toCsv } from '../common/csv';

export const ROLES = ['Business owner', 'Finance officer', 'Analyst', 'Accountant', 'Manager', 'Other'];

class JoinWaitlistDto {
  @IsString() @IsNotEmpty({ message: 'Enter your name.' }) @MaxLength(200) name: string;
  @IsEmail({}, { message: 'Enter a valid email, like you@company.com.' }) @MaxLength(320) email: string;
  @IsOptional() @IsString() @MaxLength(200) company?: string;
  @IsIn(ROLES, { message: 'Pick the role closest to yours.' }) role: string;
}

class InviteDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsInt({ each: true }) ids: number[];
}

interface Row { id: number; name: string; email: string; company: string | null; role: string | null; status: 'waiting' | 'invited' | 'active'; created_at: string }
const toEntry = (r: Row) => ({ id: r.id, name: r.name, email: r.email, company: r.company, role: r.role, status: r.status, createdAt: r.created_at });

@Injectable()
export class WaitlistService {
  private readonly log = new Logger('Waitlist');
  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async join(dto: JoinWaitlistDto) {
    const s = await this.settings.get();
    if (!s.acceptSignups) throw new ForbiddenException('The waitlist is paused right now. Check back soon.');
    const { error } = await this.supabase.db.from('waitlist_entries').insert({
      name: dto.name.trim(),
      email: dto.email.trim(),
      company: s.askCompany ? dto.company?.trim() || null : null,
      role: dto.role,
    });
    // Already on the list: answer the same way so the form does not reveal who signed up.
    if (error && error.code !== '23505') SupabaseService.check({ data: null, error });
    // Awaited (in parallel): on Vercel, work left running after the response is sent can be lost.
    // Email problems never fail the sign-up.
    const mail: Promise<unknown>[] = [];
    if (!error && s.welcomeEmail) {
      mail.push(this.emailService.sendRegistrationEmail({
        to: dto.email.trim(),
        name: dto.name.trim(),
        dates: 'Upcoming',
        title: 'Fremwork Waitlist',
      }));
    }
    if (!error && s.alertInstant && s.notifyEmail) {
      mail.push(this.emailService.sendAlertEmail({
        to: s.notifyEmail,
        subject: `New waitlist signup: ${dto.name.trim().replace(/[\r\n]+/g, ' ')}`,
        text: `${dto.name.trim()} (${dto.email.trim()}) joined the waitlist.`,
      }));
    }
    await Promise.allSettled(mail);
    return { ok: true };
  }

  async list(): Promise<ReturnType<typeof toEntry>[]> {
    const rows = SupabaseService.check(
      await this.supabase.db.from('waitlist_entries').select('id, name, email, company, role, status, created_at').order('created_at', { ascending: false }),
    ) as Row[];
    return rows.map(toEntry);
  }

  /**
   * Sends a Supabase invite email (the link lands on /auth/confirm → /set-password)
   * and marks people as invited. Re-inviting someone already invited resends the email.
   */
  async invite(ids: number[]) {
    const rows = SupabaseService.check(
      await this.supabase.db.from('waitlist_entries').select('id, name, email, company, role, status, created_at').in('id', ids),
    ) as Row[];
    const web = (this.config.get<string>('WEB_URL') ?? 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '');
    let invited = 0;
    const changed: number[] = [];
    for (const r of rows) {
      if (r.status === 'active') continue;
      const { error } = await this.supabase.db.auth.admin.inviteUserByEmail(r.email, {
        redirectTo: `${web}/set-password`,
        data: { full_name: r.name },
      });
      if (error && !/already been registered|already registered/i.test(error.message)) {
        this.log.warn(`Invite to ${r.email} failed: ${error.message}`);
        continue;
      }
      if (r.status === 'waiting') invited++;
      changed.push(r.id);
    }
    if (changed.length) {
      SupabaseService.check(
        await this.supabase.db.from('waitlist_entries').update({ status: 'invited', invited_at: new Date().toISOString() }).in('id', changed).neq('status', 'active'),
      );
    }
    const fresh = SupabaseService.check(
      await this.supabase.db.from('waitlist_entries').select('id, name, email, company, role, status, created_at').in('id', ids),
    ) as Row[];
    return { invited, entries: fresh.map(toEntry) };
  }

  async csv(status?: string, q?: string) {
    const needle = (q ?? '').toLowerCase();
    const rows = (await this.list()).filter((r) => {
      if (status && status !== 'All' && r.status !== status.toLowerCase()) return false;
      return !needle || `${r.name} ${r.email} ${r.company ?? ''} ${r.role ?? ''}`.toLowerCase().includes(needle);
    });
    return toCsv([
      ['Name', 'Email', 'Company', 'Role', 'Joined', 'Status'],
      ...rows.map((r) => [r.name, r.email, r.company, r.role, r.createdAt.slice(0, 10), r.status]),
    ]);
  }
}

@Controller()
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Post('waitlist')
  @HttpCode(201)
  join(@Body() dto: JoinWaitlistDto) {
    return this.waitlist.join(dto);
  }

  @SkipThrottle()
  @Get('admin/waitlist')
  @AdminOnly()
  list() {
    return this.waitlist.list();
  }

  @SkipThrottle()
  @Post('admin/waitlist/invite')
  @AdminOnly()
  invite(@Body() dto: InviteDto) {
    return this.waitlist.invite(dto.ids);
  }

  @SkipThrottle()
  @Get('admin/waitlist/export')
  @AdminOnly()
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="fremwork-waitlist.csv"')
  export(@Query('status') status?: string, @Query('q') q?: string) {
    return this.waitlist.csv(status, q);
  }
}

@Module({ imports: [SettingsModule, EmailModule], controllers: [WaitlistController], providers: [WaitlistService], exports: [WaitlistService] })
export class WaitlistModule {}
