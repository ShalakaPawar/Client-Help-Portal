// Response shapes returned by the REST API.
import type {
  CallStatus,
  ConsentStatus,
  ErrorCode,
  Outcome,
  ProcessingStatus,
  RecordingStatus,
  RequestStatus,
  Role,
} from './enums';

export interface ApiErrorBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  requestId?: string;
  details?: string[];
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  user: UserDto;
}

export interface HelpRequestDto {
  id: string;
  title: string;
  description: string;
  status: RequestStatus;
  client: Pick<UserDto, 'id' | 'name'>;
  consultant: Pick<UserDto, 'id' | 'name'>;
  activeCallId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordingSummaryDto {
  id: string;
  status: RecordingStatus;
  processingStatus: ProcessingStatus;
  partial: boolean;
  durationMs: number | null;
  lastError: string | null;
}

export interface CallDto {
  id: string;
  requestId: string;
  requestTitle: string;
  status: CallStatus;
  consent: ConsentStatus;
  client: Pick<UserDto, 'id' | 'name'>;
  consultant: Pick<UserDto, 'id' | 'name'>;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  recording: RecordingSummaryDto | null;
}

export interface LiveKitJoinDto {
  call: CallDto;
  livekitUrl: string;
  token: string;
}

export interface TranscriptSegmentDto {
  speakerName: string;
  role: Role;
  startMs: number;
  endMs: number;
  text: string;
}

export interface ActionItemDto {
  owner: Role;
  task: string;
}

export interface SummaryDto {
  overview: string;
  issuesDiscussed: string[];
  resolution: string | null;
  actionItems: ActionItemDto[];
  outcome: Outcome;
  model: string;
}

export interface HistoryDetailDto {
  call: CallDto;
  transcript: TranscriptSegmentDto[] | null;
  summary: SummaryDto | null;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MediaTokenDto {
  url: string;
  expiresAt: string;
}
