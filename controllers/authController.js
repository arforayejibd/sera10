const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { generateToken } = require('../middleware/auth');
const { generateSeoMeta } = require('../middleware/seo');
const { toBengaliNumber, formatBengaliDate } = require('../middleware/banglaDate');
const { SITE_NAME, TAGLINE, NAV_MENU, EDITORIAL_BOARD, CONTACT, SITE_URL } = require('../config/constants');
const { sendPasswordResetEmail, sendEmailVerificationMail } = require('../services/mailService');

// Login Page GET
exports.getLoginPage = (req, res) => {
  if (req.user) {
    return res.redirect('/admin');
  }
  const redirect = req.query.redirect || '/admin';
  const success = req.query.success || null;
  res.render('login', {
    redirect,
    error: null,
    success,
    resendEmail: null,
    seo: generateSeoMeta({ title: 'অ্যাডমিন লগইন' }),
    editorialBoard: EDITORIAL_BOARD,
    contact: CONTACT
  });
};

// Login POST
exports.postLogin = async (req, res) => {
  try {
    const { username, password, redirect } = req.body;

    if (!username || !password) {
      return res.render('login', {
        redirect: redirect || '/admin',
        error: 'অনুগ্রহ করে ইউজারনেম/ইমেইল এবং পাসওয়ার্ড প্রদান করুন।',
        resendEmail: null,
        seo: generateSeoMeta({ title: 'অ্যাডমিন লগইন' }),
        editorialBoard: EDITORIAL_BOARD,
        contact: CONTACT
      });
    }

    const user = await db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username.trim(), username.trim());

    if (!user) {
      return res.render('login', {
        redirect: redirect || '/admin',
        error: 'ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।',
        resendEmail: null,
        seo: generateSeoMeta({ title: 'অ্যাডমিন লগইন' }),
        editorialBoard: EDITORIAL_BOARD,
        contact: CONTACT
      });
    }

    let isValid = false;
    try {
      isValid = bcrypt.compareSync(password, user.password);
    } catch (e) {
      isValid = false;
    }

    if (!isValid) {
      return res.render('login', {
        redirect: redirect || '/admin',
        error: 'ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।',
        resendEmail: null,
        seo: generateSeoMeta({ title: 'অ্যাডমিন লগইন' }),
        editorialBoard: EDITORIAL_BOARD,
        contact: CONTACT
      });
    }

    const token = generateToken(user);
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

    res.redirect(redirect || '/admin');
  } catch (err) {
    console.error('Error in postLogin:', err);
    res.render('login', {
      redirect: req.body.redirect || '/admin',
      error: 'লগইন প্রক্রিয়ায় ত্রুটি ঘটেছে। অনুগ্রহ করে আবার চেষ্টা করুন।',
      resendEmail: null,
      seo: generateSeoMeta({ title: 'অ্যাডমিন লগইন' }),
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT
    });
  }
};

// Register Page GET (Public registration disabled for affiliate blog)
exports.getRegisterPage = (req, res) => {
  return res.redirect('/login');
};

// Register POST (Public registration disabled)
exports.postRegister = (req, res) => {
  return res.redirect('/login');
};

// Verify Email GET (/verify-email?token=...)
exports.getVerifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.render('verify_notice', {
        type: 'error',
        message: 'কোনো যাচাইকরণ টোকেন পাওয়া যায়নি।',
        title: 'অকার্যকর লিংক | পয়স্তি ম্যাগাজিন'
      });
    }

    // Look up token
    const record = await db.prepare(`
      SELECT * FROM email_verifications 
      WHERE token = ? AND expires_at > NOW()
      ORDER BY id DESC LIMIT 1
    `).get(token.trim());

    if (!record) {
      return res.render('verify_notice', {
        type: 'error',
        message: 'যাচাইকরণ লিংকটি অকার্যকর অথবা এর ২৪ ঘণ্টার মেয়াদ উত্তীর্ণ হয়ে গেছে।',
        title: 'অকার্যকর লিংক | পয়স্তি ম্যাগাজিন'
      });
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(record.user_id);
    if (!user) {
      return res.render('verify_notice', {
        type: 'error',
        message: 'ব্যবহারকারী অ্যাকাউন্ট খুঁজে পাওয়া যায়নি।',
        title: 'ত্রুটি | পয়স্তি ম্যাগাজিন'
      });
    }

    // Update user status
    const newStatus = user.is_approved ? 'active' : 'pending_approval';
    await db.prepare('UPDATE users SET email_verified = 1, status = ? WHERE id = ?').run(newStatus, user.id);

    // Delete token once verified
    await db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(user.id);

    if (user.is_approved) {
      return res.render('verify_notice', {
        type: 'active_approved',
        title: 'ইমেইল যাচাই সফল হয়েছে | পয়স্তি ম্যাগাজিন'
      });
    } else {
      return res.render('verify_notice', {
        type: 'verified_pending_approval',
        title: 'ইমেইল যাচাই সফল হয়েছে | পয়স্তি ম্যাগাজিন'
      });
    }
  } catch (err) {
    console.error('Error in getVerifyEmail:', err);
    res.render('verify_notice', {
      type: 'error',
      message: 'যাচাই প্রক্রিয়ায় সমস্যা হয়েছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।',
      title: 'ত্রুটি | পয়স্তি ম্যাগাজিন'
    });
  }
};

// Resend Verification Link POST (/resend-verification)
exports.postResendVerification = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.render('verify_notice', {
        type: 'error',
        message: 'অনুগ্রহ করে একটি সঠিক ইমেইল ঠিকানা প্রদান করুন।',
        title: 'ইমেইল যাচাইকরণ | পয়স্তি ম্যাগাজিন'
      });
    }

    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim());

    if (!user) {
      // Deceptive response for security (prevents user enumeration)
      return res.render('verify_notice', {
        type: 'verify_sent',
        email: email.trim(),
        successMessage: 'যদি আপনার ইমেইলটি আমাদের সিস্টেমে নিবন্ধিত থাকে, তবে একটি নতুন যাচাইকরণ লিঙ্ক পাঠানো হয়েছে।',
        title: 'ইমেইল যাচাইকরণ | পয়স্তি ম্যাগাজিন'
      });
    }

    if (user.email_verified && user.is_approved) {
      return res.render('verify_notice', {
        type: 'active_approved',
        title: 'অ্যাকাউন্ট সক্রিয় রয়েছে | পয়স্তি ম্যাগাজিন'
      });
    }

    if (user.email_verified && !user.is_approved) {
      return res.render('verify_notice', {
        type: 'verified_pending_approval',
        title: 'অ্যাকাউন্ট পর্যালোচনার অপেক্ষায় | পয়স্তি ম্যাগাজিন'
      });
    }

    // Clean up old tokens
    await db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(user.id);

    // Create fresh token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const expiresAtStr = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

    await db.prepare(`
      INSERT INTO email_verifications (user_id, token, expires_at)
      VALUES (?, ?, ?)
    `).run(user.id, verificationToken, expiresAtStr);

    const verifyBaseUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    const verifyUrl = `${verifyBaseUrl}/verify-email?token=${verificationToken}`;

    sendEmailVerificationMail(user, verifyUrl).catch(e => {
      console.error('[MAIL ERROR] resendVerification email failed:', e);
    });

    res.render('verify_notice', {
      type: 'verify_sent',
      email: user.email,
      successMessage: 'আপনার ইমেইলে নতুন অ্যাক্টিভেশন লিঙ্ক পাঠানো হয়েছে। অনুগ্রহ করে ইনবক্স চেক করুন।',
      title: 'ইমেইল যাচাইকরণ | পয়স্তি ম্যাগাজিন'
    });
  } catch (err) {
    console.error('Error in postResendVerification:', err);
    res.render('verify_notice', {
      type: 'error',
      message: 'লিঙ্ক পুনরায় পাঠাতে সমস্যা হয়েছে। অনুগ্রহ করে একটু পরে আবার চেষ্টা করুন।',
      title: 'ত্রুটি | পয়স্তি ম্যাগাজিন'
    });
  }
};

// Logout
exports.logout = (req, res) => {
  res.clearCookie('token');
  if (req.session) {
    req.session.destroy();
  }
  res.redirect('/');
};

// Spelling Rules Page (/spelling-rules)
exports.getSpellingRules = (req, res) => {
  const seo = generateSeoMeta({
    title: 'বাংলা বানান শুদ্ধিকরণ নির্দেশিকা - পয়স্তি ম্যাগাজিন',
    description: 'বাংলা একাডেমি প্রমিত বাংলা বানানের নিয়ম ও সাহিত্য রচনার জন্য বানান শুদ্ধিকরণ নির্দেশিকা।',
    url: '/spelling-rules'
  });

  res.render('spelling_rules', {
    seo,
    toBengaliNumber,
    formatBengaliDate,
    editorialBoard: EDITORIAL_BOARD,
    contact: CONTACT
  });
};

// Terms & Conditions Page (/terms)
exports.getTerms = (req, res) => {
  const seo = generateSeoMeta({
    title: 'লেখা প্রকাশের শর্তাবলী ও নিয়মাবলী - পয়স্তি ম্যাগাজিন',
    description: 'পয়স্তি ম্যাগাজিনে লেখা জমা দেওয়া ও প্রকাশের বিস্তারিত শর্তাবলী ও নিয়মনীতি।',
    url: '/terms'
  });

  res.render('terms', {
    seo,
    toBengaliNumber,
    formatBengaliDate,
    editorialBoard: EDITORIAL_BOARD,
    contact: CONTACT
  });
};

// Dynamic XML Sitemap for Google Ranking (/sitemap.xml)
exports.getSitemap = async (req, res) => {
  try {
    res.header('Content-Type', 'application/xml');

    const posts = await db.prepare("SELECT slug, published_at, updated_at FROM posts WHERE status = 'publish' ORDER BY published_at DESC").all();
    const categories = await db.prepare("SELECT slug FROM categories").all();
    const authors = await db.prepare("SELECT nicename, username FROM users WHERE role IN ('author', 'editor', 'admin')").all();
    const books = await db.prepare("SELECT slug, created_at FROM books").all();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    // Static Pages
    xml += `  <url><loc>${SITE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
    xml += `  <url><loc>${SITE_URL}/authors</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
    xml += `  <url><loc>${SITE_URL}/books</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>\n`;
    xml += `  <url><loc>${SITE_URL}/terms</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>\n`;

    // Categories
    categories.forEach(c => {
      xml += `  <url><loc>${SITE_URL}/category/${c.slug}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
    });

    // Posts
    posts.forEach(p => {
      const lastmod = (p.updated_at || p.published_at || new Date().toISOString()).split(' ')[0];
      xml += `  <url><loc>${SITE_URL}/post/${p.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>\n`;
    });

    // Books
    books.forEach(b => {
      xml += `  <url><loc>${SITE_URL}/book/${b.slug}</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>\n`;
    });

    // Authors
    authors.forEach(a => {
      xml += `  <url><loc>${SITE_URL}/author/${a.nicename || a.username}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
    });

    xml += `</urlset>`;
    res.send(xml);
  } catch (err) {
    console.error('Error in getSitemap:', err);
    res.status(500).send('Error generating sitemap');
  }
};

// Robots.txt
exports.getRobots = (req, res) => {
  res.header('Content-Type', 'text/plain');
  res.send(`User-agent: *\nAllow: /\nDisallow: /author/dashboard\nDisallow: /admin\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
};

// ==========================================
// PASSWORD RESET / FORGOT PASSWORD FLOW
// ==========================================

// Forgot Password Page GET
exports.getForgotPasswordPage = (req, res) => {
  if (req.user) {
    return res.redirect('/author/dashboard');
  }
  res.render('forgot_password', {
    error: null,
    success: null,
    identity: '',
    seo: generateSeoMeta({ title: 'পাসওয়ার্ড পুনরুদ্ধার' }),
    editorialBoard: EDITORIAL_BOARD,
    contact: CONTACT
  });
};

// Forgot Password POST
exports.postForgotPassword = async (req, res) => {
  try {
    const { identity } = req.body;
    const trimmedIdentity = (identity || '').trim();

    if (!trimmedIdentity) {
      return res.render('forgot_password', {
        error: 'অনুগ্রহ করে আপনার ইউজারনেম বা ইমেইল প্রদান করুন।',
        success: null,
        identity: '',
        seo: generateSeoMeta({ title: 'পাসওয়ার্ড পুনরুদ্ধার' }),
        editorialBoard: EDITORIAL_BOARD,
        contact: CONTACT
      });
    }

    const user = await db.prepare('SELECT id, username, email, display_name FROM users WHERE username = ? OR email = ?').get(trimmedIdentity, trimmedIdentity);

    if (!user || !user.email) {
      return res.render('forgot_password', {
        error: 'প্রদত্ত ইউজারনেম বা ইমেইলের কোনো অ্যাকাউন্ট পাওয়া যায়নি। সঠিক তথ্য দিন।',
        success: null,
        identity: trimmedIdentity,
        seo: generateSeoMeta({ title: 'পাসওয়ার্ড পুনরুদ্ধার' }),
        editorialBoard: EDITORIAL_BOARD,
        contact: CONTACT
      });
    }

    // Invalidate previous unused tokens for this user
    await db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0').run(user.id);

    // Generate secure token (64 hex characters)
    const resetToken = crypto.randomBytes(32).toString('hex');
    // 1 hour expiry in UTC format: YYYY-MM-DD HH:MM:SS
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);

    await db.prepare(`
      INSERT INTO password_resets (user_id, token, expires_at, used)
      VALUES (?, ?, ?, 0)
    `).run(user.id, resetToken, expiresAt);

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers.host || 'localhost:3000';
    const resetUrl = `${protocol}://${host}/reset-password?token=${resetToken}`;

    await sendPasswordResetEmail(user, resetUrl);

    return res.render('forgot_password', {
      error: null,
      success: `আপনার অ্যাকাউন্টের নিবন্ধিত ইমেইলে (${user.email}) পাসওয়ার্ড রিসেট করার লিংক পাঠানো হয়েছে। অনুগ্রহ করে আপনার ইনবক্স (বা স্প্যাম ফোল্ডার) চেক করুন।`,
      identity: '',
      seo: generateSeoMeta({ title: 'পাসওয়ার্ড পুনরুদ্ধার' }),
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT
    });
  } catch (err) {
    console.error('Error in postForgotPassword:', err);
    res.render('forgot_password', {
      error: 'পাসওয়ার্ড পুনরুদ্ধারে ত্রুটি ঘটেছে।',
      success: null,
      identity: '',
      seo: generateSeoMeta({ title: 'পাসওয়ার্ড পুনরুদ্ধার' }),
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT
    });
  }
};

// Reset Password Page GET
exports.getResetPasswordPage = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.render('reset_password', {
        validToken: false,
        token: '',
        error: 'কোনো পাসওয়ার্ড রিসেট টোকেন পাওয়া যায়নি।',
        seo: generateSeoMeta({ title: 'পাসওয়ার্ড রিসেট' }),
        editorialBoard: EDITORIAL_BOARD,
        contact: CONTACT
      });
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const resetRecord = await db.prepare(`
      SELECT pr.*, u.username, u.email 
      FROM password_resets pr
      JOIN users u ON pr.user_id = u.id
      WHERE pr.token = ? AND pr.used = 0 AND pr.expires_at > ?
    `).get(token, now);

    if (!resetRecord) {
      return res.render('reset_password', {
        validToken: false,
        token: '',
        error: 'এই রিসেট লিংকটি অবৈধ, মেয়াদোত্তীর্ণ অথবা পূর্বে ব্যবহৃত হয়েছে। অনুগ্রহ করে পুনরায় নতুন লিংকের জন্য অনুরোধ করুন।',
        seo: generateSeoMeta({ title: 'পাসওয়ার্ড রিসেট' }),
        editorialBoard: EDITORIAL_BOARD,
        contact: CONTACT
      });
    }

    res.render('reset_password', {
      validToken: true,
      token,
      error: null,
      seo: generateSeoMeta({ title: 'নতুন পাসওয়ার্ড নির্ধারণ' }),
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT
    });
  } catch (err) {
    console.error('Error in getResetPasswordPage:', err);
    res.render('reset_password', {
      validToken: false,
      token: '',
      error: 'লিংক যাচাইকরণে ত্রুটি ঘটেছে।',
      seo: generateSeoMeta({ title: 'পাসওয়ার্ড রিসেট' }),
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT
    });
  }
};

// Reset Password POST
exports.postResetPassword = async (req, res) => {
  try {
    const { token, password, confirm_password } = req.body;

    if (!token) {
      return res.render('reset_password', {
        validToken: false,
        token: '',
        error: 'টোকেন পাওয়া যায়নি। অনুগ্রহ করে পুনরায় চেষ্টা করুন।',
        seo: generateSeoMeta({ title: 'পাসওয়ার্ড রিসেট' }),
        editorialBoard: EDITORIAL_BOARD,
        contact: CONTACT
      });
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const resetRecord = await db.prepare(`
      SELECT * FROM password_resets 
      WHERE token = ? AND used = 0 AND expires_at > ?
    `).get(token, now);

    if (!resetRecord) {
      return res.render('reset_password', {
        validToken: false,
        token: '',
        error: 'এই রিসেট লিংকটির মেয়াদ শেষ হয়ে গেছে অথবা পূর্বে ব্যবহৃত হয়েছে।',
        seo: generateSeoMeta({ title: 'পাসওয়ার্ড রিসেট' }),
        editorialBoard: EDITORIAL_BOARD,
        contact: CONTACT
      });
    }

    if (!password || password.length < 6) {
      return res.render('reset_password', {
        validToken: true,
        token,
        error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।',
        seo: generateSeoMeta({ title: 'নতুন পাসওয়ার্ড নির্ধারণ' }),
        editorialBoard: EDITORIAL_BOARD,
        contact: CONTACT
      });
    }

    if (password !== confirm_password) {
      return res.render('reset_password', {
        validToken: true,
        token,
        error: 'উভয় পাসওয়ার্ড একই হতে হবে। অনুগ্রহ করে যাচাই করুন।',
        seo: generateSeoMeta({ title: 'নতুন পাসওয়ার্ড নির্ধারণ' }),
        editorialBoard: EDITORIAL_BOARD,
        contact: CONTACT
      });
    }

    // Hash new password and update user
    const hashedPassword = bcrypt.hashSync(password, 10);
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, resetRecord.user_id);

    // Invalidate all tokens for this user
    await db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?').run(resetRecord.user_id);

    // Render login page with prominent success banner
    return res.render('login', {
      redirect: '/author/dashboard',
      error: null,
      success: 'আপনার পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে! এখন নতুন পাসওয়ার্ড দিয়ে লগইন করুন।',
      seo: generateSeoMeta({ title: 'লেখক লগইন' }),
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT
    });
  } catch (err) {
    console.error('Error in postResetPassword:', err);
    res.render('reset_password', {
      validToken: false,
      token: '',
      error: 'পাসওয়ার্ড পরিবর্তনে ত্রুটি ঘটেছে।',
      seo: generateSeoMeta({ title: 'পাসওয়ার্ড রিসেট' }),
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT
    });
  }
};

// Spelling Rules / Spell Checker (redirected to home)
exports.getSpellingRules = (req, res) => {
  res.redirect(301, '/');
};

// Terms Page
exports.getTerms = (req, res) => {
  res.render('terms', {
    pageTitle: 'ব্যবহারের শর্তাবলী ও নীতিমালা',
    seo: generateSeoMeta({
      title: 'শর্তাবলী ও নীতিমালা',
      description: 'পয়স্তি ম্যাগাজিনের ব্যবহারের শর্তাবলী ও প্রকাশনা নীতিমালা।',
      canonical: `${SITE_URL}/terms`
    }),
    editorialBoard: EDITORIAL_BOARD,
    contact: CONTACT
  });
};


