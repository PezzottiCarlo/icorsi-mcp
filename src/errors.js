// Error types: callers can tell "log in again" and "get a new token" apart from real failures.

export class IcorsiError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, { cause });
    this.name = new.target.name;
    this.code = code;
  }
}

/** The cookie session is gone: a new browser login is needed */
export class SessionExpired extends IcorsiError {}

/** The mobile web service token is missing, expired or revoked */
export class TokenInvalid extends IcorsiError {}

/** A call that could change something on iCorsi was refused before being sent */
export class ReadOnlyViolation extends IcorsiError {}
