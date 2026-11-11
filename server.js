// Citizen One knowledge base server.
// Content lives in data/articles.json so it can be edited and published without changing UI code.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

// Load environment variables from .env if present
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        process.env[match[1]] = value.trim();
      }
    }
  }
} catch {}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const articlesPath = path.join(__dirname, 'data', 'articles.json');
const legacyPath = path.join(__dirname, 'data', 'kb.json');
const tagsPath = path.join(__dirname, 'data', 'tags.json');
const adminStatePath = path.join(__dirname, 'data', 'admin-state.json');
const commentsPath = path.join(__dirname, 'data', 'comments.json');
const uploadsPath = path.join(PUBLIC, 'uploads');
const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'rajtandel2379@gmail.com';
const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID || '';
const GOOGLE_SITE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const sessions = new Map();
const userSessions = new Map();
const authAttempts = new Map();
const otpEmailAttempts = new Map(); // Rate limit: max 5 OTP requests per 15 min per email

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function allowOtpEmailAttempt(email) {
  const key = String(email || '').toLowerCase().trim();
  const now = Date.now();
  const attempts = (otpEmailAttempts.get(key) || []).filter(val => now - val < 15 * 60 * 1000);
  if (attempts.length >= 5) {
    otpEmailAttempts.set(key, attempts);
    return false;
  }
  attempts.push(now);
  otpEmailAttempts.set(key, attempts);
  return true;
}

async function sendBrevoOtpEmail(email, otp) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.CONTACT_EMAIL || 'noreply@citizen-one.org';
  const senderName = process.env.BREVO_SENDER_NAME || 'Citizen One';

  if (!apiKey) {
    console.warn(`[DEV/TEST OTP] Brevo API key not set. OTP for ${email}: ${otp}`);
    return { ok: true, devMode: true };
  }

  const payload = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email }],
    subject: `Your Citizen One verification code: ${otp}`,
    htmlContent: `
      <div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #dfe7e0; border-radius: 12px;">
        <h2 style="color: #17634a; margin-top: 0;">Citizen One Verification</h2>
        <p>Your 6-digit login verification code is:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #17634a; background: #eef3ee; padding: 12px 18px; border-radius: 8px; display: inline-block; margin: 12px 0;">
          ${otp}
        </div>
        <p style="color: #6d786f; font-size: 13px;">This code will expire in 5 minutes. If you did not request this code, you can safely ignore this email.</p>
      </div>
    `
  };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Brevo API error:', response.status, errorBody);
    throw new Error('Failed to send verification email. Please try again.');
  }

  return { ok: true };
}
const SESSION_TTL = 12 * 60 * 60 * 1000;
const USER_SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const runtimeScope = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'local';
const runtimeDataDir = process.env.CITIZEN_RUNTIME_DATA_DIR || path.join(os.tmpdir(), 'citizen-one-data', runtimeScope);
const runtimeOverrides = new Map();

function isReadOnlyError(error) {
  return ['EROFS', 'EACCES', 'EPERM'].includes(error?.code);
}

function runtimeFile(file) {
  return path.join(runtimeDataDir, path.basename(file));
}

function readJson(file) {
  const override = runtimeOverrides.get(file) || runtimeFile(file);
  try {
    return JSON.parse(fs.readFileSync(override, 'utf8'));
  } catch (error) {
    if (override !== file && error.code === 'ENOENT') return JSON.parse(fs.readFileSync(file, 'utf8'));
    throw error;
  }
}

let cachedAdminState = { guestAccess: false, deletedLegacy: [], updated: '2026-11-04' };

function readAdminState() {
  return cachedAdminState;
}

async function syncAdminState() {
  try {
    const record = await prisma.adminState.findUnique({ where: { key: 'global' } });
    if (record && record.value && typeof record.value === 'object') {
      cachedAdminState = { ...cachedAdminState, ...record.value };
    }
  } catch (error) {
    console.error('syncAdminState error:', error);
  }
}

async function updateAdminState(patch) {
  cachedAdminState = { ...cachedAdminState, ...patch };
  try {
    await prisma.adminState.upsert({
      where: { key: 'global' },
      update: { value: cachedAdminState },
      create: { key: 'global', value: cachedAdminState }
    });
  } catch (error) {
    console.error('updateAdminState error:', error);
  }
  return cachedAdminState;
}

function guestAccessEnabled() {
  return cachedAdminState.guestAccess === true;
}

function canAccessContent(req) {
  return guestAccessEnabled() || Boolean(currentUser(req));
}

function writeJsonAtomic(file, value) {
  const contents = JSON.stringify(value, null, 2) + '\n';
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, contents, 'utf8');
    try { fs.renameSync(temp, file); } catch { fs.copyFileSync(temp, file); fs.unlinkSync(temp); }
    runtimeOverrides.delete(file);
  } catch (error) {
    if (!isReadOnlyError(error)) throw error;
    // Vercel's deployed bundle is read-only. Keep admin changes available to
    // warm function instances by writing to the runtime's writable temp dir.
    fs.mkdirSync(runtimeDataDir, { recursive: true });
    const fallback = runtimeFile(file);
    const fallbackTemp = `${fallback}.${process.pid}.tmp`;
    fs.writeFileSync(fallbackTemp, contents, 'utf8');
    try { fs.renameSync(fallbackTemp, fallback); } catch { fs.copyFileSync(fallbackTemp, fallback); fs.unlinkSync(fallbackTemp); }
    runtimeOverrides.set(file, fallback);
    try { fs.unlinkSync(temp); } catch { /* the deployed filesystem may be read-only */ }
  }
}

function bodyText(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function safeResourceUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // Serverless deployments may not have a writable public directory. Allow
  // only image data URLs produced by the upload endpoint as an inline fallback.
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(raw)) return raw;
  try {
    const url = new URL(raw, SITE_URL);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? raw : '';
  } catch { return ''; }
}

function sanitizeRichText(input) {
  let html = String(input || '').replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|form|textarea|button|meta|link)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  const allowed = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'div']);
  html = html.replace(/<\s*(\/?)\s*([a-z0-9]+)([^>]*)>/gi, (full, closing, tag, attrs) => {
    tag = tag.toLowerCase();
    if (!allowed.has(tag)) return '';
    if (closing) return `</${tag}>`;
    if (tag === 'br' || tag === 'div' || tag === 'p' || tag === 'strong' || tag === 'b' || tag === 'em' || tag === 'i' || tag === 'u' || tag === 'h2' || tag === 'h3' || tag === 'ul' || tag === 'ol' || tag === 'li' || tag === 'blockquote') return `<${tag}>`;
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    const alt = attrs.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    if (tag === 'a') {
      const url = safeResourceUrl(href);
      return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">` : '<span>';
    }
    const image = safeResourceUrl(src);
    return image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">` : '';
  });
  return html.trim();
}

function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function cleanStringArray(value, limit = 40) {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean).slice(0, limit) : [];
}

function cleanArticle(input, existing = null) {
  const title = String(input.title || '').trim().slice(0, 200);
  if (!title) throw new Error('Title is required');
  const id = slugify(input.id || existing?.id || title);
  if (!id) throw new Error('A valid article ID is required');
  const sections = Array.isArray(input.sections) && input.sections.length ? input.sections : [{ heading: 'Report to', body: '', html: '' }];
  return {
    id,
    category: input.category || existing?.category || 'admin-guides',
    categoryLabel: input.categoryLabel || existing?.categoryLabel || 'Admin guides',
    title,
    summary: String(input.summary || '').trim().slice(0, 500),
    locations: cleanStringArray(input.locations),
    categories: cleanStringArray(input.categories),
    tags: cleanStringArray(input.tags),
    status: input.status === 'draft' ? 'draft' : 'published',
    sections: sections.slice(0, 30).map(section => {
      const html = sanitizeRichText(section.html || '');
      const body = String(section.body || bodyText(html)).trim().slice(0, 5000);
      return {
        heading: String(section.heading || 'Untitled section').trim().slice(0, 120),
        body,
        ...(html ? { html } : {}),
        channels: Array.isArray(section.channels) ? section.channels.slice(0, 20).map(channel => ({
          name: String(channel.name || '').trim().slice(0, 120),
          contact: String(channel.contact || '').trim().slice(0, 500),
          ...(safeResourceUrl(channel.url) ? { url: safeResourceUrl(channel.url) } : {})
        })).filter(channel => channel.name || channel.contact) : [],
        steps: cleanStringArray(section.steps, 30),
        checklist: cleanStringArray(section.checklist, 30)
      };
    }),
    ...(Array.isArray(input.sources) ? { sources: input.sources.slice(0, 20) } : existing?.sources ? { sources: existing.sources } : {})
  };
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => part.trim().split('=').map(decodeURIComponent)).filter(pair => pair.length === 2));
}

function currentAdmin(req) {
  const token = parseCookies(req).c1_admin;
  const expires = token && sessions.get(token);
  if (!expires || expires < Date.now()) { if (token) sessions.delete(token); return false; }
  return true;
}

function requestIp(req) {
  const vercelForwarded = String(req.headers['x-vercel-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean).at(-1);
  const proxyHeaders = process.env.TRUST_PROXY === '1' ? [String(req.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean).at(-1), req.headers['x-real-ip']] : [];
  const candidates = [vercelForwarded, ...proxyHeaders, req.socket?.remoteAddress];
  for (const candidate of candidates) {
    const value = String(candidate || '').split(',')[0].trim().replace(/^\[|\]$/g, '');
    if (net.isIP(value)) return value;
  }
  return 'unknown';
}

function currentUser(req) {
  const token = parseCookies(req).c1_user;
  const session = token && userSessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) userSessions.delete(token);
    return null;
  }
  return cachedUsers.get(session.userId) || null;
}

const cachedUsers = new Map();
let cachedArticles = [];

function formatArticleFromDb(doc, catalog) {
  const locationLabels = new Map((catalog?.locations || []).map(tag => [tag.id, tag.label]));
  const categoryLabels = new Map((catalog?.categories || []).map(tag => [tag.id, tag.label]));
  const locations = Array.isArray(doc.locations) ? doc.locations : [];
  const categories = Array.isArray(doc.categories) ? doc.categories : (doc.category ? [doc.category] : []);
  return {
    id: doc.id,
    category: doc.category || 'admin-guides',
    categoryLabel: doc.categoryLabel || categoryLabels.get(categories[0]) || 'Other guides',
    title: doc.title,
    summary: doc.summary || '',
    locations,
    categories,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    status: doc.status === 'draft' ? 'draft' : 'published',
    sections: (doc.sections || []).map(s => ({
      heading: s.heading || 'Untitled section',
      body: s.body || '',
      ...(s.html ? { html: sanitizeRichText(s.html) } : {}),
      steps: Array.isArray(s.steps) ? s.steps : [],
      checklist: Array.isArray(s.checklist) ? s.checklist : [],
      channels: (s.channels || []).map(c => ({
        name: c.name || '',
        contact: c.contact || '',
        ...(c.url ? { url: c.url } : {})
      }))
    })),
    sources: Array.isArray(doc.sources) ? doc.sources : [],
    locationLabels: locations.map(id => locationLabels.get(id) || id),
    categoryLabels: categories.map(id => categoryLabels.get(id) || id),
    source: 'admin'
  };
}

async function syncArticlesCache() {
  try {
    const catalog = readJson(tagsPath);
    const dbArticles = await prisma.article.findMany({
      include: {
        sections: {
          include: { channels: true }
        }
      }
    });
    if (dbArticles.length) {
      cachedArticles = dbArticles.map(doc => formatArticleFromDb(doc, catalog));
    }
  } catch (error) {
    console.error('syncArticlesCache error:', error);
  }
}

async function syncUsersCache() {
  try {
    const users = await prisma.user.findMany({
      include: { ips: true, activities: true }
    });
    cachedUsers.clear();
    for (const u of users) {
      cachedUsers.set(u.id, formatUserRecord(u));
    }
  } catch (error) {
    console.error('syncUsersCache error:', error);
  }
}

function formatUserRecord(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    location: user.location,
    createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
    updatedAt: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : user.updatedAt,
    lastSeenAt: user.lastSeenAt instanceof Date ? user.lastSeenAt.toISOString() : user.lastSeenAt,
    termsAcceptedAt: user.termsAcceptedAt instanceof Date ? user.termsAcceptedAt.toISOString() : user.termsAcceptedAt,
    termsVersion: user.termsVersion,
    ips: (user.ips || []).map(ip => ({
      address: ip.address,
      firstSeenAt: ip.firstSeenAt instanceof Date ? ip.firstSeenAt.toISOString() : ip.firstSeenAt,
      lastSeenAt: ip.lastSeenAt instanceof Date ? ip.lastSeenAt.toISOString() : ip.lastSeenAt
    })),
    activities: (user.activities || []).map(a => ({
      id: a.id,
      type: a.type,
      detail: a.detail,
      ip: a.ip,
      at: a.at instanceof Date ? a.at.toISOString() : a.at
    }))
  };
}

async function readUsers() {
  try {
    const users = await prisma.user.findMany({
      include: { ips: true, activities: true }
    });
    const formatted = users.map(formatUserRecord);
    cachedUsers.clear();
    for (const u of formatted) cachedUsers.set(u.id, u);
    return formatted;
  } catch (error) {
    console.error('readUsers error:', error);
    return Array.from(cachedUsers.values());
  }
}

async function touchUser(user, req) {
  if (!user) return;
  const now = new Date();
  const ip = requestIp(req);
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: now }
    });
    const existingIp = await prisma.userIp.findFirst({
      where: { userId: user.id, address: ip }
    });
    if (existingIp) {
      await prisma.userIp.update({
        where: { id: existingIp.id },
        data: { lastSeenAt: now }
      });
    } else {
      await prisma.userIp.create({
        data: {
          userId: user.id,
          address: ip,
          firstSeenAt: now,
          lastSeenAt: now
        }
      });
    }
    const fresh = await prisma.user.findUnique({
      where: { id: user.id },
      include: { ips: true, activities: true }
    });
    if (fresh) cachedUsers.set(user.id, formatUserRecord(fresh));
  } catch (error) {
    console.error('touchUser error:', error);
  }
}

async function recordActivity(userId, req, type, detail = '') {
  if (!userId) return;
  const now = new Date();
  const ip = requestIp(req);
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: now }
    });
    await prisma.userActivity.create({
      data: {
        id: crypto.randomBytes(8).toString('hex'),
        userId,
        type: String(type).slice(0, 40),
        detail: String(detail).trim().slice(0, 240),
        ip,
        at: now
      }
    });
    const existingIp = await prisma.userIp.findFirst({
      where: { userId, address: ip }
    });
    if (existingIp) {
      await prisma.userIp.update({
        where: { id: existingIp.id },
        data: { lastSeenAt: now }
      });
    } else {
      await prisma.userIp.create({
        data: {
          userId,
          address: ip,
          firstSeenAt: now,
          lastSeenAt: now
        }
      });
    }
    const fresh = await prisma.user.findUnique({
      where: { id: userId },
      include: { ips: true, activities: true }
    });
    if (fresh) cachedUsers.set(userId, formatUserRecord(fresh));
  } catch (error) {
    console.error('recordActivity error:', error);
  }
}

function allowAuthAttempt(req) {
  const key = requestIp(req);
  const now = Date.now();
  const attempts = (authAttempts.get(key) || []).filter(value => now - value < 15 * 60 * 1000);
  if (attempts.length >= 12) { authAttempts.set(key, attempts); return false; }
  attempts.push(now);
  authAttempts.set(key, attempts);
  return true;
}

function accountCookie(token, req, maxAge = null) {
  const secure = process.env.NODE_ENV === 'production' || req.socket?.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? '; Secure' : '';
  return `c1_user=${token}; HttpOnly; SameSite=Strict; Path=/${maxAge === null ? '' : `; Max-Age=${maxAge}`}${secure}`;
}

function publicUser(user) {
  return user ? { id: user.id, name: user.name } : null;
}

async function readCommentStore() {
  try {
    const comments = await prisma.comment.findMany({
      orderBy: { createdAt: 'desc' }
    });
    const locks = await prisma.commentLock.findMany();
    return {
      items: comments.map(c => ({
        id: c.id,
        articleId: c.articleId,
        userId: c.userId,
        name: c.name,
        text: c.text,
        ip: c.ip,
        editedByAdmin: c.editedByAdmin,
        createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
        updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt
      })),
      lockedArticleIds: locks.map(l => l.articleId)
    };
  } catch (error) {
    console.error('readCommentStore error:', error);
    return { items: [], lockedArticleIds: [] };
  }
}

function accountSessionResponse(req, res, user, status = 200) {
  const token = crypto.randomBytes(32).toString('hex');
  userSessions.set(token, { userId: user.id, expires: Date.now() + USER_SESSION_TTL });
  recordActivity(user.id, req, 'sign_in', 'Signed in');
  return send(res, status, { ok: true, user: publicUser(user) }, 'application/json; charset=utf-8', { 'set-cookie': accountCookie(token, req) });
}

async function handleAccount(req, res, pathname) {
  if (pathname === '/api/account/me' && req.method === 'GET') {
    const user = currentUser(req);
    if (user) touchUser(user, req);
    return send(res, 200, { user: publicUser(user) });
  }
  if (pathname === '/api/account/register' && req.method === 'POST') {
    if (!allowAuthAttempt(req)) return send(res, 429, { error: 'Too many attempts. Please try again later.' });
    const input = await readRequestJson(req);
    const name = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const email = String(input.email || '').trim().toLowerCase().slice(0, 254);
    const phone = String(input.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
    const location = String(input.location || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    const phoneDigits = phone.replace(/\D/g, '');
    if (name.length < 2) return send(res, 400, { error: 'Enter your name.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
    if (phoneDigits.length < 7 || phoneDigits.length > 15) return send(res, 400, { error: 'Enter a valid phone number.' });
    if (input.termsAccepted !== true) return send(res, 400, { error: 'Please agree to the Terms and Conditions and Privacy Policy.' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.isVerified) {
      return send(res, 409, { error: 'An account already uses this email. Please request an OTP to log in.' });
    }

    if (!allowOtpEmailAttempt(email)) {
      return send(res, 429, { error: 'Too many OTP requests for this email. Please try again later.' });
    }

    const now = new Date();
    let user = existing;
    if (!user) {
      user = await prisma.user.create({
        data: {
          id: crypto.randomBytes(12).toString('hex'),
          name,
          email,
          phone,
          location,
          isVerified: false,
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now,
          termsAcceptedAt: now,
          termsVersion: '2026-11-06'
        }
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name, phone, location, updatedAt: now }
      });
    }

    // Invalidate any previous active OTPs for this user
    await prisma.emailOtp.deleteMany({ where: { userId: user.id } });

    // Generate 6-digit OTP, expires in 5 minutes
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.emailOtp.create({
      data: {
        userId: user.id,
        email,
        otpHash: hashOtp(otp),
        expiresAt,
        attempts: 0
      }
    });

    try {
      await sendBrevoOtpEmail(email, otp);
    } catch (err) {
      return send(res, 500, { error: err.message || 'Failed to send verification code email.' });
    }

    return send(res, 200, { ok: true, requireOtp: true, email, message: 'Verification code sent to your email.' });
  }

  if (pathname === '/api/account/login' && req.method === 'POST') {
    if (!allowAuthAttempt(req)) return send(res, 429, { error: 'Too many attempts. Please try again later.' });
    const input = await readRequestJson(req);
    const email = String(input.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });

    const user = await prisma.user.findUnique({
      where: { email },
      include: { ips: true, activities: true }
    });
    if (!user) return send(res, 404, { error: 'No account found with this email. Please register first.' });

    if (!allowOtpEmailAttempt(email)) {
      return send(res, 429, { error: 'Too many OTP requests for this email. Please try again later.' });
    }

    // Invalidate previous OTPs
    await prisma.emailOtp.deleteMany({ where: { userId: user.id } });

    // Generate 6-digit OTP, expires in 5 minutes
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.emailOtp.create({
      data: {
        userId: user.id,
        email,
        otpHash: hashOtp(otp),
        expiresAt,
        attempts: 0
      }
    });

    try {
      await sendBrevoOtpEmail(email, otp);
    } catch (err) {
      return send(res, 500, { error: err.message || 'Failed to send verification code email.' });
    }

    return send(res, 200, { ok: true, requireOtp: true, email, message: 'Verification code sent to your email.' });
  }

  if (pathname === '/api/account/verify-otp' && req.method === 'POST') {
    if (!allowAuthAttempt(req)) return send(res, 429, { error: 'Too many attempts. Please try again later.' });
    const input = await readRequestJson(req);
    const email = String(input.email || '').trim().toLowerCase();
    const otp = String(input.otp || '').trim();

    if (!/^\d{6}$/.test(otp)) return send(res, 400, { error: 'Enter a valid 6-digit verification code.' });

    const activeOtp = await prisma.emailOtp.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' }
    });

    if (!activeOtp) {
      return send(res, 400, { error: 'No active verification code found. Please request a new one.' });
    }

    // Check expiration (5 minutes)
    if (new Date() > new Date(activeOtp.expiresAt)) {
      await prisma.emailOtp.delete({ where: { id: activeOtp.id } });
      return send(res, 400, { error: 'Verification code has expired. Please request a new one.' });
    }

    // Rate limit: maximum 5 verification attempts per OTP
    if (activeOtp.attempts >= 5) {
      await prisma.emailOtp.delete({ where: { id: activeOtp.id } });
      return send(res, 429, { error: 'Too many failed attempts. Code invalidated. Please request a new one.' });
    }

    const providedHash = hashOtp(otp);
    if (providedHash !== activeOtp.otpHash) {
      await prisma.emailOtp.update({
        where: { id: activeOtp.id },
        data: { attempts: { increment: 1 } }
      });
      const remaining = 5 - (activeOtp.attempts + 1);
      return send(res, 400, { error: `Invalid verification code. ${remaining} attempts remaining.` });
    }

    // OTP is valid - delete it so it cannot be reused
    await prisma.emailOtp.delete({ where: { id: activeOtp.id } });

    // Mark user as verified
    const user = await prisma.user.update({
      where: { id: activeOtp.userId },
      data: { isVerified: true },
      include: { ips: true, activities: true }
    });

    const formatted = formatUserRecord(user);
    cachedUsers.set(formatted.id, formatted);
    return accountSessionResponse(req, res, formatted, 200);
  }
  if (pathname === '/api/account/logout' && req.method === 'POST') {
    const token = parseCookies(req).c1_user;
    const user = currentUser(req);
    if (user) recordActivity(user.id, req, 'sign_out', 'Signed out');
    if (token) userSessions.delete(token);
    return send(res, 200, { ok: true }, 'application/json; charset=utf-8', { 'set-cookie': accountCookie('', req, 0) });
  }
  if (pathname === '/api/activity' && req.method === 'POST') {
    const user = currentUser(req);
    if (user) {
      const input = await readRequestJson(req);
      const type = ['page_view', 'guide_view', 'search'].includes(input.type) ? input.type : '';
      if (type) recordActivity(user.id, req, type, String(input.detail || '').replace(/[<>]/g, '').slice(0, 240));
    }
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Account route not found' });
}

async function handleComments(req, res, pathname, requestUrl) {
  if (pathname === '/api/comments' && req.method === 'GET') {
    const articleId = String(requestUrl.searchParams.get('articleId') || '');
    const user = currentUser(req);
    if (!guestAccessEnabled() && !user) return send(res, 401, { error: 'A registered account is required to view comments.' });
    if (!findArticle(articleId)) return send(res, 404, { error: 'Guide not found' });
    const store = await readCommentStore();
    if (user) touchUser(user, req);
    const comments = store.items.filter(item => item.articleId === articleId).map(({ id, name, text, createdAt, updatedAt }) => ({ id, name, text, createdAt, updatedAt }));
    return send(res, 200, { comments, locked: store.lockedArticleIds.includes(articleId), user: publicUser(user) });
  }
  if (pathname === '/api/comments' && req.method === 'POST') {
    const user = currentUser(req);
    if (!guestAccessEnabled() && !user) return send(res, 401, { error: 'A registered account is required to comment.' });
    const input = await readRequestJson(req);
    const articleId = String(input.articleId || '').slice(0, 100);
    if (!findArticle(articleId)) return send(res, 404, { error: 'Guide not found' });
    const store = await readCommentStore();
    if (store.lockedArticleIds.includes(articleId)) return send(res, 403, { error: 'Comments are closed for this guide.' });
    const ip = requestIp(req);
    const attempts = (commentAttempts.get(ip) || []).filter(value => Date.now() - value < 60 * 60 * 1000);
    if (attempts.length >= 8) { commentAttempts.set(ip, attempts); return send(res, 429, { error: 'Please wait before posting another comment.' }); }
    const text = String(input.text || '').trim().slice(0, 2000);
    const name = String(user?.name || input.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (name.length < 2) return send(res, 400, { error: 'Enter a name to show with your comment.' });
    if (text.length < 2) return send(res, 400, { error: 'Write a comment before posting.' });
    attempts.push(Date.now());
    commentAttempts.set(ip, attempts);
    const now = new Date();
    const commentId = crypto.randomBytes(12).toString('hex');
    const created = await prisma.comment.create({
      data: {
        id: commentId,
        articleId,
        userId: user?.id || null,
        name,
        text,
        ip,
        createdAt: now,
        updatedAt: now
      }
    });
    if (user) recordActivity(user.id, req, 'comment', `Commented on ${findArticle(articleId)?.title || articleId}`);
    return send(res, 201, { comment: { id: created.id, name: created.name, text: created.text, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() } });
  }
  return send(res, 405, { error: 'Method not allowed' });
}

function passwordMatches(candidate) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

async function readRequestJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 8_000_000) throw new Error('Request too large'); }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON'); }
}

function requireAdmin(req, res) {
  if (!ADMIN_PASSWORD) { send(res, 503, { error: 'Admin is not configured. Set ADMIN_PASSWORD on the server.' }); return false; }
  if (!currentAdmin(req)) { send(res, 401, { error: 'Admin login required' }); return false; }
  return true;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function trackedUrl(value) {
  try {
    const url = new URL(value, SITE_URL);
    if (!/^https?:$/.test(url.protocol)) return value;
    url.searchParams.set('utm_source', 'citizen-one');
    url.searchParams.set('utm_medium', 'knowledge-base');
    url.searchParams.set('utm_campaign', 'guide');
    return url.toString();
  } catch { return value; }
}

function linkify(value, phones = false) {
  const tokens = [];
  const protect = html => { const token = `__C1_TOKEN_${tokens.length}__`; tokens.push(html); return token; };
  let text = escapeHtml(value);
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, email => protect(`<a href="mailto:${email}">${email}</a>`));
  text = text.replace(/(?:https?:\/\/|www\.)[^\s<]+/gi, url => protect(`<a href="${trackedUrl(url.startsWith('www.') ? `https://${url}` : url)}" target="_blank" rel="noreferrer">${url}</a>`));
  text = text.replace(/\b(?:[a-z0-9-]+\.)+(?:gov\.in|nic\.in|in|org|com)(?:\/[^\s<]*)?/gi, domain => protect(`<a href="${trackedUrl(`https://${domain}`)}" target="_blank" rel="noreferrer">${domain}</a>`));
  if (phones) text = text.replace(/(?<![\w])(?:\+?\d[\d\s().-]{2,}\d|\d{3,5})(?![\w])/g, phone => protect(`<a href="tel:${phone.replace(/\D/g, '')}">${phone}</a>`));
  return text.replace(/__C1_TOKEN_(\d+)__/g, (_, index) => tokens[Number(index)]);
}

function articleDate() {
  const value = readAdminState().updated || readJson(legacyPath).updated || new Date().toISOString().slice(0, 10);
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'long' }).format(new Date(`${value}T00:00:00`));
}

function updatedDate() {
  return readAdminState().updated || readJson(legacyPath).updated || new Date().toISOString().slice(0, 10);
}

function contactHref() {
  return CONTACT_EMAIL ? `mailto:${CONTACT_EMAIL}?subject=Citizen%20One%20feedback` : 'mailto:?subject=Citizen%20One%20feedback';
}

function trackingMeta() {
  return `${GA_MEASUREMENT_ID ? `<meta name="ga-measurement-id" content="${escapeHtml(GA_MEASUREMENT_ID)}">` : ''}${GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${escapeHtml(GOOGLE_SITE_VERIFICATION)}">` : ''}`;
}

function legacyArticle(entry) {
  return {
    id: entry.id,
    category: legacyCategory(entry.id),
    categoryLabel: legacyCategoryLabel(entry.id),
    title: entry.title,
    summary: entry.who,
    tags: entry.keywords || [],
    locations: legacyLocations(entry.id),
    categories: legacyCategories(entry.id),
    status: 'published',
    sections: [
      { heading: 'Report to', body: entry.who, channels: entry.channels || [] },
      ...(entry.evidence ? [{ heading: 'Evidence to keep', body: entry.evidence }] : []),
      ...(entry.rightsList ? [{ heading: 'What to know', body: entry.rightsList.join(' ') }] : []),
      ...(entry.escalation && entry.escalation.length ? [{ heading: 'If there is no response', body: entry.escalation.join(' '), steps: entry.escalation }] : [])
    ],
    sources: entry.sources || []
  };
}

function legacyLocations(id) {
  if (id === 'traffic-mumbai' || id === 'bmc') return ['mumbai'];
  if (id === 'traffic-thane' || id === 'tmc') return ['thane'];
  if (id === 'food-safety' || id === 'corruption') return ['mumbai', 'thane', 'pune-beta'];
  return [];
}

function legacyCategories(id) {
  if (id.startsWith('traffic') || id === 'challan-dispute') return ['traffic', 'road-transportation'];
  if (id === 'tmc' || id === 'bmc') return ['municipal-corporation'];
  if (id === 'food-safety') return ['food-drug'];
  if (id === 'railway') return ['railways', 'railways-grievances'];
  if (['consumer', 'bank', 'sebi', 'rera', 'telecom'].includes(id)) return ['consumer-regulatory'];
  if (id === 'corruption') return ['bribe-corruption'];
  if (id === 'emergency' || id === 'rights' || id === 'police-fir' || id === 'cyber') return ['safety-rights'];
  return [];
}

function legacyCategory(id) {
  if (id.startsWith('traffic') || id === 'challan-dispute') return 'traffic-road';
  if (id === 'tmc' || id === 'bmc') return 'civic';
  if (id === 'food-safety') return 'food-safety';
  if (id === 'corruption') return 'corruption';
  if (id === 'emergency' || id === 'rights' || id === 'police-fir' || id === 'cyber') return 'safety-rights';
  return 'other-guides';
}

function legacyCategoryLabel(id) {
  return {
    'traffic-road': 'Traffic / road issues', civic: 'Civic issues', 'food-safety': 'Food issues',
    corruption: 'Bribe / corruption', 'safety-rights': 'Safety & rights', 'other-guides': 'Other guides'
  }[legacyCategory(id)];
}

function loadArticles() {
  if (cachedArticles.length > 0) return cachedArticles;
  const curated = readJson(articlesPath);
  const adminState = readAdminState();
  const deletedLegacy = new Set(adminState.deletedLegacy || []);
  const legacy = readJson(legacyPath).entries
    .filter(entry => !deletedLegacy.has(entry.id) && !curated.some(article => article.id === entry.id))
    .map(legacyArticle);
  const catalog = readJson(tagsPath);
  const locationLabels = new Map(catalog.locations.map(tag => [tag.id, tag.label]));
  const categoryLabels = new Map(catalog.categories.map(tag => [tag.id, tag.label]));
  return [...curated, ...legacy].map(article => {
    const locations = Array.isArray(article.locations) ? article.locations : [];
    const categories = Array.isArray(article.categories) ? article.categories : (article.category ? [article.category] : []);
    return {
      ...article,
      sections: (article.sections || []).map(section => ({ ...section, ...(section.html ? { html: sanitizeRichText(section.html) } : {}) })),
      locations,
      categories,
      locationLabels: locations.map(id => locationLabels.get(id) || id),
      categoryLabels: categories.map(id => categoryLabels.get(id) || id),
      categoryLabel: article.categoryLabel || categoryLabels.get(categories[0]) || 'Other guides'
    };
  });
}

function norm(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function searchArticles(articles, query, filters = {}) {
  if (typeof filters === 'string') filters = { topic: filters };
  const location = norm(filters.location);
  const topic = norm(filters.topic || filters.category);
  const terms = norm(query).split(' ').filter(Boolean);
  return articles
    .filter(article => !location || (article.locations || []).map(norm).includes(location))
    .filter(article => !topic || (article.categories || []).map(norm).includes(topic))
    .map(article => {
      const title = norm(article.title);
      const categoryLabel = norm([article.categoryLabel, ...(article.categoryLabels || [])].join(' '));
      const haystack = norm([
        article.title, article.summary, article.categoryLabel, ...(article.categoryLabels || []), ...(article.locationLabels || []), ...(article.locations || []), ...(article.categories || []), ...(article.tags || []),
        ...(article.sections || []).flatMap(section => [section.heading, section.body, section.html, ...(section.steps || []), ...(section.checklist || [])])
      ].join(' '));
      if (!terms.length) return { article, score: article.status === 'published' ? 2 : 0 };
      const score = terms.reduce((total, term) => {
        if (title.includes(term)) return total + 8;
        if (categoryLabel.includes(term)) return total + 5;
        if ((article.tags || []).some(tag => norm(tag).includes(term))) return total + 4;
        return total + (haystack.includes(term) ? 1 : 0);
      }, 0);
      return { article, score };
    })
    .filter(result => !terms.length || result.score > 0)
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title))
    .map(result => result.article);
}

function siteCss() {
  const source = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const match = source.match(/<style>([\s\S]*?)<\/style>/i);
  return match ? match[1] : '';
}

function renderSteps(items, type = 'ol') {
  if (!items || !items.length) return '';
  const list = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  return `<${type} class="${type === 'ol' ? 'steps' : 'checklist'}">${list}</${type}>`;
}

function renderGuideSections(article) {
  return (article.sections || []).map(section => {
    const channels = (section.channels || []).map(channel => `<div class="channel"><strong>${escapeHtml(channel.name)}</strong><span class="privacy-value">${linkify(channel.contact || '', true)}</span><button type="button" class="copy-button" data-copy="${escapeHtml(channel.contact || '')}">Copy</button></div>`).join('');
    const content = section.html ? `<div class="rich-content">${section.html}</div>` : (section.body ? `<p>${linkify(section.body)}</p>` : '');
    return `<section class="detail-section"><h3>${escapeHtml(section.heading)}</h3>${content}${channels ? `<div class="channels">${channels}</div>` : ''}${renderSteps(section.steps)}${renderSteps(section.checklist, 'ul')}</section>`;
  }).join('');
}

function sharedScript() {
  return `<script>
  (()=>{const root=document.documentElement, key='c1-theme';
  try{const saved=localStorage.getItem(key);if(saved)root.dataset.theme=saved}catch{}
  document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.addEventListener('click',()=>{const next=root.dataset.theme==='dark'?'light':'dark';root.dataset.theme=next;try{localStorage.setItem(key,next)}catch{};document.querySelectorAll('[data-theme-toggle]').forEach(x=>x.setAttribute('aria-pressed',next==='dark'))}));
  document.querySelectorAll('[data-privacy-toggle]').forEach(b=>b.addEventListener('click',()=>{const on=document.body.classList.toggle('privacy-blur');b.setAttribute('aria-pressed',on)}));
  const menu=document.querySelector('#site-nav'), toggle=document.querySelector('.menu-toggle');if(toggle&&menu)toggle.addEventListener('click',()=>{const open=menu.classList.toggle('open');toggle.setAttribute('aria-expanded',open)});
  document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1400)}catch{b.textContent='Copy failed'}}));
  })();</script>`;
}

function renderDocument({ title, description, canonical, body, status = 200 }) {
  const canonicalUrl = `${SITE_URL}${canonical}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonicalUrl)}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta name="theme-color" content="#17634a">${trackingMeta()}<style>${siteCss()}</style></head><body><a class="skip-link" href="#main-content">Skip to content</a><aside class="beta-notice" aria-label="Beta notice"><strong>BETA MODE</strong><span> · Citizen One is under development and is not yet final for public use.</span></aside><div class="shell"><header class="topbar"><a class="brand" href="/" aria-label="Citizen One home"><span class="brand-mark">C1</span><span>Citizen One</span></a><nav id="site-nav" class="site-nav" aria-label="Primary"><a href="/">Guides</a><a href="/about">About</a><a href="/#faq">FAQ</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/admin">Admin</a><button type="button" data-theme-toggle aria-label="Toggle dark mode">◐</button><button type="button" data-privacy-toggle aria-label="Toggle privacy view">◉</button></nav><button class="menu-toggle" type="button" aria-label="Open menu" aria-expanded="false">☰</button></header><main id="main-content">${body}</main><footer class="footer"><span>© ${new Date().getFullYear()} Citizen One · Views expressed are personal.</span><span>Designed, Ideated, and Ran by Raj Tandel.</span><span><a href="/">Guides</a> · <a href="/about">About</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/admin">Admin</a> · <a href="/sitemap.xml">Sitemap</a></span></footer></div><a class="floating-contact" href="${escapeHtml(contactHref())}" aria-label="Contact Citizen One">Contact</a><script src="/account.js"></script>${sharedScript()}</body></html>`;
  return { status, html };
}

function renderGuidePage(article) {
  const firstCategory = article.categoryLabels?.[0] || article.categoryLabel || 'Civic guide';
  const locations = (article.locationLabels || []).join(' · ');
  const body = `<div class="detail standalone-detail"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Guides</a><span>›</span><span>${escapeHtml(firstCategory)}</span><span>›</span><span>${escapeHtml(article.title)}</span></nav><div class="detail-head"><span class="pill ${article.status === 'draft' ? 'draft' : ''}">${escapeHtml(firstCategory)}${article.status === 'draft' ? ' · Draft' : ''}</span><h1>${escapeHtml(article.title)}</h1><p class="detail-summary">${escapeHtml(article.summary)}</p><p class="last-updated">Last updated ${escapeHtml(articleDate())}${locations ? ` · ${escapeHtml(locations)}` : ''}</p></div>${renderGuideSections(article)}<div class="detail-actions"><button type="button" class="copy-button" data-copy="${escapeHtml(`${article.title}\n\n${article.summary}\n\n${(article.sections || []).map(s => `${s.heading}\n${s.body || ''}`).join('\n\n')}`)}">Copy guide</button><button type="button" class="print-button" onclick="window.print()">Print guide</button></div><section class="comments" data-comments-article="${escapeHtml(article.id)}" aria-label="Comments"><h2>Comments</h2><div data-comments-list><p class="loading">Loading comments…</p></div><form data-comment-form><label for="comment-text">Add a comment</label><textarea id="comment-text" name="text" maxlength="2000" required placeholder="Share a useful, respectful comment"></textarea><div class="comment-guest-name"><label for="comment-name">Name shown with your comment</label><input id="comment-name" name="name" maxlength="80" placeholder="Your name" required></div><button class="primary-link" type="submit">Post comment</button><p class="comment-note">Comments are public. Do not include private contact or sensitive information.</p></form></section><p class="back-link"><a href="/">← Back to guides</a></p></div>`;
  return renderDocument({ title: `${article.title} | Citizen One`, description: article.summary, canonical: `/guides/${encodeURIComponent(article.id)}`, body }).html;
}

function renderAboutPage() {
  const body = `<article class="standalone-detail simple-page"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Guides</a><span>›</span><span>About</span></nav><p class="eyebrow">About Citizen One</p><h1>A citizen-led knowledge base for taking action.</h1><p class="detail-summary">This project and website was created, designed and ideated by Raj Tandel. It is inspired by my latest “Right to Information” and “Right to Ask” work, shared on Instagram through the PR account <a href="https://www.instagram.com/raj.tandel33" target="_blank" rel="noreferrer">@raj.tandel33</a>.</p><section class="detail-section"><h2>Recent activities / work carried out</h2><ol class="steps"><li>ATVM Thane Station working again.</li><li>Thane Railway Station food cafeteria unhygiene report, followed by action by FDA / Railway.</li><li>Thane Railway Station ticket-counter overcrowding report.</li><li>Successful reports / challans against multiple no-parking offences.</li><li>MMRC Mumbai Metro Aqua Line temperature-control issues.</li><li>Articles explaining rights as a civilian.</li></ol></section><section class="detail-section"><h2>Contact</h2><p>Any queries, suggestions, feedback or requests for help are welcome.</p><div class="channels"><div class="channel"><strong>Raj Tandel</strong><span><a href="mailto:rajtandel2379@gmail.com">rajtandel2379@gmail.com</a></span></div><div class="channel"><strong>Location</strong><span>Thane</span></div><div class="channel"><strong>Instagram</strong><span><a href="https://www.instagram.com/raj.tandel33" target="_blank" rel="noreferrer">instagram.com/raj.tandel33 ↗</a></span></div></div></section></article>`;
  return renderDocument({ title: 'About Raj Tandel | Citizen One', description: 'About Citizen One, a citizen-led civic reporting and rights knowledge base created by Raj Tandel.', canonical: '/about', body }).html;
}

function renderPrivacyPage() {
  const body = `<article class="standalone-detail simple-page"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Guides</a><span>›</span><span>Privacy</span></nav><p class="eyebrow">Last updated 6 November 2026</p><h1>Privacy policy</h1><p class="detail-summary">This notice explains what Citizen One collects when you browse as a guest, create an account, search, or post a comment, and what it is used for.</p><section class="detail-section"><h2>Who operates this site</h2><p>Citizen One is a civic information project created by Raj Tandel. For privacy questions or requests, contact <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>.</p></section><section class="detail-section"><h2>Information we collect</h2><ul class="checklist"><li><strong>Account:</strong> your name, email address, and phone number when you choose to register; an optional city or area if you provide it; and the date and version of the Terms and Conditions you accept. Location is optional. Registration may be optional when guest access is enabled; when it is off, a registered account is required to view guides.</li><li><strong>Session and activity:</strong> the IP address used to access an account, account sign-in and sign-out, pages or guides viewed, searches submitted, and comments posted. Activity entries include a date and time.</li><li><strong>Comments:</strong> the name shown with the comment, its text, the guide it appears on, and the IP address used to submit it. Comments and display names are public. Registered comments are linked to the account internally.</li><li><strong>Local preferences:</strong> theme, privacy display, cookie choice, and whether the account prompt has already been shown may be stored in your browser.</li><li><strong>Technical request data:</strong> the hosting service may process IP address, request time, and requested page to deliver and protect the site.</li></ul><p>Do not submit Aadhaar, PAN, OTPs, passwords, bank details, or sensitive personal information in a comment. This site does not request them.</p></section><section class="detail-section"><h2>Why we use it</h2><p>Account information enables account sign-in and registered-only access when guest access is disabled. Optional location is available to the administrator as profile information. IP addresses and activity records help the administrator understand account access, maintain site security, and respond to abuse. Comments are displayed with the name you provide and can be edited, removed, or locked by the administrator. Local preferences remember your choices. Optional analytics load only after you accept them and only when an analytics ID is configured.</p></section><section class="detail-section"><h2>Accounts and sign-in</h2><p>Registration asks for your name, email, and mobile number; city or area is optional. Sign-in checks only the email and mobile number provided at registration. It does not send an email or SMS verification code. Anyone who knows both sign-in details may be able to access that account, so keep them private and do not use the account to store sensitive information. You can continue as a guest instead.</p></section><section class="detail-section"><h2>Public comments</h2><p>Comments are visible to visitors. Do not include private information or anything you would not want published. When guest access is enabled, guests may comment using a display name; registered comments are linked to the account. The administrator can edit or delete comments and can close comments on any guide.</p></section><section class="detail-section"><h2>Sharing, storage, and retention</h2><p>Account, activity, and comment data is stored by the site and its hosting provider. We do not sell it or use it for advertising. The administrator can access account details, IP addresses, activity, and moderation records. Data may also be disclosed when required to protect the site, comply with law, or respond to a valid legal request. Account activity is limited to the most recent 500 events and the most recent 30 distinct IP addresses. Account and comment data is kept while needed to operate the service or moderate public discussions; deletion requests can be sent to the contact above. Deleting an account removes its account record and associated comments.</p></section><section class="detail-section"><h2>Your choices</h2><p>When guest access is enabled, you can browse without registering. You can also choose whether to enable optional analytics and ask to access, correct, or delete your account information by emailing the contact above. You may also ask the administrator to remove a comment. The site may retain information that must be kept for security, moderation, or legal reasons.</p></section><section class="detail-section"><h2>Cookies and analytics</h2><p>Essential account sessions use a secure, HttpOnly cookie where HTTPS is available. Theme, privacy view, and cookie choices use browser storage. Optional Google Analytics is disabled unless this deployment configures it and you accept the analytics choice.</p></section><section class="detail-section"><h2>Changes</h2><p>We may update this notice when the site or its data practices change. The latest revision date appears above. Please review this page before creating an account or commenting.</p></section></article>`;
  return renderDocument({ title: 'Privacy policy | Citizen One', description: 'What Citizen One collects for accounts, IP and activity records, comments, local preferences, and analytics.', canonical: '/privacy', body }).html;
}

function renderTermsPage() {
  const body = `<article class="standalone-detail simple-page"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Guides</a><span>›</span><span>Terms and Conditions</span></nav><p class="eyebrow">Last updated 6 November 2026</p><h1>Terms and Conditions</h1><p class="detail-summary">These terms apply when you use Citizen One, create an account, or post a comment.</p><section class="detail-section"><h2>Using Citizen One</h2><p>Citizen One provides general civic information and links to reporting channels. It is an independent project, not a government service, and does not submit complaints on your behalf. Guides are for general information, may be incomplete or out of date, and are not legal advice. Check important details with the responsible authority before acting. For immediate danger in India, contact emergency services at 112.</p></section><section class="detail-section"><h2>Accounts</h2><p>Registration may be optional when guest access is enabled; when it is off, a registered account is required to view guides. Provide your name, email, and mobile number to create an account; city or area is optional. Sign-in checks only your registered email and mobile number and does not send a verification code. Keep those sign-in details private; the account is not suitable for confidential or sensitive information. You may continue as a guest.</p></section><section class="detail-section"><h2>Comments</h2><p>Comments are public. Only post material you have the right to share. Do not post personal contact details, sensitive information, threats, harassment, unlawful content, spam, or content that violates another person’s rights. You remain responsible for what you submit. The administrator may edit or remove comments, restrict comment access, or lock comments on a guide.</p></section><section class="detail-section"><h2>Privacy and moderation</h2><p>By registering, you ask Citizen One to use your name, email, mobile number, and any optional city or area you provide to provide account access as described in the <a href="/privacy">Privacy Policy</a>. Account IP addresses and activity are recorded for account administration and site security. Comment names and text are publicly displayed; IP addresses are retained privately for moderation and security.</p></section><section class="detail-section"><h2>Availability and external sites</h2><p>The site and its content may change or become temporarily unavailable. Links to government and other external websites are provided for convenience; Citizen One does not control or guarantee their content, availability, or policies.</p></section><section class="detail-section"><h2>Contact</h2><p>Questions about these terms, an account, or a comment can be sent to <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>.</p></section></article>`;
  return renderDocument({ title: 'Terms and Conditions | Citizen One', description: 'Terms for using Citizen One, creating an account, and posting public comments.', canonical: '/terms', body }).html;
}

function renderNotFound(pathname) {
  const body = `<article class="standalone-detail simple-page error-page"><p class="eyebrow">404 · Page not found</p><h1>That guide wandered off.</h1><p class="detail-summary">The page at <code>${escapeHtml(pathname)}</code> does not exist or may have moved.</p><p><a class="primary-link" href="/">Return to all guides</a></p></article>`;
  return renderDocument({ title: 'Page not found | Citizen One', description: 'The requested Citizen One page could not be found.', canonical: '/404', body, status: 404 });
}

function sitemapXml(articles) {
  const urls = ['/', '/about', '/privacy', '/terms', ...articles.map(article => `/guides/${encodeURIComponent(article.id)}`)];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${escapeHtml(`${SITE_URL}${url}`)}</loc><lastmod>${escapeHtml(updatedDate())}</lastmod></url>`).join('')}</urlset>`;
}

function adminArticles() {
  const curatedIds = new Set(readJson(articlesPath).map(article => article.id));
  return loadArticles().map(article => ({ ...article, source: curatedIds.has(article.id) ? 'admin' : 'legacy' }));
}

function findArticle(id) {
  return loadArticles().find(article => article.id === id);
}

async function saveAdminArticle(input, requestedId = '') {
  const existing = findArticle(requestedId || input.id || '');
  const article = cleanArticle({ ...input, id: requestedId || input.id || existing?.id }, existing);
  if (requestedId && article.id !== requestedId) throw new Error('Article ID cannot change during edit');

  const existingInDb = await prisma.article.findUnique({ where: { id: article.id } });
  if (existingInDb) {
    await prisma.articleSection.deleteMany({ where: { articleId: article.id } });
    await prisma.article.update({
      where: { id: article.id },
      data: {
        category: article.category,
        categoryLabel: article.categoryLabel,
        title: article.title,
        summary: article.summary,
        locations: article.locations,
        categories: article.categories,
        tags: article.tags,
        status: article.status,
        sources: article.sources || null,
        sections: {
          create: (article.sections || []).map(s => ({
            heading: s.heading,
            body: s.body || '',
            html: s.html || null,
            steps: s.steps || [],
            checklist: s.checklist || [],
            channels: {
              create: (s.channels || []).map(c => ({
                name: c.name || '',
                contact: c.contact || '',
                url: c.url || null
              }))
            }
          }))
        }
      }
    });
  } else {
    await prisma.article.create({
      data: {
        id: article.id,
        category: article.category,
        categoryLabel: article.categoryLabel,
        title: article.title,
        summary: article.summary,
        locations: article.locations,
        categories: article.categories,
        tags: article.tags,
        status: article.status,
        sources: article.sources || null,
        sections: {
          create: (article.sections || []).map(s => ({
            heading: s.heading,
            body: s.body || '',
            html: s.html || null,
            steps: s.steps || [],
            checklist: s.checklist || [],
            channels: {
              create: (s.channels || []).map(c => ({
                name: c.name || '',
                contact: c.contact || '',
                url: c.url || null
              }))
            }
          }))
        }
      }
    });
  }
  await syncArticlesCache();
  return findArticle(article.id);
}

async function deleteAdminArticle(id) {
  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) return false;
  await prisma.article.delete({ where: { id } });
  await syncArticlesCache();
  return true;
}

async function handleAdmin(req, res, pathname) {
  if (pathname === '/api/admin/status' && req.method === 'GET') return send(res, 200, { configured: Boolean(ADMIN_PASSWORD), authenticated: currentAdmin(req), guestAccess: guestAccessEnabled() });
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    if (!ADMIN_PASSWORD) return send(res, 503, { error: 'Admin is not configured. Set ADMIN_PASSWORD on the server.' });
    const input = await readRequestJson(req);
    if (!passwordMatches(input.password)) return send(res, 401, { error: 'Incorrect admin password' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    return send(res, 200, { ok: true }, 'application/json; charset=utf-8', { 'set-cookie': `c1_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}` });
  }
  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    const token = parseCookies(req).c1_admin;
    if (token) sessions.delete(token);
    return send(res, 200, { ok: true }, 'application/json; charset=utf-8', { 'set-cookie': 'c1_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (!pathname.startsWith('/api/admin/')) return false;
  if (!requireAdmin(req, res)) return true;
  if (pathname === '/api/admin/access' && req.method === 'GET') return send(res, 200, { guestAccess: guestAccessEnabled() });
  if (pathname === '/api/admin/access' && req.method === 'PUT') {
    const input = await readRequestJson(req);
    const guestAccess = input.guestAccess === true;
    await updateAdminState({ guestAccess });
    return send(res, 200, { guestAccess });
  }
  if (pathname === '/api/admin/images' && req.method === 'POST') {
    const input = await readRequestJson(req);
    const match = String(input.data || '').match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return send(res, 400, { error: 'Use a PNG, JPG, WebP or GIF image' });
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) return send(res, 413, { error: 'Image must be smaller than 5 MB' });
    const mime = match[1].toLowerCase().replace('image/jpg', 'image/jpeg');
    const extension = mime.replace('image/', '').replace('jpeg', 'jpg');
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
    try {
      fs.mkdirSync(uploadsPath, { recursive: true });
      fs.writeFileSync(path.join(uploadsPath, filename), buffer);
      return send(res, 201, { url: `/uploads/${filename}`, storage: 'file' });
    } catch (error) {
      // Vercel and other serverless runtimes mount the deployed filesystem as
      // read-only. Keep the upload usable by embedding it in the article HTML.
      if (!['EROFS', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      return send(res, 201, { url: `data:${mime};base64,${buffer.toString('base64')}`, storage: 'inline' });
    }
  }
  if (pathname === '/api/admin/users' && req.method === 'GET') {
    const users = (await readUsers()).sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
    return send(res, 200, { users });
  }
  const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(userMatch[1]);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return send(res, 404, { error: 'User not found' });
    await prisma.user.delete({ where: { id } });
    cachedUsers.delete(id);
    for (const [token, session] of userSessions) if (session.userId === id) userSessions.delete(token);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/comments' && req.method === 'GET') {
    const store = await readCommentStore();
    const comments = store.items.map(comment => ({ ...comment, articleTitle: findArticle(comment.articleId)?.title || comment.articleId })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return send(res, 200, { comments, lockedArticleIds: store.lockedArticleIds, articles: adminArticles().map(article => ({ id: article.id, title: article.title })) });
  }
  if (pathname === '/api/admin/comments/lock' && req.method === 'PUT') {
    const input = await readRequestJson(req);
    const articleId = String(input.articleId || '');
    if (!findArticle(articleId)) return send(res, 404, { error: 'Guide not found' });
    if (input.locked === true) {
      await prisma.commentLock.upsert({
        where: { articleId },
        update: {},
        create: { articleId }
      });
    } else {
      await prisma.commentLock.deleteMany({ where: { articleId } });
    }
    const store = await readCommentStore();
    return send(res, 200, { lockedArticleIds: store.lockedArticleIds });
  }
  const commentMatch = pathname.match(/^\/api\/admin\/comments\/([^/]+)$/);
  if (commentMatch) {
    const id = decodeURIComponent(commentMatch[1]);
    const existing = await prisma.comment.findUnique({ where: { id } });
    if (!existing) return send(res, 404, { error: 'Comment not found' });
    if (req.method === 'PUT') {
      const input = await readRequestJson(req);
      const name = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const text = String(input.text || '').trim().slice(0, 2000);
      if (name.length < 2 || text.length < 2) return send(res, 400, { error: 'A name and comment text are required.' });
      const updated = await prisma.comment.update({
        where: { id },
        data: { name, text, editedByAdmin: true, updatedAt: new Date() }
      });
      return send(res, 200, { comment: { id: updated.id, name: updated.name, text: updated.text, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString(), editedByAdmin: true } });
    }
    if (req.method === 'DELETE') {
      await prisma.comment.delete({ where: { id } });
      return send(res, 200, { ok: true });
    }
  }
  if (pathname === '/api/admin/articles' && req.method === 'GET') return send(res, 200, { articles: adminArticles(), locations: readJson(tagsPath).locations, categories: readJson(tagsPath).categories });
  if (pathname === '/api/admin/articles' && req.method === 'POST') {
    const input = await readRequestJson(req);
    const id = slugify(input.id || input.title);
    if (findArticle(id)) return send(res, 409, { error: 'An article with this ID already exists' });
    try { return send(res, 201, { article: await saveAdminArticle(input) }); } catch (error) { return send(res, 400, { error: error.message }); }
  }
  const match = pathname.match(/^\/api\/admin\/articles\/([^/]+)$/);
  if (!match) return send(res, 404, { error: 'Admin route not found' });
  const id = decodeURIComponent(match[1]);
  if (req.method === 'PUT') {
    if (!findArticle(id)) return send(res, 404, { error: 'Article not found' });
    const input = await readRequestJson(req);
    try { return send(res, 200, { article: await saveAdminArticle(input, id) }); } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'DELETE') { const deleted = await deleteAdminArticle(id); return send(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: 'Article not found' }); }
  return send(res, 405, { error: 'Method not allowed' });
}

function renderHomeCard(article) {
  const category = article.categoryLabels?.[0] || article.categoryLabel || 'Other guides';
  const locations = (article.locationLabels || []).slice(0, 2).map(label => `<span class="tag">${escapeHtml(label)}</span>`).join('');
  const tags = (article.tags || []).slice(0, 3).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  return `<article class="card"><div class="card-top"><span class="pill ${article.status === 'draft' ? 'draft' : ''}">${escapeHtml(category)}</span>${article.status === 'draft' ? '<span class="pill draft">Draft</span>' : ''}</div><h3>${escapeHtml(article.title)}</h3><p>${escapeHtml(article.summary)}</p><div class="card-bottom"><div class="tags">${locations}${tags}</div><a class="read" href="/guides/${encodeURIComponent(article.id)}">Read guide →</a></div></article>`;
}

function renderHomePage(params = new URLSearchParams()) {
  const file = path.join(PUBLIC, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const articles = loadArticles();
  const catalog = readJson(tagsPath);
  const count = (field, id) => articles.filter(article => (article[field] || []).includes(id)).length;
  const filterLinks = (items, field, queryKey, allLabel) => `<a class="category active" href="/"><span>${allLabel}</span><span class="count">${articles.length}</span></a>` + items.map(item => `<a class="category" href="/?${queryKey}=${encodeURIComponent(item.id)}"><span>${escapeHtml(item.label)}</span><span class="count">${count(field, item.id)}</span></a>`).join('');
  const visibleArticles = searchArticles(articles, params.get('q') || '', { location: params.get('location') || '', topic: params.get('topic') || '' });
  const cards = visibleArticles.map(renderHomeCard).join('');
  html = html.replace('<div id="cards" class="cards"><p class="loading">Loading guides…</p></div>', `<div id="cards" class="cards">${cards}</div>`);
  html = html.replace('<div class="category-list" id="locations"><div class="loading">Loading…</div></div>', `<div class="category-list" id="locations">${filterLinks(catalog.locations, 'locations', 'location', 'All locations')}</div>`);
  html = html.replace('<div class="category-list" id="categories"><div class="loading">Loading…</div></div>', `<div class="category-list" id="categories">${filterLinks(catalog.categories, 'categories', 'topic', 'All categories')}</div>`);
  html = html.replace('<span id="copyright-year"></span>', String(new Date().getFullYear()));
  html = html.replace('mailto:?subject=Citizen%20One%20feedback', contactHref());
  html = html.replace('<meta name="theme-color" content="#17634a">', `<meta name="theme-color" content="#17634a">${trackingMeta()}`);
  return html;
}

function renderAccessGatePage() {
  const file = path.join(PUBLIC, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const gate = `<main id="main-content"><section class="access-gate" aria-labelledby="access-gate-title"><p class="eyebrow">Registered access</p><h1 id="access-gate-title">Sign in to view Citizen One guides.</h1><p>Registration is required while guest access is turned off. Create an account once, then use your registered email and mobile number to sign in.</p><button type="button" class="primary-link" id="access-account-button">Register or log in</button><p class="access-gate-note">Your registration name is collected once. Login uses only email and mobile number.</p></section></main>`;
  html = html.replace(/<main id="main-content">[\s\S]*?<\/main>/, gate);
  html = html.replace(/<section class="faq"[\s\S]*?<\/section>/, '');
  html = html.replace('<title>Citizen One | Civic reporting guides</title>', '<title>Registered access | Citizen One</title>');
  html = html.replace('</style>', '.access-gate{max-width:720px;margin:100px auto 140px;padding:42px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:var(--shadow)}.access-gate h1{font-size:clamp(34px,5vw,56px);margin-bottom:18px}.access-gate p{max-width:650px;color:var(--muted);font-size:17px}.access-gate .primary-link{display:inline-block;margin-top:12px;background:var(--brand);color:#fff;border-color:var(--brand)}.access-gate-note{font-size:13px!important;margin-top:22px}</style>');
  html = html.replace('<span id="copyright-year"></span>', String(new Date().getFullYear()));
  html = html.replace('mailto:?subject=Citizen%20One%20feedback', contactHref());
  html = html.replace('<meta name="theme-color" content="#17634a">', `<meta name="theme-color" content="#17634a">${trackingMeta()}`);
  const scriptStart = html.indexOf('<script src="/account.js"></script>');
  if (scriptStart >= 0) {
    html = `${html.slice(0, scriptStart)}<script src="/account.js"></script><script>document.getElementById('access-account-button')?.addEventListener('click', () => window.CitizenOneAccount?.open());</script></body></html>`;
  }
  return html;
}

function send(res, code, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function safePublicFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
  const file = path.resolve(PUBLIC, relative);
  return file.startsWith(PUBLIC + path.sep) ? file : null;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon' };

const requestHandler = (req, res) => {
  let requestUrl;
  try { requestUrl = new URL(req.url, SITE_URL); } catch { return send(res, 400, { error: 'Bad request' }); }
  const pathname = requestUrl.pathname;
  if (req.method === 'GET' && pathname === '/robots.txt') {
    return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/admin\nSitemap: ${SITE_URL}/sitemap.xml\n`, 'text/plain; charset=utf-8');
  }
  if (req.method === 'GET' && pathname === '/sitemap.xml') {
    return send(res, 200, sitemapXml(canAccessContent(req) ? loadArticles() : []), 'application/xml; charset=utf-8');
  }
  if (req.method === 'GET' && pathname === '/privacy') {
    return send(res, 200, renderPrivacyPage(), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && pathname === '/terms') {
    return send(res, 200, renderTermsPage(), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && pathname === '/about') {
    if (!canAccessContent(req)) return send(res, 200, renderAccessGatePage(), 'text/html; charset=utf-8');
    const page = renderAboutPage();
    return send(res, 200, page, 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && /^\/(?:guide|article)\//.test(pathname)) {
    const id = decodeURIComponent(pathname.split('/').pop());
    return res.writeHead(301, { location: `/guides/${encodeURIComponent(id)}`, 'cache-control': 'public, max-age=86400' }).end();
  }
  if (req.method === 'GET' && pathname.startsWith('/guides/')) {
    if (!canAccessContent(req)) return send(res, 200, renderAccessGatePage(), 'text/html; charset=utf-8');
    const id = decodeURIComponent(pathname.slice('/guides/'.length));
    const article = loadArticles().find(item => item.id === id);
    if (!article) {
      const page = renderNotFound(pathname);
      return send(res, page.status, page.html, 'text/html; charset=utf-8');
    }
    return send(res, 200, renderGuidePage(article), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && pathname === '/') {
    if (!canAccessContent(req)) return send(res, 200, renderAccessGatePage(), 'text/html; charset=utf-8');
    return send(res, 200, renderHomePage(requestUrl.searchParams), 'text/html; charset=utf-8');
  }
  if (pathname === '/admin' || pathname === '/admin/') {
    const adminFile = path.join(PUBLIC, 'admin.html');
    return fs.readFile(adminFile, (error, data) => error ? send(res, 404, { error: 'Admin page not found' }) : send(res, 200, data, 'text/html; charset=utf-8'));
  }
  if (pathname.startsWith('/api/admin/')) {
    return handleAdmin(req, res, pathname).catch(error => { console.error('admin:', error); send(res, 400, { error: error.message || 'Admin request failed' }); });
  }
  if (pathname.startsWith('/api/account/') || pathname === '/api/activity') {
    return Promise.resolve(handleAccount(req, res, pathname)).catch(error => { console.error('account:', error); send(res, 400, { error: error.message || 'Account request failed' }); });
  }
  if (pathname === '/api/access' && req.method === 'GET') {
    return send(res, 200, { guestAccess: guestAccessEnabled(), authenticated: Boolean(currentUser(req)) });
  }
  if (pathname === '/api/comments') {
    return Promise.resolve(handleComments(req, res, pathname, requestUrl)).catch(error => { console.error('comments:', error); send(res, 400, { error: error.message || 'Comment request failed' }); });
  }
  if (req.method === 'GET' && req.url.startsWith('/api/health')) {
    return send(res, 200, { ok: true, articles: loadArticles().length, updated: updatedDate(), updatedLabel: articleDate(), ai: false });
  }
  if (req.method === 'GET' && (req.url === '/api/kb' || req.url.startsWith('/api/search'))) {
    const url = new URL(req.url, 'http://localhost');
    const user = currentUser(req);
    if (!guestAccessEnabled() && !user) return send(res, 401, { error: 'A registered account is required to access the guides.' });
    const query = url.searchParams.get('q') || '';
    const location = url.searchParams.get('location') || '';
    const topic = url.searchParams.get('topic') || url.searchParams.get('category') || '';
    if (user && (query || location || topic)) {
      const detail = query ? `Searched for: ${query}` : `Filtered guides${location ? ` by ${location}` : ''}${topic ? ` by ${topic}` : ''}`;
      recordActivity(user.id, req, 'search', detail);
    }
    const articles = loadArticles();
    const results = searchArticles(articles, query, { location, topic });
    const catalog = readJson(tagsPath);
    const count = (field, id) => articles.filter(article => (article[field] || []).includes(id)).length;
    const locations = catalog.locations.map(tag => ({ ...tag, count: count('locations', tag.id) }));
    const categories = catalog.categories.map(tag => ({ ...tag, count: count('categories', tag.id) }));
    return send(res, 200, { results, total: results.length, updated: updatedDate(), updatedLabel: articleDate(), locations, categories });
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  const file = safePublicFile(req.url);
  if (!file) {
    const page = renderNotFound(pathname);
    return send(res, page.status, page.html, 'text/html; charset=utf-8');
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      const page = renderNotFound(pathname);
      return send(res, page.status, page.html, 'text/html; charset=utf-8');
    }
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  });
};

const server = http.createServer(requestHandler);

const initDbPromise = Promise.all([syncUsersCache(), syncArticlesCache(), syncAdminState()]).catch(console.error);

if (require.main === module) server.listen(PORT, () => console.log(`Citizen One knowledge base on localhost:${PORT}`));

module.exports = { loadArticles, norm, searchArticles, server, requestHandler, initDbPromise };
