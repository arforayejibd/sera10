const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || '',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true
});

let isInitialized = false;

// Ensure MySQL tables exist with proper utf8mb4 collation
async function initDatabase() {
  if (isInitialized) return;
  try {
    const connection = await pool.getConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          wp_id INT UNIQUE,
          username VARCHAR(191) UNIQUE,
          email VARCHAR(191),
          password VARCHAR(255),
          display_name VARCHAR(255),
          nicename VARCHAR(255),
          role VARCHAR(50) DEFAULT 'author',
          avatar TEXT,
          bio TEXT,
          registered_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS categories (
          id INT AUTO_INCREMENT PRIMARY KEY,
          wp_term_id INT UNIQUE,
          wp_taxonomy_id INT,
          name VARCHAR(255),
          slug VARCHAR(191) UNIQUE,
          parent_id INT DEFAULT 0,
          description TEXT,
          count INT DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS tags (
          id INT AUTO_INCREMENT PRIMARY KEY,
          wp_term_id INT UNIQUE,
          name VARCHAR(255),
          slug VARCHAR(191) UNIQUE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS posts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          wp_id INT UNIQUE,
          author_id INT,
          title VARCHAR(500),
          slug VARCHAR(191),
          content LONGTEXT,
          excerpt TEXT,
          featured_image TEXT,
          category_id INT,
          subcategory_id INT,
          status VARCHAR(50) DEFAULT 'publish',
          views INT DEFAULT 0,
          is_featured TINYINT(1) DEFAULT 0,
          published_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_posts_author (author_id),
          INDEX idx_posts_category (category_id),
          INDEX idx_posts_slug (slug),
          INDEX idx_posts_status (status),
          INDEX idx_posts_published (published_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS post_tags (
          post_id INT NOT NULL,
          tag_id INT NOT NULL,
          PRIMARY KEY (post_id, tag_id),
          INDEX idx_post_tags_post (post_id),
          INDEX idx_post_tags_tag (tag_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS post_categories (
          post_id INT NOT NULL,
          category_id INT NOT NULL,
          PRIMARY KEY (post_id, category_id),
          INDEX idx_post_categories_post (post_id),
          INDEX idx_post_categories_category (category_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // Ensure post_categories is populated from existing posts
      try {
        await connection.query(`
          INSERT IGNORE INTO post_categories (post_id, category_id)
          SELECT id, category_id FROM posts WHERE category_id IS NOT NULL AND category_id > 0;
        `);
        await connection.query(`
          INSERT IGNORE INTO post_categories (post_id, category_id)
          SELECT id, subcategory_id FROM posts WHERE subcategory_id IS NOT NULL AND subcategory_id > 0;
        `);
      } catch (pcSyncErr) {}

      // Keep categories.count accurately synced with live published posts
      try {
        await connection.query(`
          UPDATE categories c 
          SET count = (
            SELECT COUNT(DISTINCT p.id) 
            FROM posts p 
            LEFT JOIN post_categories pc ON pc.post_id = p.id 
            WHERE p.status = 'publish' AND (p.category_id = c.id OR p.subcategory_id = c.id OR pc.category_id = c.id)
          );
        `);
      } catch (catCountErr) {}

      await connection.query(`
        CREATE TABLE IF NOT EXISTS books (
          id INT AUTO_INCREMENT PRIMARY KEY,
          wp_id INT UNIQUE,
          title VARCHAR(500),
          slug VARCHAR(191),
          author_name VARCHAR(255),
          author_id INT,
          cover_image TEXT,
          regular_price VARCHAR(50),
          discounted_price VARCHAR(50),
          order_url TEXT,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_books_slug (slug)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS comments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          wp_id INT UNIQUE,
          post_id INT,
          author_name VARCHAR(255),
          author_email VARCHAR(191),
          content TEXT,
          status VARCHAR(50) DEFAULT 'approved',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_comments_post (post_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS notices (
          id INT AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(500),
          content TEXT,
          type VARCHAR(50) DEFAULT 'notice',
          is_active TINYINT(1) DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS book_reviews (
          id INT AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(500) NOT NULL,
          author_name VARCHAR(255) NOT NULL,
          email VARCHAR(191) NOT NULL,
          mobile VARCHAR(50) NOT NULL,
          cover_image TEXT,
          description TEXT,
          rokomari_url TEXT,
          transaction_id VARCHAR(100) NOT NULL,
          payment_amount VARCHAR(50) DEFAULT '২০০ টাকা',
          payment_method VARCHAR(50) DEFAULT 'bkash',
          status VARCHAR(50) DEFAULT 'pending',
          admin_notes TEXT,
          ip_address VARCHAR(100),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_book_reviews_status (status),
          INDEX idx_book_reviews_email (email),
          INDEX idx_book_reviews_created (created_at),
          INDEX idx_book_reviews_trx (transaction_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS settings (
          \`key\` VARCHAR(191) PRIMARY KEY,
          \`value\` LONGTEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS password_resets (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          token VARCHAR(191) NOT NULL UNIQUE,
          expires_at DATETIME NOT NULL,
          used TINYINT(1) DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_password_resets_token (token)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS email_verifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          token VARCHAR(191) NOT NULL UNIQUE,
          expires_at DATETIME NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_email_verifications_token (token),
          INDEX idx_email_verifications_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS post_ratings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          post_id INT NOT NULL,
          user_id INT DEFAULT NULL,
          rating TINYINT NOT NULL,
          ip_address VARCHAR(100) DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_post_ratings_post (post_id),
          INDEX idx_post_ratings_user (post_id, user_id),
          INDEX idx_post_ratings_ip (post_id, ip_address)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS search_queries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          query VARCHAR(191) NOT NULL UNIQUE,
          count INT DEFAULT 1,
          last_searched_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_search_count (count DESC)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // Seed initial popular search queries if table is empty
      try {
        const [existingSearches] = await connection.query(`SELECT COUNT(*) AS total FROM search_queries`);
        if (existingSearches && existingSearches[0] && existingSearches[0].total === 0) {
          await connection.query(`
            INSERT IGNORE INTO search_queries (query, count, last_searched_at) VALUES
            ('স্মার্টফোন', 1, DATE_SUB(NOW(), INTERVAL 1 DAY)),
            ('সেরা বই', 1, DATE_SUB(NOW(), INTERVAL 1 DAY)),
            ('ল্যাপটপ', 1, DATE_SUB(NOW(), INTERVAL 1 DAY)),
            ('ফ্রিজ', 1, DATE_SUB(NOW(), INTERVAL 1 DAY)),
            ('স্মার্টওয়াচ', 1, DATE_SUB(NOW(), INTERVAL 1 DAY))
          `);
        }
      } catch (seedErr) {
        // ignore seed error
      }

      // Ensure rating columns exist on posts table
      try {
        const [postCols] = await connection.query(`
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'posts'
        `);
        const postColNames = postCols.map(c => c.COLUMN_NAME);
        if (!postColNames.includes('rating_score')) {
          await connection.query("ALTER TABLE posts ADD COLUMN rating_score DECIMAL(3,2) DEFAULT 0.00 AFTER views");
        }
        if (!postColNames.includes('rating_count')) {
          await connection.query("ALTER TABLE posts ADD COLUMN rating_count INT DEFAULT 0 AFTER rating_score");
        }
      } catch (e) {
        console.warn('Could not ensure posts rating columns:', e.message);
      }

      // Ensure new columns exist on users table for status, email_verified, is_approved
      try {
        const [userCols] = await connection.query(`
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
        `);
        const colNames = (userCols || []).map(c => c.COLUMN_NAME.toLowerCase());

        if (!colNames.includes('status')) {
          await connection.query("ALTER TABLE users ADD COLUMN status VARCHAR(50) DEFAULT 'active'");
        }
        if (!colNames.includes('email_verified')) {
          await connection.query("ALTER TABLE users ADD COLUMN email_verified TINYINT(1) DEFAULT 1");
        }
        if (!colNames.includes('is_approved')) {
          await connection.query("ALTER TABLE users ADD COLUMN is_approved TINYINT(1) DEFAULT 1");
        }
      } catch (colErr) {
        console.warn('⚠️ Column check on users table warning:', colErr.message);
      }

      // Ensure mrforayeji admin user exists
      try {
        const [existing] = await connection.query("SELECT * FROM users WHERE username = 'mrforayeji' OR email = 'mrforayeji@sera10.com'");
        const bcrypt = require('bcryptjs');
        const hashedPassword = bcrypt.hashSync('password123', 10);
        if (existing && existing.length > 0) {
          await connection.query(
            "UPDATE users SET password = ?, role = 'admin', status = 'active', email_verified = 1, is_approved = 1 WHERE id = ?",
            [hashedPassword, existing[0].id]
          );
          console.log('✅ mrforayeji admin user verified and active.');
        } else {
          await connection.query(
            "INSERT INTO users (username, email, password, display_name, nicename, role, status, email_verified, is_approved, registered_at) VALUES ('mrforayeji', 'mrforayeji@sera10.com', ?, 'এম আর ফরায়েজী', 'mrforayeji', 'admin', 'active', 1, 1, NOW())",
            [hashedPassword]
          );
          console.log('✅ mrforayeji admin user created.');
        }
      } catch (uErr) {
        console.warn('⚠️ User init warning:', uErr.message);
      }

      // Auto-migrate any Bengali slugs to English slugs
      try {
        const [allPosts] = await connection.query("SELECT id, title, slug FROM posts");
        const bnPosts = (allPosts || []).filter(p => /[\u0980-\u09FF]/.test(p.slug || ''));
        if (bnPosts.length > 0) {
          const { generateEnglishSlug } = require('../utils/slugify');
          const usedSlugs = new Set((allPosts || []).filter(p => !/[\u0980-\u09FF]/.test(p.slug || '')).map(p => p.slug));
          for (const p of bnPosts) {
            let baseSlug = generateEnglishSlug(p.title) || `post-${p.id}`;
            let finalSlug = baseSlug;
            let counter = 2;
            while (usedSlugs.has(finalSlug)) {
              finalSlug = `${baseSlug}-${counter}`;
              counter++;
            }
            usedSlugs.add(finalSlug);
            await connection.query("UPDATE posts SET slug = ? WHERE id = ?", [finalSlug, p.id]);
          }
          console.log(`✅ Auto-migrated ${bnPosts.length} Bengali slugs to clean English slugs.`);
        }
      } catch (bnErr) {
        console.warn('⚠️ Auto-migration slug warning:', bnErr.message);
      }

      isInitialized = true;
      console.log('✅ MySQL schema initialized successfully.');
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('⚠️ MySQL table initialization warning:', err.message);
  }
}

// Auto initialize on first import
initDatabase();

// Clean async helper functions matching SQLite ergonomics
const db = {
  pool,
  initDatabase,

  query: async (sql, params = []) => {
    const [results] = await pool.query(sql, params);
    return results;
  },

  all: async (sql, params = []) => {
    const [rows] = await pool.query(sql, params);
    return rows || [];
  },

  get: async (sql, params = []) => {
    const [rows] = await pool.query(sql, params);
    return rows && rows.length > 0 ? rows[0] : undefined;
  },

  run: async (sql, params = []) => {
    const [result] = await pool.query(sql, params);
    return {
      lastInsertRowid: result.insertId,
      insertId: result.insertId,
      changes: result.affectedRows,
      affectedRows: result.affectedRows
    };
  },

  // Helper to maintain compatibility if prepare(...) is called
  prepare: (sql) => {
    // Auto-replace SQLite INSERT OR REPLACE with MySQL REPLACE INTO
    let normalizedSql = sql;
    if (/INSERT\s+OR\s+REPLACE\s+INTO/i.test(normalizedSql)) {
      normalizedSql = normalizedSql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'REPLACE INTO');
    }

    return {
      get: async (...args) => {
        const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        return db.get(normalizedSql, flat);
      },
      all: async (...args) => {
        const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        return db.all(normalizedSql, flat);
      },
      run: async (...args) => {
        const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        return db.run(normalizedSql, flat);
      }
    };
  }
};

module.exports = db;
