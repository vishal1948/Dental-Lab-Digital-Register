export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Must be registered LAST in server.js. Express 5 forwards async errors here automatically.
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  const message = status >= 500 ? 'Server error' : err.message;
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message });
  }
  res.status(status).send(message);
};
