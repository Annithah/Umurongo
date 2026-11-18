import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Throw this from a route to answer with a status code and a readable message. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Express 4 does not catch errors from async handlers; this wrapper passes them to the error handler. */
export function h(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export const notFound = (what = 'Not found') => new HttpError(404, what);
