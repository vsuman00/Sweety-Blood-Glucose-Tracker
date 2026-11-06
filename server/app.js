import express from 'express';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import bcrypt from 'bcrypt';
import { rateLimit } from 'express-rate-limit';
import { today, validDate, ranges, slots } from './dates.js';
const fail = (status, code, message, fields) => Object.assign(new Error(message), {status, code, fields});
const publicUser = user => ({id:user.id, name:user.name, email:user.email});
const readingFields = 'id, reading_date AS date, slot, glucose_value AS value, version';
export function createApp({pool, secret, origin = 'http://127.0.0.1:5173', production = false, now = () => new Date(), authLimit = 30}) {
 if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
 const app = express();
 app.disable('x-powered-by');
 if (production) app.set('trust proxy', 1);
 app.use((req,res,next) => {res.set('X-Content-Type-Options','nosniff'); res.set('Referrer-Policy','same-origin'); next();});
 app.use(express.json({limit:'16kb'}));
 app.use('/api', (req,res,next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return next(fail(400,'INVALID_JSON','Send a JSON object.'));
  res.set('Cache-Control', 'no-store');
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('origin') !== origin) return next(fail(403,'ORIGIN_REJECTED','Please use the application to make this change.'));
  next();
 });
 const Store = connectPg(session);
 const store = new Store({pool, tableName:'sessions', pruneSessionInterval:false});
 app.locals.sessionStore = store;
 app.use(session({store, secret, name:'sweety.sid', resave:false, saveUninitialized:false,
  cookie:{httpOnly:true, sameSite:'lax', secure:production, maxAge:24*60*60*1000}}));
 const authLimiter = rateLimit({windowMs:15*60*1000, limit:authLimit, standardHeaders:'draft-8', legacyHeaders:false,
  handler: (req,res) => res.status(429).json({error:{code:'RATE_LIMIT',message:'Too many attempts. Please try again in 15 minutes.'}})});
 function validateAccount(body, register) {
  const {name,email,password} = body;
  const fields = {};
  if (register && (typeof name !== 'string' || !name.trim() || name.trim().length > 100)) fields.name = 'Enter a name between 1 and 100 characters.';
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fields.email = 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) fields.password = 'Use at least 8 characters and no more than 72 UTF-8 bytes.';
  if (Object.keys(fields).length) throw fail(400,'VALIDATION','Please check the highlighted fields.', fields);
  return {name:name?.trim(), email:email.trim().toLowerCase(), password};
 }
 app.post('/api/auth/register', authLimiter, async (req,res) => {
  const data = validateAccount(req.body, true);
  const hash = await bcrypt.hash(data.password,12);
  const {rows} = await pool.query('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email',[data.name,data.email,hash]);
  res.status(201).json({user:publicUser(rows[0])});
 });
 app.post('/api/auth/login', authLimiter, async (req,res) => {
  const data = validateAccount(req.body,false);
  const {rows} = await pool.query('SELECT * FROM users WHERE email=$1',[data.email]);
  // Perform a hash comparison even for unknown accounts.
  const hash = rows[0]?.password_hash ?? '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxS2VEs3VevYxGxNq1AsTnGEGqC';
  const match = await bcrypt.compare(data.password,hash);
  if (!rows.length || !match) throw fail(401,'CREDENTIALS','Email or password is incorrect.');
  await new Promise((resolve,reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = rows[0].id;
  await new Promise((resolve,reject) => req.session.save(error => error ? reject(error) : resolve()));
  res.json({user:publicUser(rows[0])});
 });
 app.post('/api/auth/logout', (req,res,next) => req.session.destroy(error => {
  if (error) return next(error);
  res.clearCookie('sweety.sid',{httpOnly:true,sameSite:'lax',secure:production}); res.status(204).end();
 }));
 app.use('/api', (req,res,next) => req.session.userId ? next() : next(fail(401,'AUTH_REQUIRED','Please log in to continue.')));
 app.get('/api/auth/me', async (req,res) => {
  const {rows} = await pool.query('SELECT id,name,email FROM users WHERE id=$1',[req.session.userId]);
  if (!rows.length) throw fail(401,'AUTH_REQUIRED','Please log in again.');
  res.json({user:publicUser(rows[0]),today:today(now()),timezone:'Asia/Kolkata'});
 });
 function checkDate(date) {
  if (!validDate(date) || date > today(now())) throw fail(400,'VALIDATION','Choose a valid date from 1900 through today.',{date:'Choose a valid date that is not in the future.'});
  return date;
 }
 function validateReading(body) {
  checkDate(body.date);
  const fields = {};
  if (!slots.includes(body.slot)) fields.slot = 'Choose one of the four meal slots.';
  if (!Number.isInteger(body.value) || body.value < 40 || body.value > 600) fields.value = 'Enter a whole number from 40 to 600 mg/dl.';
  if (Object.keys(fields).length) throw fail(400,'VALIDATION','Please check the highlighted fields.',fields);
 }
 function versionAndId(req) {
  if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id)>2147483647) throw fail(404,'NOT_FOUND','Reading not found.');
  if (!Number.isInteger(req.body.version) || req.body.version < 1) throw fail(400,'VALIDATION','A valid reading version is required.');
 }
 async function missingOrStale(req) {
  const {rowCount} = await pool.query('SELECT id FROM readings WHERE id=$1 AND user_id=$2',[req.params.id,req.session.userId]);
  if (!rowCount) throw fail(404,'NOT_FOUND','Reading not found.');
  throw fail(409,'STALE_VERSION','This reading changed elsewhere. Reload the latest data before trying again.');
 }
 app.get('/api/readings', async (req,res) => {
  checkDate(req.query.date);
  const {rows} = await pool.query(`SELECT ${readingFields} FROM readings WHERE user_id=$1 AND reading_date=$2 ORDER BY array_position($3::text[],slot)`,[req.session.userId,req.query.date,slots]);
  res.json({readings:rows});
 });
 app.post('/api/readings', async (req,res) => {
  validateReading(req.body);
  const {date,slot,value} = req.body;
  const {rows} = await pool.query(`INSERT INTO readings(user_id,reading_date,slot,glucose_value) VALUES($1,$2,$3,$4) RETURNING ${readingFields}`,[req.session.userId,date,slot,value]);
  res.status(201).json({reading:rows[0]});
 });
 app.put('/api/readings/:id', async (req,res) => {
  versionAndId(req); validateReading(req.body);
  const {date,slot,value,version} = req.body;
  const {rows} = await pool.query(`UPDATE readings SET reading_date=$1,slot=$2,glucose_value=$3,version=version+1,updated_at=now() WHERE id=$4 AND user_id=$5 AND version=$6 RETURNING ${readingFields}`,[date,slot,value,req.params.id,req.session.userId,version]);
  if (!rows.length) await missingOrStale(req);
  res.json({reading:rows[0]});
 });
 app.delete('/api/readings/:id', async (req,res) => {
  versionAndId(req);
  const {rowCount} = await pool.query('DELETE FROM readings WHERE id=$1 AND user_id=$2 AND version=$3',[req.params.id,req.session.userId,req.body.version]);
  if (!rowCount) await missingOrStale(req);
  res.status(204).end();
 });
 app.get('/api/reports', async (req,res) => {
  const date = checkDate(req.query.date);
  // One query gives all three summaries and daily rows from one database snapshot.
  const periods = ranges(date);
  const {rows} = await pool.query(`WITH periods AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS p(name text,start date,"end" date))
   SELECT p.name,p.start,p."end",MAX(r.glucose_value) AS highest,MIN(r.glucose_value) AS lowest,
   ROUND(AVG(r.glucose_value),1)::float8 AS average,COUNT(r.id)::integer AS count,
   COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'date',r.reading_date,'slot',r.slot,'value',r.glucose_value,'version',r.version)
   ORDER BY array_position($3::text[],r.slot)) FILTER (WHERE r.id IS NOT NULL AND p.name='daily'),'[]') AS readings
   FROM periods p LEFT JOIN readings r ON r.user_id=$1 AND r.reading_date>=p.start AND r.reading_date<p."end"
   GROUP BY p.name,p.start,p."end"`,[req.session.userId,JSON.stringify(Object.entries(periods).map(([name,[start,end]]) => ({name,start,end}))),slots]);
  res.json(Object.fromEntries(rows.map(({name,...report}) => [name,report])));
 });
 app.use('/api', (req,res,next) => next(fail(404,'NOT_FOUND','Endpoint not found.')));
 app.use(express.static(new URL('../dist',import.meta.url).pathname));
 app.get('/{*path}', (req,res) => res.sendFile(new URL('../dist/index.html',import.meta.url).pathname));
 app.use((error,req,res,next) => {
  if (error.code === '23505') error = error.constraint === 'users_email_key'
   ? fail(409,'EMAIL_EXISTS','An account with this email already exists.')
   : fail(409,'DUPLICATE_SLOT','You already have a reading for this date and slot. Choose another slot or edit that reading.');
  if (error.type === 'entity.parse.failed') error = fail(400,'INVALID_JSON','Send a valid JSON object.');
  if (error.type === 'entity.too.large') error = fail(413,'BODY_TOO_LARGE','Request is too large.');
  if (!error.status) console.error(error);
  res.status(error.status || 500).json({error:{code:error.status ? error.code : 'INTERNAL',message:error.status ? error.message : 'Something went wrong. Please try again.',...(error.fields && {fields:error.fields})}});
 });
 return app;
}
