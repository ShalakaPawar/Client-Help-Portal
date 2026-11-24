import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { HistoryService } from './history.service';
import { AuthUser, CurrentUser } from '../common/auth.decorators';

export class HistoryQuery {
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

@Controller('history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: HistoryQuery) {
    return this.history.list(user, q.cursor);
  }

  @Get(':callId')
  detail(@CurrentUser() user: AuthUser, @Param('callId', ParseUUIDPipe) callId: string) {
    return this.history.detail(user, callId);
  }
}
