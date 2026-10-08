// Main Application Server
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const dotenv = require('dotenv');

dotenv.config();

const { checkUser } = require('./middleware/auth');
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');
const { SITE_NAME, TAGLINE, NAV_MENU, EDITORIAL_BOARD, CONTACT, AFFILIATE_DISCLOSURE } = require('./config/constants');
const db = require('./config/database');
const { generateSeoMeta } = require('./middleware/seo');
const { 
  toBengaliNumber, 
  formatBengaliDate, 
  formatDuration, 
  formatCardExcerpt, 
  renderArticleContent, 
  generateTableOfContents,
  calculateReadingTime 
} = require('./middleware/banglaDate');

const app = express();
const PORT = process.env.PORT || 3000;

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
try {
  const compression = require('compression');
  app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    }
  }));
} catch (e) {
  console.warn('Compression package not loaded, continuing without it:', e.message);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'payasti-session-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// Static files (ETag enabled for instant freshness checks, no stale caching)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// Dynamic routes: Never cache HTML pages so updates and new posts are immediately visible
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Global User / Auth state
app.use(checkUser);

// Attach helpers to app.locals for universal access in all views and sub-partials
app.locals.toBengaliNumber = toBengaliNumber;
app.locals.formatBengaliDate = formatBengaliDate;
app.locals.formatDuration = formatDuration;
app.locals.formatCardExcerpt = formatCardExcerpt;
app.locals.renderArticleContent = renderArticleContent;
app.locals.generateTableOfContents = generateTableOfContents;
app.locals.calculateReadingTime = calculateReadingTime;
app.locals.SITE_NAME = SITE_NAME;
app.locals.TAGLINE = TAGLINE;
app.locals.AFFILIATE_DISCLOSURE = AFFILIATE_DISCLOSURE;

const { getNavMenu } = require('./services/menuService');
const { getSiteSettings } = require('./services/settingsService');

// Global view variables
app.use(async (req, res, next) => {
  res.locals.currentPath = req.path;
  let siteSettings = {};
  try {
    siteSettings = await getSiteSettings();
  } catch (e) {
    siteSettings = {};
  }

  res.locals.siteSettings = siteSettings;
  res.locals.SITE_NAME = siteSettings.site_title || SITE_NAME;
  res.locals.TAGLINE = siteSettings.site_tagline || TAGLINE;
  res.locals.SITE_LOGO = siteSettings.site_logo || null;
  res.locals.SITE_FAVICON = siteSettings.site_favicon || null;

  try {
    res.locals.navMenu = await getNavMenu();
  } catch (err) {
    res.locals.navMenu = NAV_MENU;
  }
  res.locals.editorialBoard = EDITORIAL_BOARD;
  res.locals.contact = (siteSettings.contact_email || siteSettings.contact_phone) ? {
    email: siteSettings.contact_email || CONTACT.email,
    phone: siteSettings.contact_phone || CONTACT.phone,
    address: CONTACT.address
  } : CONTACT;
  res.locals.affiliateDisclosure = AFFILIATE_DISCLOSURE;
  res.locals.toBengaliNumber = toBengaliNumber;
  res.locals.formatBengaliDate = formatBengaliDate;
  res.locals.formatDuration = formatDuration;
  res.locals.formatCardExcerpt = formatCardExcerpt;
  res.locals.renderArticleContent = renderArticleContent;
  res.locals.generateTableOfContents = generateTableOfContents;
  res.locals.calculateReadingTime = calculateReadingTime;

  // Realtime notification counts for Admin Topbar
  res.locals.adminPendingCount = 0;
  res.locals.adminCommentsCount = 0;
  if (res.locals.user && (res.locals.user.role === 'admin' || res.locals.user.role === 'editor')) {
    try {
      const pendRow = await db.prepare("SELECT COUNT(1) AS total FROM posts WHERE status = 'pending'").get();
      const commRow = await db.prepare("SELECT COUNT(1) AS total FROM comments WHERE status = 'pending'").get();
      res.locals.adminPendingCount = pendRow ? pendRow.total : 0;
      res.locals.adminCommentsCount = commRow ? commRow.total : 0;
    } catch (e) {
      res.locals.adminPendingCount = 0;
      res.locals.adminCommentsCount = 0;
    }
  }

  next();
});

// Mount Routes
app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);
app.use('/', indexRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'পেজটি পাওয়া যায়নি (৪০৪)',
    message: 'আপনি যে পেজটি খুঁজছেন তা মুছে ফেলা হয়েছে বা লিঙ্কটি সঠিক নয়।',
    seo: generateSeoMeta({ title: 'পেজটি পাওয়া যায়নি' }),
    navMenu: NAV_MENU,
    editorialBoard: EDITORIAL_BOARD,
    contact: CONTACT
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).render('error', {
    title: 'সার্ভার ত্রুটি (৫০০)',
    message: 'দুঃখিত, কোনো একটি সমস্যা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।',
    seo: generateSeoMeta({ title: 'সার্ভার ত্রুটি' }),
    navMenu: NAV_MENU,
    editorialBoard: EDITORIAL_BOARD,
    contact: CONTACT
  });
});

app.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(`সেরা ১০ (Sera 10) রিভিউ পোর্টাল সার্ভার রানিং!`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`=============================================`);
});

module.exports = app;
