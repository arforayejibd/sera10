const path = require('path');
const db = require('../config/database');
const { generateSeoMeta, getBreadcrumbSchema } = require('../middleware/seo');
const { toBengaliNumber, formatBengaliDate } = require('../middleware/banglaDate');
const { SITE_NAME, TAGLINE, NAV_MENU, EDITORIAL_BOARD, CONTACT } = require('../config/constants');

// Convert Bengali digits (০-৯) to English digits (0-9)
function normalizeBengaliDigits(str) {
  if (!str) return '';
  const bn = '০১২৩৪৫৬৭৮৯';
  return String(str).replace(/[০-৯]/g, d => bn.indexOf(d));
}

// Word counter helper
function countWords(text) {
  if (!text) return 0;
  const s = text.trim();
  return s ? s.split(/\s+/).length : 0;
}

/**
 * GET /submit-book-review
 * Render the public Book Review Submission Form page
 */
exports.getReviewSubmissionPage = async (req, res) => {
  try {
    const breadcrumbs = [
      { name: 'প্রচ্ছদ', url: '/' },
      { name: 'বই রিভিউ রিকুয়েস্ট', url: '/submit-book-review' }
    ];

    const seo = generateSeoMeta({
      title: 'বই রিভিউ রিকুয়েস্ট - সেরা ১০',
      description: 'সেরা ১০ রিভিউ পোর্টালে আপনার বইয়ের বিস্তারিত রিভিউ প্রকাশের জন্য বই রিভিউ রিকুয়েস্ট পাঠান।',
      url: '/submit-book-review',
      schema: getBreadcrumbSchema(breadcrumbs)
    });

    res.render('book_review_form', {
      seo,
      toBengaliNumber,
      formatBengaliDate,
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT,
      successMessage: null,
      errorMessage: null,
      oldInput: {}
    });
  } catch (err) {
    console.error('Error rendering book review submission form:', err);
    res.status(500).render('error', {
      title: 'সার্ভার ত্রুটি',
      message: 'বই রিভিউ ফরম লোড করা সম্ভব হয়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।',
      seo: generateSeoMeta({ title: 'সার্ভার ত্রুটি' }),
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT
    });
  }
};

/**
 * POST /submit-book-review
 * Handle form submission with cover image upload and validation
 */
exports.postSubmitReview = async (req, res) => {
  const isAjax = req.xhr || 
    (req.headers.accept && req.headers.accept.includes('application/json')) || 
    req.headers['x-requested-with'] === 'XMLHttpRequest';

  try {
    const title = (req.body.title || '').trim();
    const author_name = (req.body.author || req.body.author_name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    let mobile = normalizeBengaliDigits(req.body.mobile || '').replace(/[\s-]/g, '');
    const description = (req.body.desc || req.body.description || '').trim();
    let rokomari_url = (req.body.rokomari || req.body.rokomari_url || '').trim();
    const transaction_id = (req.body.trx || req.body.transaction_id || '').trim().toUpperCase();

    // Determine cover image URL
    let cover_image = '';
    if (req.file) {
      cover_image = `/uploads/${req.file.filename}`;
    } else if (req.body.cover_image && typeof req.body.cover_image === 'string' && req.body.cover_image.startsWith('/uploads/')) {
      cover_image = req.body.cover_image;
    }

    // Validation checks
    const errors = [];
    if (!title) errors.push('বইয়ের নাম আবশ্যক।');
    if (!author_name) errors.push('লেখকের নাম আবশ্যক।');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      errors.push('সঠিক ইমেইল ঠিকানা প্রদান করুন।');
    }

    // Check Bangladeshi mobile format
    const mobileRegex = /^(?:\+?88)?01[3-9]\d{8}$/;
    if (!mobile || !mobileRegex.test(mobile)) {
      errors.push('সঠিক মোবাইল নম্বর দিন (যেমন: 01712345678)।');
    }

    if (!cover_image) {
      errors.push('বইয়ের প্রচ্ছদ ছবি আপলোড করা আবশ্যক (JPG, PNG বা WebP)।');
    }

    const wordCount = countWords(description);
    if (!description) {
      errors.push('বইটি সম্পর্কে সংক্ষিপ্ত পরিচিতি আবশ্যক।');
    } else if (wordCount > 200) {
      errors.push(`বইয়ের পরিচিতি সর্বোচ্চ ২০০ শব্দের মধ্যে লিখুন। বর্তমানে ${toBengaliNumber(wordCount)} শব্দ রয়েছে।`);
    }

    // Rokomari URL validation & auto-prefix (Optional)
    if (rokomari_url) {
      if (!/^https?:\/\//i.test(rokomari_url) && /^(www\.)?rokomari\.com/i.test(rokomari_url)) {
        rokomari_url = 'https://' + rokomari_url;
      }
      const rokomariRegex = /^https?:\/\/(www\.)?rokomari\.com\/.+/i;
      if (!rokomariRegex.test(rokomari_url)) {
        errors.push('রকমারির লিঙ্ক দিলে সঠিক লিঙ্ক প্রদান করুন (rokomari.com লিঙ্ক)।');
      }
    }

    // Transaction ID validation (8-12 alphanumeric)
    const trxRegex = /^[A-Z0-9]{8,12}$/;
    if (!transaction_id || !trxRegex.test(transaction_id)) {
      errors.push('সঠিক বিকাশ ট্রানজ্যাকশন আইডি প্রদান করুন (৮–১২ অক্ষর ও সংখ্যা)।');
    }

    if (errors.length > 0) {
      if (isAjax) {
        return res.status(400).json({
          success: false,
          message: errors[0],
          errors
        });
      }

      return res.status(400).render('book_review_form', {
        seo: generateSeoMeta({ title: 'বই রিভিউয়ের জন্য তথ্য পাঠান - ত্রুটি' }),
        toBengaliNumber,
        formatBengaliDate,
        editorialBoard: EDITORIAL_BOARD,
        contact: CONTACT,
        successMessage: null,
        errorMessage: errors.join(' '),
        oldInput: { title, author: author_name, email, mobile, description, rokomari: rokomari_url, trx: transaction_id, cover_image }
      });
    }

    // Get client IP address
    const ip_address = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

    // Insert into MySQL database
    const result = await db.prepare(`
      INSERT INTO book_reviews (
        title, 
        author_name, 
        email, 
        mobile, 
        cover_image, 
        description, 
        rokomari_url, 
        transaction_id, 
        payment_amount, 
        payment_method, 
        status, 
        ip_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '২০০ টাকা', 'bkash', 'pending', ?)
    `).run(
      title,
      author_name,
      email,
      mobile,
      cover_image,
      description,
      rokomari_url,
      transaction_id,
      ip_address
    );

    const insertedId = result.insertId || result.lastInsertRowid;

    const responseData = {
      id: insertedId,
      title,
      author_name,
      email,
      mobile,
      cover_image,
      description,
      rokomari_url,
      transaction_id,
      payment_amount: '২০০ টাকা',
      status: 'pending',
      created_at: new Date().toISOString()
    };

    if (isAjax) {
      return res.json({
        success: true,
        message: 'আপনার বই রিভিউয়ের আবেদনটি সফলভাবে জমা নেওয়া হয়েছে! আমাদের টিম দ্রুত বিকাশ লেনদেন যাচাই করে আপনার সাথে যোগাযোগ করবে।',
        data: responseData
      });
    }

    // Normal form submit fallback
    res.render('book_review_form', {
      seo: generateSeoMeta({ title: 'বই রিভিউ আবেদন সফল - সেরা ১০' }),
      toBengaliNumber,
      formatBengaliDate,
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT,
      successMessage: 'আপনার বই রিভিউয়ের আবেদনটি সফলভাবে জমা নেওয়া হয়েছে!',
      errorMessage: null,
      oldInput: {},
      submittedData: responseData
    });

  } catch (err) {
    console.error('Error processing book review submission:', err);
    if (isAjax) {
      return res.status(500).json({
        success: false,
        message: 'সার্ভারে সমস্যা হয়েছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।'
      });
    }

    res.status(500).render('error', {
      title: 'সার্ভার ত্রুটি',
      message: 'বই রিভিউ জমা দেওয়ার সময় অপ্রত্যাশিত সমস্যা হয়েছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।',
      seo: generateSeoMeta({ title: 'সার্ভার ত্রুটি' }),
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT
    });
  }
};
