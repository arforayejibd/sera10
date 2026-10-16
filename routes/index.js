const express = require('express');
const router = express.Router();
const homeController = require('../controllers/homeController');
const postController = require('../controllers/postController');
const bookController = require('../controllers/bookController');
const bookReviewController = require('../controllers/bookReviewController');
const upload = require('../middleware/upload');
const { generateSeoMeta } = require('../middleware/seo');
const { requireAuth } = require('../middleware/auth');
const db = require('../config/database');

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Homepage
router.get('/', homeController.getHomePage);

// Legacy author redirects
router.get(['/author-deshboard', '/author-dashboard', '/author/:slug', '/authors'], (req, res) => res.redirect('/admin'));

// All Blog Posts & Guides Archive
router.get(['/blog', '/all-posts', '/posts', '/articles'], postController.getAllPostsPage);

// Books List & Single Book
router.get('/books', bookController.getBooksList);
router.get('/book/:slug', bookController.getSingleBook);

// Book Review Submission Form & API
router.get(['/submit-book-review', '/book-review-request', '/book-review-form'], bookReviewController.getReviewSubmissionPage);
router.post(
  ['/submit-book-review', '/book-review-request', '/api/book-reviews/submit'], 
  (req, res, next) => {
    upload.single('cover')(req, res, function (err) {
      if (err) {
        const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        const errMsg = err.code === 'LIMIT_FILE_SIZE' 
          ? 'ছবির আকার সর্বোচ্চ ৫ মেগাবাইট হতে পারবে।' 
          : (err.message || 'ছবি আপলোডে সমস্যা হয়েছে।');
        if (isAjax) {
          return res.status(400).json({ success: false, message: errMsg });
        }
        return res.status(400).render('book_review_form', {
          seo: generateSeoMeta({ title: 'বই রিভিউয়ের জন্য তথ্য পাঠান - ত্রুটি' }),
          toBengaliNumber: res.locals.toBengaliNumber,
          formatBengaliDate: res.locals.formatBengaliDate,
          editorialBoard: res.locals.editorialBoard,
          contact: res.locals.contact,
          successMessage: null,
          errorMessage: errMsg,
          oldInput: req.body || {}
        });
      }
      next();
    });
  }, 
  bookReviewController.postSubmitReview
);

// Category Archive (Supports both /category/... and WordPress /section/...)
router.get([
  '/category/:slug',
  '/section/:slug',
  '/category/:parent/:slug',
  '/section/:parent/:slug'
], postController.getCategoryPage);

// Tag Archive (/tag/:slug)
router.get('/tag/:slug', postController.getTagPage);

// Selected Literature (/topic/selected)
router.get(['/topic/selected', '/topic/:slug'], (req, res) => {
  req.params.slug = 'গদ্য';
  postController.getCategoryPage(req, res);
});

// Legacy spell checker URLs redirect to homepage
router.get([
  '/bangla-spell',
  '/spelling-rules',
  '/bangla-spell-checker',
  '/bangla-spelling-checker',
  '/bangla-banan-shuddhi',
  '/বাংলা-বানান-শুদ্ধিকরণ',
  '/বাংলা-বানান-পরীক্ষক',
  encodeURI('/বাংলা-বানান-শুদ্ধিকরণ'),
  encodeURI('/বাংলা-বানান-পরীক্ষক')
], (req, res) => res.redirect(301, '/'));

router.get(['/terms-and-condition', '/terms'], (req, res) => {
  res.render('page', {
    pageTitle: 'শর্তাবলী',
    content: 'পয়স্তি ম্যাগাজিনে লেখা প্রকাশের শর্তাবলী: প্রতিটি লেখা মৌলিক হতে হবে এবং লেখকের নিজস্ব সৃষ্টি হতে হবে।',
    seo: {
      title: 'শর্তাবলী - পয়স্তি ম্যাগাজিন',
      description: 'পয়স্তি ম্যাগাজিনে লেখা প্রকাশের শর্তাবলী।',
      canonical: 'https://payasti.com/terms-and-condition',
      og: { type: 'website', title: 'শর্তাবলী - পয়স্তি ম্যাগাজিন', description: 'পয়স্তি ম্যাগাজিনে লেখা প্রকাশের শর্তাবলী।', url: 'https://payasti.com/terms-and-condition', site_name: 'পয়স্তি ম্যাগাজিন', locale: 'bn_BD', image: '/images/Payasti-logo.png' }
    }
  });
});

// Single Article
router.get('/post/:slug', postController.getSinglePost);
router.post('/post/:slug/comment', postController.postComment);
router.post(['/post/:slug/rate', '/api/post/:slug/rate', '/api/posts/:slug/rate'], postController.postRate);

// Legacy or category-prefixed article URL redirect (e.g. /sports/post-slug -> /post/post-slug)
router.get('/:category/:slug', async (req, res, next) => {
  try {
    const { category, slug } = req.params;
    const reserved = ['admin', 'api', 'vendor', 'css', 'js', 'images', 'uploads', 'fonts', 'post', 'category', 'section', 'tag', 'book', 'books', 'topic', 'author', 'submit-book-review', 'book-review-request', 'book-review-form'];
    if (reserved.includes(category.toLowerCase())) {
      return next();
    }

    const post = await db.prepare('SELECT slug FROM posts WHERE slug = ? LIMIT 1').get(slug);
    if (post) {
      return res.redirect(301, `/post/${encodeURIComponent(post.slug)}`);
    }
    next();
  } catch (err) {
    next();
  }
});

// Search
router.get('/search', postController.searchPosts);
router.get('/api/search', postController.apiSearch);

module.exports = router;

