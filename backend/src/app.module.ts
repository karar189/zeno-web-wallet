import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration.js';
import { HealthModule } from './modules/health/health.module.js';
import { PrivacyModule } from './modules/privacy/privacy.module.js';
import { ProvidersModule } from './modules/providers/providers.module.js';
import { QuotesModule } from './modules/quotes/quotes.module.js';
import { RoutingModule } from './modules/routing/routing.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ProvidersModule,
    RoutingModule,
    QuotesModule,
    PrivacyModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
