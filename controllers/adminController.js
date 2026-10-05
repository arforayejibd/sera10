const fs = require('fs');
const path = require('path');
const slugify = require('slugify');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { generateSeoMeta } = require('../middleware/seo');
const { toBengaliNumber, formatBengaliDate, generateCleanExcerpt } = require('../middleware/banglaDate');
const { sendAccountApprovedEmail } = require('../services/mailService');
const { generateEnglishSlug } = require('../utils/slugify');
const { extractBilingualTags, parseTagsInput } = require('../utils/tagExtractor');

// Helper to synchronize post tags
async function syncPostTags(postId, tagsInput) {
  if (!postId) return;
  const parsedTagNames = parseTagsInput(tagsInput);
  try {
    await db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(postId);
    for (const tagName of parsedTagNames) {
      if (!tagName || !tagName.trim()) continue;
      const cleanName = tagName.trim();
      let tag = await db.prepare('SELECT id, name FROM tags WHERE name = ?').get(cleanName);
      if (!tag) {
        let tagSlug = generateEnglishSlug(cleanName) || `tag-${Date.now()}`;
        const existingSlug = await db.prepare('SELECT id FROM tags WHERE slug = ?').get(tagSlug);
        if (existingSlug) {
          tagSlug = `${tagSlug}-${Date.now()}`;
        }
        const insertRes = await db.prepare('INSERT INTO tags (name, slug) VALUES (?, ?)').run(cleanName, tagSlug);
        const newTagId = insertRes.insertId || insertRes.lastInsertRowid;
        tag = { id: newTagId, name: cleanName };
      }
      if (tag && tag.id) {
        await db.prepare('INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)').run(postId, tag.id);
      }
    }
  } catch (err) {
    console.error('Error syncing post_tags for post ' + postId + ':', err);
  }
}

// ==========================================
// 1. DASHBOARD OVERVIEW
// ==========================================
exports.getDashboard = async (req, res) => {
  try {
    const pendingRow = await db.prepare("SELECT COUNT(*) AS total FROM posts WHERE status = 'pending'").get();
    const publishedRow = await db.prepare("SELECT COUNT(*) AS total FROM posts WHERE status = 'publish'").get();
    const draftRow = await db.prepare("SELECT COUNT(*) AS total FROM posts WHERE status = 'draft'").get();
    const usersRow = await db.prepare("SELECT COUNT(*) AS total FROM users").get();
    const categoriesRow = await db.prepare("SELECT COUNT(*) AS total FROM categories").get();
    const tagsRow = await db.prepare("SELECT COUNT(*) AS total FROM tags").get();
    const totalViewsRow = await db.prepare("SELECT COALESCE(SUM(views), 0) AS total FROM posts").get();

    const pendingPostsCount = pendingRow ? pendingRow.total : 0;
    const publishedPostsCount = publishedRow ? publishedRow.total : 0;
    const draftPostsCount = draftRow ? draftRow.total : 0;
    const usersCount = usersRow ? usersRow.total : 0;
    const categoriesCount = categoriesRow ? categoriesRow.total : 0;
    const tagsCount = tagsRow ? tagsRow.total : 0;
    const totalViews = totalViewsRow ? totalViewsRow.total : 0;

    const pendingUsersRow = await db.prepare("SELECT COUNT(1) AS total FROM users WHERE status IN ('pending_approval', 'pending_verification') OR (role = 'author' AND is_approved = 0)").get();
    const pendingUsersCount = pendingUsersRow ? pendingUsersRow.total : 0;

    // Recent pending submissions
    const recentPending = await db.prepare(`
      SELECT p.*, u.display_name AS author_name, u.email AS author_email, c.name AS category_name
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'pending'
      ORDER BY p.id DESC LIMIT 5
    `).all();

    // Recent published submissions
    const recentPublished = await db.prepare(`
      SELECT p.*, u.display_name AS author_name, c.name AS category_name
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'publish'
      ORDER BY p.id DESC LIMIT 5
    `).all();

    // Recent registered users
    const recentUsers = await db.prepare(`
      SELECT id, display_name, username, email, role, registered_at, created_at
      FROM users
      ORDER BY id DESC LIMIT 5
    `).all();

    const seo = generateSeoMeta({ title: 'সেরা ১০ অ্যাডমিন ড্যাশবোর্ড' });

    res.render('admin/dashboard', {
      user: req.user,
      stats: {
        pending: pendingPostsCount,
        published: publishedPostsCount,
        drafts: draftPostsCount,
        users: usersCount,
        pendingUsers: pendingUsersCount,
        categories: categoriesCount,
        tags: tagsCount,
        totalViews: totalViews
      },
      recentPending,
      recentPublished,
      recentUsers,
      activeMenu: 'admin_dashboard',
      seo,
      toBengaliNumber,
      formatBengaliDate
    });
  } catch (err) {
    console.error('Error in getDashboard:', err);
    res.status(500).render('error', {
      title: 'সার্ভার ত্রুটি',
      message: 'এডমিন ড্যাশবোর্ড লোড করতে সমস্যা হয়েছে।',
      seo: generateSeoMeta({ title: 'সার্ভার ত্রুটি' }),
      navMenu: [],
      editorialBoard: [],
      contact: {}
    });
  }
};

// ==========================================
// 2. ALL POSTS MANAGEMENT
// ==========================================
exports.getAllPosts = async (req, res) => {
  try {
    const statusFilter = req.query.status || 'all';
    const categoryFilter = req.query.category || 'all';
    const searchQuery = (req.query.q || '').trim();
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 25;
    const offset = (page - 1) * limit;

    // Counts for tabs
    const allRow = await db.prepare("SELECT COUNT(*) AS total FROM posts").get();
    const pubRow = await db.prepare("SELECT COUNT(*) AS total FROM posts WHERE status = 'publish'").get();
    const pendRow = await db.prepare("SELECT COUNT(*) AS total FROM posts WHERE status = 'pending'").get();
    const draftRow = await db.prepare("SELECT COUNT(*) AS total FROM posts WHERE status = 'draft'").get();

    const countAll = allRow ? allRow.total : 0;
    const countPublish = pubRow ? pubRow.total : 0;
    const countPending = pendRow ? pendRow.total : 0;
    const countDraft = draftRow ? draftRow.total : 0;

    let whereClauses = [];
    let params = [];

    if (statusFilter && statusFilter !== 'all') {
      whereClauses.push('p.status = ?');
      params.push(statusFilter);
    }

    let joinPcFilter = false;
    if (categoryFilter && categoryFilter !== 'all') {
      const targetCatId = parseInt(categoryFilter, 10);
      whereClauses.push('(p.category_id = ? OR p.subcategory_id = ? OR pc_f.category_id = ?)');
      params.push(targetCatId, targetCatId, targetCatId);
      joinPcFilter = true;
    }

    if (searchQuery) {
      whereClauses.push('(p.title LIKE ? OR u.display_name LIKE ? OR u.username LIKE ?)');
      params.push(`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const totalFilteredRow = await db.prepare(`
      SELECT COUNT(DISTINCT p.id) AS total
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      ${joinPcFilter ? 'LEFT JOIN post_categories pc_f ON p.id = pc_f.post_id' : ''}
      ${whereSql}
    `).get(...params);
    const totalFiltered = totalFilteredRow ? totalFilteredRow.total : 0;
    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    const posts = await db.prepare(`
      SELECT p.*, 
        u.display_name AS author_name, u.username AS author_username, u.email AS author_email, 
        c.name AS category_name, c.slug AS category_slug,
        GROUP_CONCAT(DISTINCT cat.name ORDER BY (CASE WHEN cat.id = p.category_id THEN 0 ELSE 1 END), cat.name SEPARATOR ', ') AS all_category_names
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      ${joinPcFilter ? 'LEFT JOIN post_categories pc_f ON p.id = pc_f.post_id' : ''}
      LEFT JOIN post_categories pc ON p.id = pc.post_id
      LEFT JOIN categories cat ON (pc.category_id = cat.id OR cat.id = p.category_id OR cat.id = p.subcategory_id)
      ${whereSql}
      GROUP BY p.id
      ORDER BY p.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const categories = await db.prepare('SELECT id, name FROM categories ORDER BY name ASC').all();
    const seo = generateSeoMeta({ title: 'সকল লেখা পরিচালনা - এডমিন' });

    res.render('admin/posts', {
      user: req.user,
      posts,
      statusFilter,
      categoryFilter,
      searchQuery,
      page,
      totalPages,
      totalFiltered,
      counts: {
        all: countAll,
        publish: countPublish,
        pending: countPending,
        draft: countDraft
      },
      categories,
      activeMenu: 'all_posts',
      seo,
      toBengaliNumber,
      formatBengaliDate
    });
  } catch (err) {
    console.error('Error in getAllPosts:', err);
    res.redirect('/admin');
  }
};

// New Post (Admin) GET
exports.getNewPost = async (req, res) => {
  try {
    const categories = await db.prepare('SELECT id, name, parent_id FROM categories ORDER BY name ASC').all();
    const authors = await db.prepare('SELECT id, display_name, username, role FROM users ORDER BY display_name ASC').all();
    const allTags = await db.prepare('SELECT id, name, slug FROM tags ORDER BY name ASC').all();
    const seo = generateSeoMeta({ title: 'নতুন লেখা যোগ করুন - এডমিন' });

    res.render('admin/post_new', {
      user: req.user,
      categories,
      selectedCategoryIds: [],
      authors,
      allTags: allTags || [],
      postTags: [],
      error: null,
      activeMenu: 'new_post',
      seo,
      toBengaliNumber
    });
  } catch (err) {
    console.error('Error in getNewPost:', err);
    res.redirect('/admin/posts');
  }
};

// New Post (Admin) POST
exports.postNewPost = async (req, res) => {
  try {
    const { title, author_id, excerpt, content, status, is_featured } = req.body;
    const categories = await db.prepare('SELECT id, name, parent_id FROM categories ORDER BY name ASC').all();
    const authors = await db.prepare('SELECT id, display_name, username, role FROM users ORDER BY display_name ASC').all();

    if (!title || !title.trim()) {
      return res.render('admin/post_new', {
        user: req.user,
        categories,
        selectedCategoryIds: [],
        authors,
        error: 'অনুগ্রহ করে পোস্টের শিরোনাম প্রদান করুন।',
        activeMenu: 'new_post',
        seo: generateSeoMeta({ title: 'নতুন লেখা যোগ করুন - এডমিন' }),
        toBengaliNumber
      });
    }

    let cleanContent = (content && content.trim()) 
      ? content.replace(/<span class="payasti-spell-error[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '$1')
      : `<p>${title.trim()}</p>`;

    let featuredImage = req.body.featured_image || '';
    if (req.file) {
      featuredImage = `/uploads/${req.file.filename}`;
    }

    let customSlug = (req.body.slug && req.body.slug.trim()) ? req.body.slug.trim() : '';
    let slug = generateEnglishSlug(customSlug || title) || `post-${Date.now()}`;
    const existingSlug = await db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug);
    if (existingSlug) {
      slug = `${slug}-${Date.now()}`;
    }

    let cleanExcerpt = (excerpt || '').trim();
    if (!cleanExcerpt) {
      cleanExcerpt = generateCleanExcerpt(cleanContent, 160);
    }

    const postAuthorId = author_id && !isNaN(parseInt(author_id, 10)) ? parseInt(author_id, 10) : req.user.id;
    
    // Category processing (single or multiple)
    const rawCatIds = req.body['category_ids[]'] || req.body.category_ids || req.body['category_id[]'] || req.body.category_id;
    let catIds = [];
    if (rawCatIds) {
      if (Array.isArray(rawCatIds)) {
        catIds = rawCatIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0);
      } else {
        const parsed = parseInt(rawCatIds, 10);
        if (!isNaN(parsed) && parsed > 0) catIds.push(parsed);
      }
    }

    if (catIds.length === 0 && categories && categories.length > 0) {
      catIds.push(categories[0].id);
    }

    let postCategoryId = null;
    let postSubcategoryId = null;

    const catMap = new Map();
    categories.forEach(c => catMap.set(c.id, c));

    for (const cId of catIds) {
      const catObj = catMap.get(cId);
      if (catObj) {
        if (!catObj.parent_id || catObj.parent_id === 0) {
          if (!postCategoryId) {
            postCategoryId = catObj.id;
          }
        } else {
          if (!postSubcategoryId) {
            postSubcategoryId = catObj.id;
          }
          if (!postCategoryId) {
            postCategoryId = catObj.parent_id;
          }
        }
      }
    }
    if (!postCategoryId && catIds.length > 0) {
      postCategoryId = catIds[0];
    }

    const postStatus = status || 'publish';
    const postFeatured = is_featured === '1' ? 1 : 0;
    
    // Rating logic
    const enableRating = req.body.enable_rating === '1';
    let postRatingScore = 0.00;
    let postRatingCount = 0;
    if (enableRating && req.body.rating_score && !isNaN(parseFloat(req.body.rating_score))) {
      postRatingScore = Math.min(5.0, Math.max(1.0, parseFloat(req.body.rating_score)));
      postRatingCount = 1;
    }

    const insertResult = await db.prepare(`
      INSERT INTO posts (author_id, title, slug, content, excerpt, featured_image, category_id, subcategory_id, status, views, is_featured, rating_score, rating_count, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NOW(), NOW(), NOW())
    `).run(
      postAuthorId,
      title.trim(),
      slug,
      cleanContent,
      cleanExcerpt,
      featuredImage,
      postCategoryId,
      postSubcategoryId,
      postStatus,
      postFeatured,
      postRatingScore,
      postRatingCount
    );

    const newPostId = insertResult.insertId || insertResult.lastInsertRowid;

    // Save relations into post_categories
    if (newPostId && catIds.length > 0) {
      try {
        for (const cId of catIds) {
          await db.prepare('INSERT IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)').run(newPostId, cId);
        }
        if (postCategoryId) {
          await db.prepare('INSERT IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)').run(newPostId, postCategoryId);
        }
        if (postSubcategoryId) {
          await db.prepare('INSERT IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)').run(newPostId, postSubcategoryId);
        }
      } catch (catRelErr) {
        console.warn('post_categories insert warning:', catRelErr.message);
      }
    }

    // Save relations into post_tags
    if (newPostId && req.body.tags) {
      await syncPostTags(newPostId, req.body.tags);
    }

    res.redirect('/admin/posts');
  } catch (err) {
    console.error('Error in postNewPost:', err);
    try {
      const categories = await db.prepare('SELECT id, name FROM categories ORDER BY name ASC').all();
      const authors = await db.prepare('SELECT id, display_name, username, role FROM users ORDER BY display_name ASC').all();
      return res.render('admin/post_new', {
        user: req.user,
        categories,
        authors,
        error: 'পোস্ট সংরক্ষণ করতে সমস্যা হয়েছে: ' + (err.message || 'অজানা ত্রুটি'),
        activeMenu: 'new_post',
        seo: generateSeoMeta({ title: 'নতুন লেখা যোগ করুন - এডমিন' }),
        toBengaliNumber
      });
    } catch (e) {
      res.redirect('/admin/posts');
    }
  }
};

// Edit Post GET
exports.getEditPost = async (req, res) => {
  try {
    const { id } = req.params;
    const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(id);

    if (!post) {
      return res.redirect('/admin/posts');
    }

    const categories = await db.prepare('SELECT id, name, parent_id FROM categories ORDER BY name ASC').all();
    const authors = await db.prepare('SELECT id, display_name, username, role FROM users ORDER BY display_name ASC').all();
    
    let postCategories = [];
    try {
      postCategories = await db.prepare('SELECT category_id FROM post_categories WHERE post_id = ?').all(id);
    } catch (e) {}

    let selectedCategoryIds = (postCategories && postCategories.length > 0)
      ? postCategories.map(r => r.category_id)
      : [post.category_id, post.subcategory_id].filter(Boolean);

    let postTags = [];
    try {
      postTags = await db.prepare(`
        SELECT t.id, t.name, t.slug 
        FROM tags t 
        JOIN post_tags pt ON t.id = pt.tag_id 
        WHERE pt.post_id = ?
        ORDER BY t.name ASC
      `).all(id);
    } catch (e) {}

    const allTags = await db.prepare('SELECT id, name, slug FROM tags ORDER BY name ASC').all();

    const seo = generateSeoMeta({ title: `লেখা সম্পাদনা: ${post.title}` });

    res.render('admin/post_edit', {
      user: req.user,
      post,
      categories,
      selectedCategoryIds,
      authors,
      postTags: postTags || [],
      allTags: allTags || [],
      error: null,
      activeMenu: 'all_posts',
      seo,
      toBengaliNumber,
      formatBengaliDate
    });
  } catch (err) {
    console.error('Error in getEditPost:', err);
    res.redirect('/admin/posts');
  }
};

// Edit Post POST
exports.postEditPost = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, slug: customSlug, author_id, excerpt, content, status, is_featured, enable_rating, rating_score } = req.body;
    const categories = await db.prepare('SELECT id, name, parent_id FROM categories ORDER BY name ASC').all();

    const existingPost = await db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    if (!existingPost) {
      return res.redirect('/admin/posts');
    }

    let updatedSlug = existingPost.slug;
    if (customSlug && customSlug.trim()) {
      const generatedSlug = generateEnglishSlug(customSlug.trim());
      if (generatedSlug && generatedSlug !== existingPost.slug) {
        const dup = await db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').get(generatedSlug, id);
        updatedSlug = dup ? `${generatedSlug}-${Date.now()}` : generatedSlug;
      }
    }

    let featuredImage = req.body.featured_image !== undefined ? req.body.featured_image : existingPost.featured_image;
    if (req.file) {
      featuredImage = `/uploads/${req.file.filename}`;
    }

    let cleanContent = (content !== undefined && content.trim() !== '' ? content : (existingPost.content || ''))
      .replace(/<span class="payasti-spell-error[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '$1');

    let cleanExcerpt = (excerpt || '').trim();
    if (!cleanExcerpt) {
      cleanExcerpt = generateCleanExcerpt(cleanContent, 160);
    }

    const postTitle = (title || existingPost.title || '').trim();
    const postAuthorId = author_id && !isNaN(parseInt(author_id, 10)) ? parseInt(author_id, 10) : (existingPost.author_id || req.user.id);
    
    // Category processing (single or multiple)
    const rawCatIds = req.body['category_ids[]'] || req.body.category_ids || req.body['category_id[]'] || req.body.category_id;
    let catIds = [];
    if (rawCatIds) {
      if (Array.isArray(rawCatIds)) {
        catIds = rawCatIds.map(cId => parseInt(cId, 10)).filter(cId => !isNaN(cId) && cId > 0);
      } else {
        const parsed = parseInt(rawCatIds, 10);
        if (!isNaN(parsed) && parsed > 0) catIds.push(parsed);
      }
    }

    if (catIds.length === 0) {
      if (rawCatIds !== undefined) {
        catIds = [existingPost.category_id || 1];
      } else if (existingPost.category_id || existingPost.subcategory_id) {
        catIds = [existingPost.category_id, existingPost.subcategory_id].filter(Boolean);
      }
    }

    let postCategoryId = null;
    let postSubcategoryId = null;

    const catMap = new Map();
    categories.forEach(c => catMap.set(c.id, c));

    for (const cId of catIds) {
      const catObj = catMap.get(cId);
      if (catObj) {
        if (!catObj.parent_id || catObj.parent_id === 0) {
          if (!postCategoryId) {
            postCategoryId = catObj.id;
          }
        } else {
          if (!postSubcategoryId) {
            postSubcategoryId = catObj.id;
          }
          if (!postCategoryId) {
            postCategoryId = catObj.parent_id;
          }
        }
      }
    }
    if (!postCategoryId && catIds.length > 0) {
      postCategoryId = catIds[0];
    }

    const postStatus = status || existingPost.status;
    const postFeatured = is_featured === '1' ? 1 : 0;

    // Rating logic
    const isRatingEnabled = enable_rating === '1';
    let postRatingScore = 0.00;
    let postRatingCount = 0;
    if (isRatingEnabled) {
      if (rating_score && !isNaN(parseFloat(rating_score))) {
        postRatingScore = Math.min(5.0, Math.max(1.0, parseFloat(rating_score)));
      } else {
        postRatingScore = 4.80;
      }
      postRatingCount = existingPost.rating_count > 0 ? existingPost.rating_count : 1;
    }

    // Set published_at if moving to publish for the first time
    let publishedAt = existingPost.published_at;
    if (postStatus === 'publish' && !publishedAt) {
      publishedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
    }

    await db.prepare(`
      UPDATE posts
      SET title = ?, slug = ?, author_id = ?, category_id = ?, subcategory_id = ?, excerpt = ?, content = ?, featured_image = ?, status = ?, is_featured = ?, rating_score = ?, rating_count = ?, published_at = ?, updated_at = NOW()
      WHERE id = ?
    `).run(
      postTitle,
      updatedSlug,
      postAuthorId,
      postCategoryId,
      postSubcategoryId,
      cleanExcerpt,
      cleanContent,
      featuredImage,
      postStatus,
      postFeatured,
      postRatingScore,
      postRatingCount,
      publishedAt,
      id
    );

    // Sync post_categories relations
    try {
      await db.prepare('DELETE FROM post_categories WHERE post_id = ?').run(id);
      for (const cId of catIds) {
        await db.prepare('INSERT IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)').run(id, cId);
      }
      if (postCategoryId) {
        await db.prepare('INSERT IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)').run(id, postCategoryId);
      }
      if (postSubcategoryId) {
        await db.prepare('INSERT IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)').run(id, postSubcategoryId);
      }
    } catch (catSyncErr) {
      console.warn('post_categories sync warning:', catSyncErr.message);
    }

    // Sync post_tags relations
    if (id && req.body.tags !== undefined) {
      await syncPostTags(id, req.body.tags);
    }

    res.redirect('/admin/posts');
  } catch (err) {
    console.error('Error in postEditPost:', err);
    res.redirect('/admin/posts');
  }
};

// API: Suggest bilingual tags from title & content
exports.apiSuggestTags = async (req, res) => {
  try {
    const { title, content } = req.body;
    const suggestedTags = extractBilingualTags(title || '', content || '', 10);
    res.json({ success: true, tags: suggestedTags });
  } catch (err) {
    console.error('Error in apiSuggestTags:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Delete Post Action
exports.deletePost = async (req, res) => {
  const { id } = req.params;
  try {
    await db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(id);
    await db.prepare('DELETE FROM comments WHERE post_id = ?').run(id);
    await db.prepare('DELETE FROM posts WHERE id = ?').run(id);
  } catch (err) {
    console.error('Error deleting post:', err);
  }
  res.redirect('/admin/posts');
};

// Migrate all remaining Bengali slugs to English (Admin Action)
exports.postMigrateSlugs = async (req, res) => {
  try {
    const posts = await db.prepare('SELECT id, title, slug FROM posts ORDER BY id ASC').all();
    const usedSlugs = new Set();
    
    posts.forEach(p => {
      const hasBangla = /[\u0980-\u09FF]/.test(p.slug || '');
      if (!hasBangla && p.slug) {
        usedSlugs.add(p.slug);
      }
    });

    let updatedCount = 0;
    for (const post of posts) {
      const hasBangla = /[\u0980-\u09FF]/.test(post.slug || '');
      if (!hasBangla && post.slug && post.slug.trim()) continue;

      let baseSlug = generateEnglishSlug(post.title) || `post-${post.id}`;
      let finalSlug = baseSlug;
      let counter = 2;

      while (usedSlugs.has(finalSlug)) {
        finalSlug = `${baseSlug}-${counter}`;
        counter++;
      }

      usedSlugs.add(finalSlug);
      await db.prepare('UPDATE posts SET slug = ? WHERE id = ?').run(finalSlug, post.id);
      updatedCount++;
    }

    res.json({ success: true, updatedCount, message: `মোট ${updatedCount}টি পোস্টের পারমালিংক সফলভাবে ইংরেজিতে রূপান্তরিত হয়েছে।` });
  } catch (err) {
    console.error('Error in postMigrateSlugs:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ==========================================
// 3. PENDING POSTS QUEUE
// ==========================================
exports.getPendingPosts = async (req, res) => {
  try {
    const pendingPosts = await db.prepare(`
      SELECT p.*, u.display_name AS author_name, u.email AS author_email, c.name AS category_name
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'pending'
      ORDER BY p.id DESC
    `).all();

    const seo = generateSeoMeta({ title: 'পেন্ডিং লেখা অনুমোদন - এডমিন' });

    res.render('admin/pending_posts', {
      user: req.user,
      pendingPosts,
      activeMenu: 'pending_posts',
      seo,
      toBengaliNumber,
      formatBengaliDate
    });
  } catch (err) {
    console.error('Error in getPendingPosts:', err);
    res.redirect('/admin');
  }
};

exports.approvePost = async (req, res) => {
  const { id } = req.params;
  try {
    await db.prepare("UPDATE posts SET status = 'publish', published_at = NOW(), updated_at = NOW() WHERE id = ?").run(id);
  } catch (err) {
    console.error('Error approving post:', err);
  }
  res.redirect(req.headers.referer || '/admin/pending');
};

exports.rejectPost = async (req, res) => {
  const { id } = req.params;
  try {
    await db.prepare("UPDATE posts SET status = 'draft', updated_at = NOW() WHERE id = ?").run(id);
  } catch (err) {
    console.error('Error rejecting post:', err);
  }
  res.redirect(req.headers.referer || '/admin/pending');
};

// ==========================================
// 4. AUTHORS & USERS MANAGEMENT
// ==========================================
exports.getUsers = async (req, res) => {
  try {
    const roleFilter = req.query.role || 'all';
    const statusFilter = req.query.status || 'all';
    const searchQuery = (req.query.q || '').trim();

    let whereClauses = [];
    let params = [];

    if (roleFilter && roleFilter !== 'all') {
      whereClauses.push('u.role = ?');
      params.push(roleFilter);
    }

    if (statusFilter === 'pending_approval') {
      whereClauses.push("(u.status = 'pending_approval' OR (u.role = 'author' AND u.is_approved = 0 AND u.email_verified = 1))");
    } else if (statusFilter === 'pending_verification') {
      whereClauses.push("(u.status = 'pending_verification' OR u.email_verified = 0)");
    } else if (statusFilter === 'active') {
      whereClauses.push("(u.status = 'active' AND (u.is_approved = 1 OR u.role = 'admin'))");
    } else if (statusFilter === 'suspended') {
      whereClauses.push("u.status = 'suspended'");
    }

    if (searchQuery) {
      whereClauses.push('(u.display_name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)');
      params.push(`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const users = await db.prepare(`
      SELECT u.*, 
        (SELECT COUNT(*) FROM posts WHERE author_id = u.id) AS post_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND status = 'publish') AS published_count
      FROM users u
      ${whereSql}
      ORDER BY u.id DESC
    `).all(...params);

    // Stats for user roles & approval statuses
    const totalRow = await db.prepare("SELECT COUNT(*) AS total FROM users").get();
    const adminRow = await db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'").get();
    const editorRow = await db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'editor'").get();
    const authorRow = await db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'author'").get();
    const pendingApprovalRow = await db.prepare("SELECT COUNT(*) AS total FROM users WHERE status = 'pending_approval' OR (role = 'author' AND is_approved = 0 AND email_verified = 1)").get();
    const pendingVerificationRow = await db.prepare("SELECT COUNT(*) AS total FROM users WHERE status = 'pending_verification' OR email_verified = 0").get();

    const totalUsers = totalRow ? totalRow.total : 0;
    const totalAdmins = adminRow ? adminRow.total : 0;
    const totalEditors = editorRow ? editorRow.total : 0;
    const totalAuthors = authorRow ? authorRow.total : 0;
    const totalPendingApproval = pendingApprovalRow ? pendingApprovalRow.total : 0;
    const totalPendingVerification = pendingVerificationRow ? pendingVerificationRow.total : 0;

    const seo = generateSeoMeta({ title: 'লেখক ও ইউজার তালিকা - এডমিন' });

    res.render('admin/users', {
      user: req.user,
      users,
      roleFilter,
      statusFilter,
      searchQuery,
      userStats: {
        total: totalUsers,
        admins: totalAdmins,
        editors: totalEditors,
        authors: totalAuthors,
        pendingApproval: totalPendingApproval,
        pendingVerification: totalPendingVerification
      },
      activeMenu: 'manage_users',
      seo,
      toBengaliNumber,
      formatBengaliDate
    });
  } catch (err) {
    console.error('Error in getUsers:', err);
    res.redirect('/admin');
  }
};

// New User GET
exports.getNewUser = (req, res) => {
  const seo = generateSeoMeta({ title: 'নতুন লেখক/ইউজার তৈরি - এডমিন' });
  res.render('admin/user_new', {
    user: req.user,
    error: null,
    activeMenu: 'manage_users',
    seo,
    toBengaliNumber
  });
};

// New User POST
exports.postNewUser = async (req, res) => {
  try {
    const { display_name, username, email, password, role, bio } = req.body;

    if (!display_name || !username || !email || !password) {
      return res.render('admin/user_new', {
        user: req.user,
        error: 'অনুগ্রহ করে পূর্ণ নাম, ইউজারনেম, ইমেইল এবং পাসওয়ার্ড প্রদান করুন।',
        activeMenu: 'manage_users',
        seo: generateSeoMeta({ title: 'নতুন লেখক/ইউজার তৈরি - এডমিন' }),
        toBengaliNumber
      });
    }

    // Check unique username or email
    const existingUser = await db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username.trim(), email.trim());
    if (existingUser) {
      return res.render('admin/user_new', {
        user: req.user,
        error: 'এই ইউজারনেম বা ইমেইল দিয়ে ইতিমধ্যে অ্যাকাউন্ট তৈরি করা আছে।',
        activeMenu: 'manage_users',
        seo: generateSeoMeta({ title: 'নতুন লেখক/ইউজার তৈরি - এডমিন' }),
        toBengaliNumber
      });
    }

    let avatar = req.body.avatar || '';
    if (req.file) {
      avatar = `/uploads/${req.file.filename}`;
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const userRole = role || 'author';

    await db.prepare(`
      INSERT INTO users (display_name, username, email, password, role, avatar, bio, registered_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `).run(
      display_name.trim(),
      username.trim().toLowerCase(),
      email.trim().toLowerCase(),
      hashedPassword,
      userRole,
      avatar,
      bio ? bio.trim() : ''
    );

    res.redirect('/admin/users');
  } catch (err) {
    console.error('Error in postNewUser:', err);
    res.redirect('/admin/users');
  }
};

// Edit User GET
exports.getEditUser = async (req, res) => {
  try {
    const { id } = req.params;
    const targetUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);

    if (!targetUser) {
      return res.redirect('/admin/users');
    }

    const seo = generateSeoMeta({ title: `লেখক সম্পাদনা: ${targetUser.display_name}` });

    res.render('admin/user_edit', {
      user: req.user,
      targetUser,
      error: null,
      activeMenu: 'manage_users',
      seo,
      toBengaliNumber,
      formatBengaliDate
    });
  } catch (err) {
    console.error('Error in getEditUser:', err);
    res.redirect('/admin/users');
  }
};

// Edit User POST
exports.postEditUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { display_name, email, role, bio, new_password } = req.body;

    const targetUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!targetUser) {
      return res.redirect('/admin/users');
    }

    let avatar = req.body.avatar !== undefined ? req.body.avatar : targetUser.avatar;
    if (req.file) {
      avatar = `/uploads/${req.file.filename}`;
    }

    let password = targetUser.password;
    if (new_password && new_password.trim().length >= 6) {
      password = bcrypt.hashSync(new_password.trim(), 10);
    }

    await db.prepare(`
      UPDATE users
      SET display_name = ?, email = ?, role = ?, avatar = ?, bio = ?, password = ?
      WHERE id = ?
    `).run(
      display_name.trim(),
      email.trim().toLowerCase(),
      role || targetUser.role,
      avatar,
      bio ? bio.trim() : '',
      password,
      id
    );

    res.redirect('/admin/users');
  } catch (err) {
    console.error('Error in postEditUser:', err);
    res.redirect('/admin/users');
  }
};

// Delete User Action
exports.deleteUser = async (req, res) => {
  const { id } = req.params;

  // Prevent deleting currently logged-in account
  if (parseInt(req.user.id, 10) === parseInt(id, 10)) {
    return res.redirect('/admin/users');
  }

  try {
    // Reassign posts to administrator (id 1)
    await db.prepare('UPDATE posts SET author_id = 1 WHERE author_id = ?').run(id);
    await db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(id);
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  } catch (err) {
    console.error('Error deleting user:', err);
  }

  res.redirect('/admin/users');
};

// Approve User Action (Admin) POST
exports.approveUser = async (req, res) => {
  const { id } = req.params;
  try {
    const targetUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (targetUser) {
      await db.prepare("UPDATE users SET is_approved = 1, email_verified = 1, status = 'active' WHERE id = ?").run(id);
      sendAccountApprovedEmail(targetUser).catch(e => {
        console.warn('[MAIL ERROR] approveUser notification email failed:', e.message);
      });
    }
  } catch (err) {
    console.error('Error approving user:', err);
  }
  res.redirect(req.headers.referer || '/admin/users');
};

// ==========================================
// 5. MANAGE BOOKS
// ==========================================
exports.getManageBooks = async (req, res) => {
  try {
    const books = await db.prepare('SELECT * FROM books ORDER BY id DESC').all();
    const seo = generateSeoMeta({ title: 'বই সম্ভার ব্যবস্থাপনা' });

    res.render('admin/manage_books', {
      user: req.user,
      books,
      error: null,
      success: null,
      activeMenu: 'manage_books',
      seo,
      toBengaliNumber,
      formatBengaliDate
    });
  } catch (err) {
    console.error('Error in getManageBooks:', err);
    res.redirect('/admin');
  }
};

exports.postAddBook = async (req, res) => {
  try {
    const { title, author_name, regular_price, discounted_price, order_url, description } = req.body;

    let coverImage = req.body.cover_image || '';
    if (req.file) {
      coverImage = `/uploads/${req.file.filename}`;
    }

    const slug = (title || `book-${Date.now()}`).toLowerCase().replace(/\s+/g, '-');

    await db.prepare(`
      INSERT INTO books (title, slug, author_name, cover_image, regular_price, discounted_price, order_url, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, slug, author_name, coverImage, regular_price, discounted_price, order_url, description);

    res.redirect('/admin/books');
  } catch (err) {
    console.error('Error in postAddBook:', err);
    res.redirect('/admin/books');
  }
};

exports.deleteBook = async (req, res) => {
  const { id } = req.params;
  try {
    await db.prepare('DELETE FROM books WHERE id = ?').run(id);
  } catch (err) {
    console.error('Error deleting book:', err);
  }
  res.redirect('/admin/books');
};

// ==========================================
// 6. CATEGORIES & TAGS (Under Posts Submenu)
// ==========================================
exports.getCategories = async (req, res) => {
  try {
    const categories = await db.prepare(`
      SELECT c.*, 
        p.name AS parent_name,
        p.slug AS parent_slug,
        (SELECT COUNT(*) FROM posts WHERE category_id = c.id OR subcategory_id = c.id) AS post_count,
        (SELECT COUNT(*) FROM categories WHERE parent_id = c.id) AS subcategory_count
      FROM categories c
      LEFT JOIN categories p ON c.parent_id = p.id
      ORDER BY 
        CASE WHEN (c.parent_id IS NULL OR c.parent_id = 0) THEN c.name ELSE p.name END ASC,
        CASE WHEN (c.parent_id IS NULL OR c.parent_id = 0) THEN 0 ELSE 1 END ASC,
        c.name ASC
    `).all();

    const rootCategories = categories.filter(c => !c.parent_id || c.parent_id === 0);
    const subCategories = categories.filter(c => c.parent_id && c.parent_id > 0);

    const seo = generateSeoMeta({ title: 'বিভাগ / ক্যাটাগরি - এডমিন' });

    res.render('admin/categories', {
      user: req.user,
      categories,
      rootCategories,
      subCategories,
      error: null,
      activeMenu: 'posts_categories',
      openSubmenu: 'posts',
      seo,
      toBengaliNumber
    });
  } catch (err) {
    console.error('Error in getCategories:', err);
    res.redirect('/admin');
  }
};

exports.postAddCategory = async (req, res) => {
  try {
    const { name, slug, description, parent_id, is_ajax } = req.body;
    if (!name || !name.trim()) {
      if (req.xhr || req.headers.accept?.includes('json') || is_ajax) {
        return res.status(400).json({ success: false, error: 'ক্যাটাগরির নাম প্রদান করুন।' });
      }
      return res.redirect('/admin/categories');
    }

    let catSlug = (slug && slug.trim()) ? generateEnglishSlug(slug.trim()) : generateEnglishSlug(name.trim());
    if (!catSlug) catSlug = `cat-${Date.now()}`;
    const existing = await db.prepare('SELECT id FROM categories WHERE slug = ?').get(catSlug);
    if (existing) {
      catSlug = `${catSlug}-${Date.now()}`;
    }

    const parentId = parent_id && !isNaN(parseInt(parent_id, 10)) ? parseInt(parent_id, 10) : 0;

    const result = await db.prepare(`
      INSERT INTO categories (name, slug, description, parent_id, count)
      VALUES (?, ?, ?, ?, 0)
    `).run(name.trim(), catSlug, description ? description.trim() : '', parentId);

    const newId = result.insertId || result.lastInsertRowid;

    if (req.xhr || req.headers.accept?.includes('json') || is_ajax) {
      return res.json({
        success: true,
        category: {
          id: newId,
          name: name.trim(),
          slug: catSlug,
          parent_id: parentId
        }
      });
    }

    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Error in postAddCategory:', err);
    if (req.xhr || req.headers.accept?.includes('json') || req.body.is_ajax) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.redirect('/admin/categories');
  }
};

exports.postEditCategory = async (req, res) => {
  const { id } = req.params;
  try {
    const { name, slug, description, parent_id } = req.body;
    if (!name || !name.trim()) {
      return res.redirect('/admin/categories');
    }

    const existingCat = await db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existingCat) {
      return res.redirect('/admin/categories');
    }

    let catSlug = (slug && slug.trim()) ? slugify(slug.trim(), { lower: true, strict: false }) : slugify(name.trim(), { lower: true, strict: false });
    if (!catSlug) catSlug = `category-${id}`;

    // Check slug uniqueness (excluding current category)
    const duplicateSlug = await db.prepare('SELECT id FROM categories WHERE slug = ? AND id != ?').get(catSlug, id);
    if (duplicateSlug) {
      catSlug = `${catSlug}-${Date.now()}`;
    }

    const parentId = parent_id && !isNaN(parseInt(parent_id, 10)) && parseInt(parent_id, 10) !== parseInt(id, 10) ? parseInt(parent_id, 10) : 0;

    await db.prepare(`
      UPDATE categories 
      SET name = ?, slug = ?, description = ?, parent_id = ?
      WHERE id = ?
    `).run(name.trim(), catSlug, description ? description.trim() : '', parentId, id);

    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Error in postEditCategory:', err);
    res.redirect('/admin/categories');
  }
};

exports.deleteCategory = async (req, res) => {
  const { id } = req.params;
  try {
    await db.prepare('UPDATE posts SET category_id = 8 WHERE category_id = ?').run(id);
    await db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  } catch (err) {
    console.error('Error deleting category:', err);
  }
  res.redirect('/admin/categories');
};

exports.getTags = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 80;
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const sort = req.query.sort || 'popular';

    let countSql = 'SELECT COUNT(*) AS total FROM tags';
    let countParams = [];

    let selectSql = `
      SELECT t.id, t.name, t.slug,
        (SELECT COUNT(*) FROM post_tags WHERE tag_id = t.id) AS post_count
      FROM tags t
    `;
    let selectParams = [];

    if (search) {
      countSql += ' WHERE name LIKE ? OR slug LIKE ?';
      countParams.push(`%${search}%`, `%${search}%`);

      selectSql += ' WHERE t.name LIKE ? OR t.slug LIKE ?';
      selectParams.push(`%${search}%`, `%${search}%`);
    }

    const totalRow = await db.prepare(countSql).get(...countParams);
    const totalTags = totalRow ? totalRow.total : 0;
    const totalPages = Math.ceil(totalTags / limit) || 1;

    if (sort === 'az') {
      selectSql += ' ORDER BY t.name ASC';
    } else if (sort === 'newest') {
      selectSql += ' ORDER BY t.id DESC';
    } else if (sort === 'unused') {
      selectSql += ' ORDER BY post_count ASC, t.id DESC';
    } else {
      selectSql += ' ORDER BY post_count DESC, t.id DESC';
    }

    selectSql += ' LIMIT ? OFFSET ?';
    selectParams.push(limit, offset);

    const tags = await db.prepare(selectSql).all(...selectParams);

    const seo = generateSeoMeta({ title: 'ট্যাগ সমূহ - এডমিন' });

    res.render('admin/tags', {
      user: req.user,
      tags,
      pagination: {
        page,
        limit,
        totalPages,
        totalItems: totalTags,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevPage: page - 1,
        nextPage: page + 1
      },
      search,
      sort,
      error: null,
      activeMenu: 'posts_tags',
      openSubmenu: 'posts',
      seo,
      toBengaliNumber
    });
  } catch (err) {
    console.error('Error in getTags:', err);
    res.redirect('/admin');
  }
};

exports.postAddTag = async (req, res) => {
  try {
    const { name, slug } = req.body;
    if (!name || !name.trim()) {
      return res.redirect('/admin/tags');
    }

    let tagSlug = (slug || slugify(name, { lower: true, strict: false })).trim();
    const existing = await db.prepare('SELECT id FROM tags WHERE slug = ?').get(tagSlug);
    if (existing) {
      tagSlug = `${tagSlug}-${Date.now()}`;
    }

    await db.prepare('INSERT INTO tags (name, slug) VALUES (?, ?)').run(name.trim(), tagSlug);
    res.redirect(req.headers.referer || '/admin/tags');
  } catch (err) {
    console.error('Error in postAddTag:', err);
    res.redirect('/admin/tags');
  }
};

exports.postEditTag = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug } = req.body;
    if (!name || !name.trim()) {
      return res.redirect('/admin/tags');
    }

    let tagSlug = (slug || slugify(name, { lower: true, strict: false })).trim();
    const existing = await db.prepare('SELECT id FROM tags WHERE slug = ? AND id != ?').get(tagSlug, id);
    if (existing) {
      tagSlug = `${tagSlug}-${Date.now()}`;
    }

    await db.prepare('UPDATE tags SET name = ?, slug = ? WHERE id = ?').run(name.trim(), tagSlug, id);
    res.redirect(req.headers.referer || '/admin/tags');
  } catch (err) {
    console.error('Error in postEditTag:', err);
    res.redirect('/admin/tags');
  }
};

exports.deleteTag = async (req, res) => {
  const { id } = req.params;
  try {
    await db.prepare('DELETE FROM post_tags WHERE tag_id = ?').run(id);
    await db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  } catch (err) {
    console.error('Error deleting tag:', err);
  }
  res.redirect(req.headers.referer || '/admin/tags');
};

exports.postBulkDeleteTags = async (req, res) => {
  try {
    let ids = req.body.tag_ids || req.body.ids;
    if (typeof ids === 'string') {
      try {
        const parsed = JSON.parse(ids);
        if (Array.isArray(parsed)) ids = parsed;
        else ids = ids.split(',');
      } catch (e) {
        ids = ids.split(',');
      }
    }
    if (Array.isArray(ids)) {
      const validIds = ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0);
      if (validIds.length > 0) {
        const placeholders = validIds.map(() => '?').join(',');
        await db.prepare(`DELETE FROM post_tags WHERE tag_id IN (${placeholders})`).run(...validIds);
        await db.prepare(`DELETE FROM tags WHERE id IN (${placeholders})`).run(...validIds);
      }
    }
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.json({ success: true, count: ids ? ids.length : 0 });
    }
  } catch (err) {
    console.error('Error in postBulkDeleteTags:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(500).json({ error: 'Failed to delete tags' });
    }
  }
  res.redirect(req.headers.referer || '/admin/tags');
};

// ==========================================
// 7. MEDIA LIBRARY
// ==========================================
exports.getMedia = (req, res) => {
  const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
  let mediaFiles = [];

  try {
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      mediaFiles = files.map(file => {
        const filePath = path.join(uploadsDir, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          url: `/uploads/${file}`,
          size: (stats.size / 1024).toFixed(1) + ' KB',
          createdAt: stats.birthtime || stats.mtime
        };
      }).reverse();
    }
  } catch (err) {
    console.error('Error reading media dir:', err);
  }

  const seo = generateSeoMeta({ title: 'মিডিয়া লাইব্রেরি - এডমিন' });

  res.render('admin/media', {
    user: req.user,
    mediaFiles,
    activeMenu: 'media',
    seo,
    toBengaliNumber,
    formatBengaliDate
  });
};

exports.postUploadMedia = (req, res) => {
  res.redirect('/admin/media');
};

exports.deleteMedia = (req, res) => {
  const { filename } = req.body;
  if (filename) {
    const cleanFilename = path.basename(filename);
    const targetPath = path.join(__dirname, '..', 'public', 'uploads', cleanFilename);
    try {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    } catch (err) {
      console.error('Error deleting media file:', err);
    }
  }
  res.redirect('/admin/media');
};

// ==========================================
// 8. COMMENTS
// ==========================================
exports.getComments = async (req, res) => {
  try {
    const comments = await db.prepare(`
      SELECT c.*, p.title AS post_title, p.slug AS post_slug
      FROM comments c
      LEFT JOIN posts p ON c.post_id = p.id
      ORDER BY c.id DESC
    `).all();

    const seo = generateSeoMeta({ title: 'মন্তব্য পরিচালনা - এডমিন' });

    res.render('admin/comments', {
      user: req.user,
      comments,
      activeMenu: 'comments',
      seo,
      toBengaliNumber,
      formatBengaliDate
    });
  } catch (err) {
    console.error('Error in getComments:', err);
    res.redirect('/admin');
  }
};

exports.approveComment = async (req, res) => {
  const { id } = req.params;
  try {
    await db.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").run(id);
  } catch (err) {
    console.error('Error approving comment:', err);
  }
  res.redirect('/admin/comments');
};

exports.deleteComment = async (req, res) => {
  const { id } = req.params;
  try {
    await db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  } catch (err) {
    console.error('Error deleting comment:', err);
  }
  res.redirect('/admin/comments');
};

// ==========================================
// 9. SETTINGS
// ==========================================
exports.getSettings = async (req, res) => {
  try {
    const { getSiteSettings } = require('../services/settingsService');
    const settingsMap = await getSiteSettings();

    const seo = generateSeoMeta({ title: 'সাইট সেটিংস - এডমিন' });

    res.render('admin/settings', {
      user: req.user,
      settings: settingsMap || {},
      success: req.query.saved === '1',
      activeMenu: 'settings',
      seo,
      toBengaliNumber
    });
  } catch (err) {
    console.error('Error in getSettings:', err);
    res.redirect('/admin');
  }
};

exports.postSettings = async (req, res) => {
  try {
    const { saveSiteSettings } = require('../services/settingsService');
    const { 
      site_title, 
      site_tagline, 
      site_description, 
      site_logo, 
      site_favicon, 
      contact_email, 
      contact_phone, 
      contact_address,
      facebook_url,
      youtube_url,
      twitter_url,
      instagram_url,
      linkedin_url,
      footer_about_text,
      footer_affiliate_notice,
      footer_copyright_text
    } = req.body;

    await saveSiteSettings({
      site_title: site_title || '',
      site_tagline: site_tagline || '',
      site_description: site_description || '',
      site_logo: site_logo || '',
      site_favicon: site_favicon || '',
      contact_email: contact_email || '',
      contact_phone: contact_phone || '',
      contact_address: contact_address || '',
      facebook_url: facebook_url || '',
      youtube_url: youtube_url || '',
      twitter_url: twitter_url || '',
      instagram_url: instagram_url || '',
      linkedin_url: linkedin_url || '',
      footer_about_text: footer_about_text || '',
      footer_affiliate_notice: footer_affiliate_notice || '',
      footer_copyright_text: footer_copyright_text || ''
    });

    res.redirect('/admin/settings?saved=1');
  } catch (err) {
    console.error('Error in postSettings:', err);
    res.redirect('/admin/settings');
  }
};

// ==========================================
// 10. HEADER MENU MANAGEMENT
// ==========================================
exports.getMenu = async (req, res) => {
  try {
    const { getNavMenu } = require('../services/menuService');
    const categories = await db.prepare('SELECT id, name, slug, count FROM categories ORDER BY count DESC, name ASC').all();
    const currentMenu = await getNavMenu();

    const seo = generateSeoMeta({ title: 'হেডার মেনু ব্যবস্থাপনা - এডমিন' });

    res.render('admin/menu', {
      user: req.user,
      categories: categories || [],
      currentMenu: currentMenu || [],
      success: req.query.saved === '1',
      activeMenu: 'menu',
      seo,
      toBengaliNumber
    });
  } catch (err) {
    console.error('Error in getMenu:', err);
    res.redirect('/admin');
  }
};

exports.postMenu = async (req, res) => {
  try {
    const { saveNavMenu } = require('../services/menuService');
    let menuItems = [];

    if (req.body.menu_json !== undefined) {
      try {
        menuItems = typeof req.body.menu_json === 'string' ? JSON.parse(req.body.menu_json) : req.body.menu_json;
      } catch (e) {
        console.error('Error parsing menu_json:', e);
        menuItems = [];
      }
    } else if (req.body.categories) {
      // Fallback if simple checkbox array is submitted
      const selectedSlugs = Array.isArray(req.body.categories) ? req.body.categories : [req.body.categories];
      const categories = await db.prepare('SELECT id, name, slug FROM categories').all();
      const catMap = {};
      categories.forEach(c => { catMap[c.slug] = c; });

      menuItems.push({ title: 'হোম', url: '/' });
      selectedSlugs.forEach(slug => {
        if (catMap[slug]) {
          menuItems.push({
            title: catMap[slug].name,
            url: `/category/${catMap[slug].slug}`,
            slug: catMap[slug].slug
          });
        }
      });
    }

    await saveNavMenu(menuItems);
    res.redirect('/admin/menu?saved=1');
  } catch (err) {
    console.error('Error in postMenu:', err);
    res.redirect('/admin/menu');
  }
};

