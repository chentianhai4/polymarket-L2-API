export class PolymarketError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "PolymarketError";
    this.details = details;
  }
}

export class RiskBlockedError extends PolymarketError {
  constructor(message, details = undefined) {
    super(message, details);
    this.name = "RiskBlockedError";
  }
}

export class AuthError extends PolymarketError {
  constructor(message, details = undefined) {
    super(message, details);
    this.name = "AuthError";
  }
}

export class ValidationError extends PolymarketError {
  constructor(message, details = undefined) {
    super(message, details);
    this.name = "ValidationError";
  }
}
