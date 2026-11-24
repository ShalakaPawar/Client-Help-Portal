import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RequestStatus, Role } from '@chp/shared';
import { RequestsService } from './requests.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';

export class CreateRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description: string;
}

export class ListRequestsQuery {
  @IsOptional()
  @IsIn(Object.values(RequestStatus))
  status?: RequestStatus;
}

@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Roles(Role.CLIENT)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRequestDto) {
    return this.requests.create(user, dto.title, dto.description);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListRequestsQuery) {
    return this.requests.list(user, q.status);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.get(user, id);
  }

  @Roles(Role.CLIENT)
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.cancel(user, id);
  }

  @Roles(Role.CONSULTANT)
  @Post(':id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.resolve(user, id);
  }

  @Roles(Role.CONSULTANT)
  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.reopen(user, id);
  }
}
