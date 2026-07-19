export class UserFacingError extends Error {
  constructor(
    public readonly publicMessage: string,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options);
    this.name = "UserFacingError";
  }
}
