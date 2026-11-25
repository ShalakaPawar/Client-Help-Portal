import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Role } from '@chp/shared';
import { Roles } from '../common/auth.decorators';
import { AdminService } from './admin.service';

export class CreateConsultantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(200)
  password: string;
}

export class AssignConsultantDto {
  /** null = unassign (the client then waits for a consultant). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  consultantId: string | null;
}

/** Admin only: manage consultants and client assignments. No access to calls or history. */
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('consultants')
  consultants() {
    return this.admin.consultants();
  }

  @Post('consultants')
  createConsultant(@Body() dto: CreateConsultantDto) {
    return this.admin.createConsultant(dto.name, dto.email, dto.password);
  }

  @Post('consultants/:id/default')
  @HttpCode(200)
  setDefault(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setDefaultConsultant(id);
  }

  @Get('clients')
  clients() {
    return this.admin.clients();
  }

  @Post('clients/:id/consultant')
  @HttpCode(200)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignConsultantDto) {
    return this.admin.assignConsultant(id, dto.consultantId ?? null);
  }
}
