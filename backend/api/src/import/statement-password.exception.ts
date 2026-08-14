import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown when a statement PDF is encrypted. Carries a machine-readable `code`
 * so the mobile app can tell "needs a password" apart from "wrong password"
 * and prompt accordingly — instead of showing a dead-end error.
 *
 * 422 (not 400) so it reads as "the file is fine, we just need one more input".
 */
export class StatementPasswordException extends HttpException {
  constructor(incorrect: boolean) {
    super(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        needsPassword: true,
        code: incorrect ? 'PASSWORD_INCORRECT' : 'PASSWORD_REQUIRED',
        message: incorrect
          ? 'That password didn’t unlock the PDF. Please check it and try again.'
          : 'This statement is password-protected. Enter its password to continue.',
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
