import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SupabaseModule } from './supabase/supabase.module';
import { HealthController } from './health.controller';
import { MeController } from './auth/me.controller';
import { WaitlistModule } from './waitlist/waitlist.module';
import { EventsModule } from './events/events.module';
import { SettingsModule } from './settings/settings.module';
import { TeamModule } from './team/team.module';
import { OverviewModule } from './overview/overview.module';
import { VisitorsModule } from './visitors/visitors.module';
import { AdminEmailModule } from './email/admin-email.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Public forms (waitlist, registrations) are rate limited: 30 requests a minute per IP.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    SupabaseModule,
    EmailModule,
    AdminEmailModule,
    SettingsModule,
    WaitlistModule,
    EventsModule,
    TeamModule,
    OverviewModule,
    VisitorsModule,
  ],
  controllers: [HealthController, MeController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
