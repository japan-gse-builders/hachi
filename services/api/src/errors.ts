export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    /** A stable code for the app to act on; the message is for people. */
    readonly reason?: string,
  ) {
    super(message);
  }
}
