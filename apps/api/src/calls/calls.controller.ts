import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { Role } from '@chp/shared';
import { CallsService } from './calls.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';

export class ConsentDto {
  @IsBoolean()
  granted: boolean;
}

export class EndCallDto {
  /** Consultant only: mark the request resolved when ending. */
  @IsOptional()
  @IsBoolean()
  resolved?: boolean;
}

@Controller()
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Roles(Role.CONSULTANT)
  @Post('requests/:id/calls')
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) requestId: string) {
    return this.calls.start(user, requestId);
  }

  @Get('calls/active')
  async active(@CurrentUser() user: AuthUser) {
    return { call: await this.calls.active(user) };
  }

  @Get('calls/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.get(user, id);
  }

  @Roles(Role.CLIENT)
  @Post('calls/:id/join')
  @HttpCode(200)
  join(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.join(user, id);
  }

  @Get('calls/:id/livekit-token')
  token(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.token(user, id);
  }

  @Roles(Role.CLIENT)
  @Post('calls/:id/consent')
  @HttpCode(200)
  consent(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConsentDto) {
    return this.calls.consent(user, id, dto.granted);
  }

  @Roles(Role.CLIENT)
  @Post('calls/:id/recording/stop')
  @HttpCode(200)
  stopRecording(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.stopRecording(user, id);
  }

  @Post('calls/:id/end')
  @HttpCode(200)
  end(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EndCallDto) {
    return this.calls.end(user, id, dto.resolved);
  }
}
