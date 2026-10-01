import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ACTIVITIES, type Activity } from '../roles/permissions.js';

export class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(60) userId: string;
  @IsString() @IsNotEmpty() @MaxLength(200) password: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() currentPassword: string;
  @IsString() @IsNotEmpty() @MaxLength(200) newPassword: string;
}

export class ActivityDto {
  @IsIn(ACTIVITIES) activity: Activity;
}

export class OtpDto {
  @IsString() @IsNotEmpty() @MaxLength(10) code: string;
}

export class ForgotPasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(60) userId: string;
}

export class ResetPasswordDto {
  @IsString() @IsNotEmpty() token: string;
  @IsString() @IsNotEmpty() @MaxLength(200) newPassword: string;
}
