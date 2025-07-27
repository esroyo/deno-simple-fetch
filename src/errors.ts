export class UnexpectedEofError extends Error {
  constructor(message = "unexpected eof") {
    super(message);
    this.name = "UnexpectedEofError";
  }
}

export class ConnectionClosedError extends Error {
  constructor(message = "connection closed") {
    super(message);
    this.name = "ConnectionClosedError";
  }
}
