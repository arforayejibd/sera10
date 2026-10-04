const express = require('express');
const router = express.Router();
const homeController = require('../controllers/homeController');
const postController = require('../controllers/postController');
const bookController = require('../controllers/bookController');
const { generateSeoMeta, getSpellCheckerSchema } = require('../middleware/seo');
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

// Bengali Spelling Rules & Live Interactive Spell Checker
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
], (req, res) => {
  const schema = getSpellCheckerSchema();
  const seo = generateSeoMeta({
    exactTitle: 'বাংলা বানান সংশোধন ও শুদ্ধিকরণ | পয়স্তি বাংলা স্পেল চেকার (Bangla Spell Checker)',
    description: 'অনলাইন বাংলা বানান সংশোধন ও শুদ্ধিকরণ টুল। বাংলা একাডেমি প্রমিত আধুনিক বানানরীতি ও ১ লক্ষাধিক শব্দের অভিধান অনুযায়ী যেকোনো লেখার ভুল বানান স্বয়ংক্রিয়ভাবে পরীক্ষা ও এক ক্লিকে সংশোধন করুন।',
    url: '/bangla-spell',
    keywords: [
      'বাংলা বানান সংশোধন',
      'বাংলা বানান শুদ্ধিকরণ',
      'বাংলা স্পেল চেকার',
      'bangla spell checker',
      'bengali spelling checker',
      'অনলাইন বানান পরীক্ষক',
      'বাংলা একাডেমি প্রমিত বানান',
      'সঠিক বাংলা বানান',
      'bangla grammar check'
    ],
    schema: schema
  });

  res.render('spelling_rules', {
    pageTitle: 'বাংলা বানান সংশোধন ও শুদ্ধিকরণ | পয়স্তি বাংলা স্পেল চেকার',
    seo: seo
  });
});

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
    const reserved = ['admin', 'api', 'vendor', 'css', 'js', 'images', 'uploads', 'fonts', 'post', 'category', 'section', 'tag', 'book', 'books', 'topic', 'author'];
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

