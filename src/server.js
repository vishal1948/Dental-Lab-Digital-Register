import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import authRoutes from './routes/auth.js';
import { requireLogin } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';
import { masters } from './config/masters.js';
import crudRouter from './routes/crud.js';
import casesRouter from './routes/cases.js';
import doctorRatesRouter from './routes/doctorRates.js';
import challansRouter from './routes/challans.js';
import { lab } from './config/lab.js';
import invoicesRouter from './routes/invoices.js';
import paymentsRouter from './routes/payments.js';
import balancesRouter from './routes/balances.js';
import { inr, dmy, monthLabel, inrBal } from './lib/format.js';
import { palmerDigits } from './lib/teeth.js';
import { todayIST } from './lib/dates.js';

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is missing in .env (run "npm run setup")');
}

const BUILD = 'brick-9';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const PgStore = connectPgSimple(session);
const app = express();

if (isProd) app.set('trust proxy', 1); // needed for secure cookies behind Nginx/Render/Railway

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
Object.assign(app.locals, { lab, inr, dmy, monthLabel, inrBal, palmer: palmerDigits }); // helpers available in every view
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use(
  session({
    store: new PgStore({ pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.get('/health', async (_req, res) => {
  const { rows } = await pool.query('SELECT NOW() AS now');
  res.json({ ok: true, build: BUILD, db_time: rows[0].now });
});

app.use(authRoutes);

app.get('/', requireLogin, (_req, res) => res.redirect('/cases'));

// Case register: page + JSON API
app.use('/api/cases', casesRouter);
app.get('/cases', requireLogin, async (req, res) => {
  const [{ rows: doctors }, { rows: workTypes }] = await Promise.all([
    pool.query('SELECT id, name FROM doctors ORDER BY name'),
    pool.query('SELECT id, name, default_rate FROM work_types ORDER BY name'),
  ]);
  const cfg = { canEdit: req.session.user.role === 'admin', doctors, workTypes, today: todayIST() };
  res.render('cases', { user: req.session.user, active: 'cases', cfg });
});

// Per-doctor rates (mounted before the generic doctors CRUD)
app.use('/api/doctors/:id/rates', doctorRatesRouter);

// Doctors + work types: JSON API (/api/...) and the page (/doctors, /work-types)
for (const m of Object.values(masters)) {
  app.use(m.api, crudRouter(m));
  app.get(m.path, requireLogin, (req, res) => {
    const cfg = {
      title: m.title,
      api: m.api,
      canEdit: req.session.user.role === 'admin',
      hasRates: Boolean(m.hasRates),
      columns: m.columns.map(({ name, label, type, required }) => ({ name, label, type, required })),
    };
    res.render('master', { user: req.session.user, active: m.key, cfg });
  });
}

app.use(challansRouter); // delivery challans: pages + /api/challans
app.use(invoicesRouter); // monthly invoices: pages + /api/invoices
app.use(paymentsRouter); // payments received: page + /api/payments
app.use(balancesRouter); // outstanding balance per doctor

app.use(errorHandler); // keep last

const port = process.env.PORT || 3000;
app.listen(port, (err) => {
  if (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
  console.log(`Running on http://localhost:${port}`);
});
