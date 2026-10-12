const db = require('../config/database');
const { generateSeoMeta, getWebsiteSchema } = require('../middleware/seo');
const { toBengaliNumber, formatBengaliDate, formatCardExcerpt } = require('../middleware/banglaDate');
const { SITE_NAME, TAGLINE, NAV_MENU, EDITORIAL_BOARD, CONTACT } = require('../config/constants');
const postController = require('./postController');

exports.getHomePage = async (req, res) => {
  try {
    // WordPress search query ?s= compatibility
    if (req.query.s) {
      req.query.q = req.query.s;
      return postController.searchPosts(req, res);
    }

    const cardFields = `
      p.id, p.title, p.slug, p.excerpt, p.content, p.featured_image, p.published_at, p.views, 
      p.rating_score, p.rating_count, p.category_id, p.subcategory_id,
      u.display_name AS author_name, u.nicename AS author_slug, u.avatar AS author_avatar,
      c.name AS category_name, c.slug AS category_slug
    `;

    // 1. Fetch Featured / Hero Reviews (6 posts)
    let featuredPosts = await db.prepare(`
      SELECT ${cardFields}
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'publish' AND p.is_featured = 1
      ORDER BY p.published_at DESC, p.id DESC
      LIMIT 6
    `).all();

    if (featuredPosts.length === 0) {
      featuredPosts = await db.prepare(`
        SELECT ${cardFields}
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.status = 'publish'
        ORDER BY p.published_at DESC, p.id DESC
        LIMIT 6
      `).all();
    }

    // 2. Fetch Trending / Most Viewed Reviews
    const trendingReviews = await db.prepare(`
      SELECT ${cardFields}
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'publish'
      ORDER BY p.views DESC, p.published_at DESC
      LIMIT 6
    `).all();

    // 3. Fetch Top Lists (Sera 10 Lists category)
    const topLists = await db.prepare(`
      SELECT ${cardFields}
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'publish' AND (c.slug = 'sera-10-lists' OR p.title LIKE '%10%' OR p.title LIKE '%১০%')
      ORDER BY p.published_at DESC
      LIMIT 8
    `).all();

    // 4. Fetch Tech & Gadgets Reviews
    const techReviews = await db.prepare(`
      SELECT ${cardFields}
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'publish' AND (c.slug IN ('tech', 'tools') OR EXISTS (SELECT 1 FROM post_categories pc JOIN categories cat ON pc.category_id = cat.id WHERE pc.post_id = p.id AND cat.slug IN ('tech', 'tools')))
      ORDER BY p.published_at DESC
      LIMIT 6
    `).all();

    // 5. Fetch Books Reviews
    const bookReviews = await db.prepare(`
      SELECT ${cardFields}
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'publish' AND (c.slug = 'books' OR EXISTS (SELECT 1 FROM post_categories pc JOIN categories cat ON pc.category_id = cat.id WHERE pc.post_id = p.id AND cat.slug = 'books'))
      ORDER BY p.published_at DESC
      LIMIT 6
    `).all();

    // 6. Fetch Lifestyle / Beauty / Baby Care
    const lifestyleReviews = await db.prepare(`
      SELECT ${cardFields}
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'publish' AND (c.slug IN ('beauty-and-personal-care', 'baby-products', 'health-and-wellness', 'food') OR EXISTS (SELECT 1 FROM post_categories pc JOIN categories cat ON pc.category_id = cat.id WHERE pc.post_id = p.id AND cat.slug IN ('beauty-and-personal-care', 'baby-products', 'health-and-wellness', 'food')))
      ORDER BY p.published_at DESC
      LIMIT 6
    `).all();

    // 7. Fetch Latest 12 Buying Guides
    const latestPosts = await db.prepare(`
      SELECT ${cardFields}
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'publish'
      ORDER BY p.published_at DESC, p.id DESC
      LIMIT 12
    `).all();

    // 8. Fetch Top Active Categories with Post Count
    const topCategories = await db.prepare(`
      SELECT id, name, slug, count
      FROM categories
      WHERE count > 0
      ORDER BY count DESC
      LIMIT 10
    `).all();

    // 9. Fetch Top 5 Popular Search Queries
    let popularSearches = [];
    try {
      popularSearches = await db.query(`
        SELECT query, count
        FROM search_queries
        WHERE LENGTH(TRIM(query)) >= 2
        ORDER BY count DESC, last_searched_at DESC
        LIMIT 5
      `);
    } catch (searchErr) {
      console.warn('Could not fetch popular searches:', searchErr.message);
    }

    if (!popularSearches || popularSearches.length === 0) {
      popularSearches = [
        { query: 'স্মার্টফোন', count: 10 },
        { query: 'সেরা বই', count: 8 },
        { query: 'ল্যাপটপ', count: 6 },
        { query: 'ফ্রিজ', count: 4 },
        { query: 'স্মার্টওয়াচ', count: 2 }
      ];
    }

    // SEO & Schema
    const seo = generateSeoMeta({
      title: `${SITE_NAME} - ${TAGLINE}`,
      description: 'সেরা ১০ (Sera 10) বাংলাদেশের শীর্ষস্থানীয় প্রোডাক্ট রিভিউ, শীর্ষ ১০ তালিকা এবং নিরপেক্ষ কেনাকাটার নির্ভরযোগ্য গাইড।',
      url: '/',
      schema: getWebsiteSchema()
    });

    res.render('home', {
      featuredPosts,
      trendingReviews,
      topLists,
      techReviews,
      bookReviews,
      lifestyleReviews,
      latestPosts,
      topCategories,
      popularSearches,
      seo,
      toBengaliNumber,
      formatBengaliDate,
      formatCardExcerpt,
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT
    });
  } catch (err) {
    console.error('Error in getHomePage:', err);
    res.status(500).render('error', {
      title: 'সার্ভার ত্রুটি (৫০০)',
      message: 'হোমপেজ লোড করতে সমস্যা হয়েছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।',
      seo: generateSeoMeta({ title: 'সার্ভার ত্রুটি' }),
      editorialBoard: EDITORIAL_BOARD,
      contact: CONTACT
    });
  }
};
