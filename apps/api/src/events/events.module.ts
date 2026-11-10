import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, Header, Injectable, Module,
  NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { SupabaseService } from '../supabase/supabase.service';
import { SettingsModule, SettingsService } from '../settings/settings.module';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { AdminOnly } from '../auth/types';
import { toCsv } from '../common/csv';

const TYPES = ['WEBINAR', 'WORKSHOP', 'MEETUP', 'OFFICE HOURS'];

class RegisterDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsEmail({}, { message: 'Enter a valid email, like you@company.com.' }) email?: string;
  @IsOptional() @IsString() @MaxLength(200) company?: string;
  @IsOptional() @IsString() @MaxLength(100) role?: string;
  @IsOptional() @IsString() @MaxLength(100) size?: string;
  @IsOptional() @IsString() @MaxLength(100) heard?: string;
}

class CreateEventDto {
  @IsString() @IsNotEmpty({ message: 'Give the event a title.' }) @MaxLength(200) title: string;
  @IsIn(TYPES) type: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(40) length?: string;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}

class UpdateEventDto {
  @IsOptional() @IsBoolean() published?: boolean;
  @IsOptional() @IsString() @MaxLength(40) length?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @IsIn(TYPES) type?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}

class CheckInDto {
  @IsBoolean() checkedIn: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toEvent = (e: any) => ({
  id: e.id, type: e.type, title: e.title, description: e.description, length: e.length_label,
  whenLabel: e.when_label, startsAt: e.starts_at, location: e.location, capacity: e.capacity, published: e.published,
  registrations: e.event_registrations?.[0]?.count ?? 0,
});
const toReg = (r: any) => ({
  id: r.id, eventId: r.event_id, name: r.name, email: r.email, company: r.company, role: r.role,
  companySize: r.company_size, heardFrom: r.heard_from, checkedIn: r.checked_in, createdAt: r.created_at,
});
const EVENT_COLS = '*, event_registrations(count)';
const REG_COLS = 'id, event_id, name, email, company, role, company_size, heard_from, checked_in, created_at';

@Injectable()
export class EventsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: SettingsService,
    private readonly emailService: EmailService,
  ) {}

  private get db() {
    return this.supabase.db;
  }

  async list(includeDrafts: boolean) {
    let q = this.db.from('events').select(EVENT_COLS).order('sort_order').order('starts_at', { nullsFirst: false }).order('created_at', { ascending: false });
    if (!includeDrafts) q = q.eq('published', true);
    const rows = SupabaseService.check(await q) as any[];
    return rows.map(toEvent).map((e) => (includeDrafts ? e : { ...e, published: undefined, registrations: undefined }));
  }

  async getOne(id: string) {
    const row = SupabaseService.check(await this.db.from('events').select(EVENT_COLS).eq('id', id).maybeSingle());
    if (!row) throw new NotFoundException('That event no longer exists.');
    return toEvent(row);
  }

  async register(eventId: string, dto: RegisterDto) {
    const ev = await this.getOne(eventId);
    if (!ev.published) throw new NotFoundException('That event no longer exists.');
    const { requiredFields } = await this.settings.get();
    const missing = Object.entries(requiredFields).filter(([k, on]) => on && !(dto as Record<string, string | undefined>)[k]?.trim());
    if (missing.length || !dto.name?.trim() || !dto.email?.trim()) {
      throw new BadRequestException('Please fill in the required fields to register.');
    }
    if (ev.registrations >= ev.capacity) throw new ConflictException('This event is full. Try another date.');

    const { data, error } = await this.db
      .from('event_registrations')
      .insert({
        event_id: eventId, name: dto.name.trim(), email: dto.email.trim(), company: dto.company?.trim() || null,
        role: dto.role || null, company_size: dto.size || null, heard_from: dto.heard || null,
      })
      .select('id, event_id, cancel_token')
      .single();
    if (error?.code === '23505') throw new ConflictException('This email is already registered for this event.');
    if (error?.code === 'P0001') throw new ConflictException(error.message); // capacity trigger
    SupabaseService.check({ data, error });

    const dates = ev.whenLabel || (ev.startsAt ? new Date(ev.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Upcoming');
    // Awaited: on Vercel, work left running after the response is sent can be frozen and lost.
    await this.sendConfirmation(data!.id, { to: dto.email.trim(), name: dto.name.trim(), dates, title: ev.title });

    return { id: data!.id, eventId: data!.event_id, cancelToken: data!.cancel_token };
  }

  /**
   * The database trigger also asks the registration-email Edge Function to send this confirmation.
   * Whichever side claims confirmation_sent_at first sends it, so a registrant never gets two.
   * An email problem never fails the registration.
   */
  private async sendConfirmation(regId: number, opts: { to: string; name: string; dates: string; title: string }) {
    if (!this.emailService.configured) return;
    try {
      const claim = await this.db.from('event_registrations')
        .update({ confirmation_sent_at: new Date().toISOString() })
        .eq('id', regId).is('confirmation_sent_at', null).select('id');
      if (!claim.error && !claim.data?.length) return; // already sent by the Edge Function
      const sent = await this.emailService.sendRegistrationEmail({ ...opts, idempotencyKey: `registration-api-${regId}` });
      if (!sent && !claim.error) {
        await this.db.from('event_registrations').update({ confirmation_sent_at: null, confirmation_error: 'api: send failed' }).eq('id', regId);
      }
    } catch {
      /* never block a registration on email */
    }
  }

  async cancel(id: number, token: string) {
    if (!token) throw new BadRequestException('Missing cancel token.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) throw new NotFoundException('Registration not found.');
    const rows = SupabaseService.check(await this.db.from('event_registrations').delete().eq('id', id).eq('cancel_token', token).select('id')) as any[];
    if (!rows.length) throw new NotFoundException('Registration not found.');
    return { ok: true };
  }

  async create(dto: CreateEventDto) {
    const row = SupabaseService.check(
      await this.db
        .from('events')
        .insert({
          title: dto.title.trim(), type: dto.type, description: dto.description ?? '', length_label: dto.length ?? '60 min',
          starts_at: dto.startsAt ?? null, when_label: dto.startsAt ? null : '[DATE] · [TIME]',
          location: dto.location || 'Online', capacity: dto.capacity ?? 100, published: false,
        })
        .select(EVENT_COLS)
        .single(),
    );
    return toEvent(row);
  }

  async update(id: string, dto: UpdateEventDto) {
    const patch: Record<string, unknown> = {};
    if (dto.published !== undefined) patch.published = dto.published;
    if (dto.title !== undefined) patch.title = dto.title.trim();
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.startsAt !== undefined) { patch.starts_at = dto.startsAt; patch.when_label = null; }
    if (dto.length !== undefined) patch.length_label = dto.length || '60 min';
    if (dto.location !== undefined) patch.location = dto.location;
    if (dto.capacity !== undefined) patch.capacity = dto.capacity;
    const row = SupabaseService.check(await this.db.from('events').update(patch).eq('id', id).select(EVENT_COLS).maybeSingle());
    if (!row) throw new NotFoundException('That event no longer exists.');
    return toEvent(row);
  }

  async remove(id: string) {
    const rows = SupabaseService.check(await this.db.from('events').delete().eq('id', id).select('id')) as any[];
    if (!rows.length) throw new NotFoundException('That event no longer exists.');
    return { ok: true };
  }

  async registrations(eventId?: string, q?: string) {
    let query = this.db.from('event_registrations').select(REG_COLS).order('created_at', { ascending: false });
    if (eventId && eventId !== 'all') query = query.eq('event_id', eventId);
    const rows = (SupabaseService.check(await query) as any[]).map(toReg);
    const needle = (q ?? '').toLowerCase();
    return needle ? rows.filter((r) => `${r.name} ${r.email} ${r.company ?? ''}`.toLowerCase().includes(needle)) : rows;
  }

  async checkIn(id: number, checkedIn: boolean) {
    const row = SupabaseService.check(await this.db.from('event_registrations').update({ checked_in: checkedIn }).eq('id', id).select(REG_COLS).maybeSingle());
    if (!row) throw new NotFoundException('Registration not found.');
    return toReg(row);
  }

  async registrationsCsv(eventId?: string, q?: string) {
    const [regs, events] = await Promise.all([this.registrations(eventId, q), this.list(true)]);
    const title = Object.fromEntries(events.map((e) => [e.id, e.title]));
    return toCsv([
      ['Name', 'Email', 'Company', 'Role', 'Company size', 'Heard from', 'Event', 'Checked in'],
      ...regs.map((r) => [r.name, r.email, r.company, r.role, r.companySize, r.heardFrom, title[r.eventId], r.checkedIn ? 'Yes' : 'No']),
    ]);
  }
}

@Controller()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  // ---- Public ----
  @SkipThrottle()
  @Get('events')
  list() {
    return this.events.list(false);
  }

  @Post('events/:id/registrations')
  register(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RegisterDto) {
    return this.events.register(id, dto);
  }

  @Delete('registrations/:id')
  cancel(@Param('id', ParseIntPipe) id: number, @Query('token') token: string) {
    return this.events.cancel(id, token);
  }

  // ---- Admin ----
  @SkipThrottle()
  @Get('admin/events')
  @AdminOnly()
  adminList() {
    return this.events.list(true);
  }

  @SkipThrottle()
  @Post('admin/events')
  @AdminOnly()
  create(@Body() dto: CreateEventDto) {
    return this.events.create(dto);
  }

  @SkipThrottle()
  @Patch('admin/events/:id')
  @AdminOnly()
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEventDto) {
    return this.events.update(id, dto);
  }

  @SkipThrottle()
  @Delete('admin/events/:id')
  @AdminOnly()
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.remove(id);
  }

  @SkipThrottle()
  @Get('admin/registrations')
  @AdminOnly()
  registrations(@Query('eventId') eventId?: string, @Query('q') q?: string) {
    return this.events.registrations(eventId, q);
  }

  @SkipThrottle()
  @Get('admin/registrations/export')
  @AdminOnly()
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="fremwork-registrations.csv"')
  export(@Query('eventId') eventId?: string, @Query('q') q?: string) {
    return this.events.registrationsCsv(eventId, q);
  }

  @SkipThrottle()
  @Patch('admin/registrations/:id')
  @AdminOnly()
  checkIn(@Param('id', ParseIntPipe) id: number, @Body() dto: CheckInDto) {
    return this.events.checkIn(id, dto.checkedIn);
  }
}

@Module({ imports: [SettingsModule, EmailModule], controllers: [EventsController], providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
