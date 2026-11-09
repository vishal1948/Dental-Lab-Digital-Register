const deny = (req, res, status, message) =>
  req.xhr ? res.status(status).json({ error: message }) : null;

export const requireLogin = (req, res, next) => {
  if (req.session.user) return next();
  return deny(req, res, 401, 'Login required') ?? res.redirect('/login');
};

export const requireAdmin = (req, res, next) => {
  if (!req.session.user) {
    return deny(req, res, 401, 'Login required') ?? res.redirect('/login');
  }
  if (req.session.user.role !== 'admin') {
    return deny(req, res, 403, 'Admin only') ?? res.status(403).send('Admin only');
  }
  next();
};
