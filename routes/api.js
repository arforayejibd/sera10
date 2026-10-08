const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Public image proxy endpoint (Must be before requireAuth for canvas image loading)
/**
 * GET /api/proxy-image
 * Proxies an external image URL to prevent CORS taint on HTML5 canvas
 */
router.get('/proxy-image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl || typeof imageUrl !== 'string') {
      return res.status(400).send('Image URL is required');
    }

    // Only allow http or https protocols
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return res.status(400).send('Invalid image URL protocol');
    }

    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch remote image');
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('Image proxy error:', err);
    res.status(500).send('Error proxying image');
  }
});

// Require authentication for all media upload & list API routes
router.use(requireAuth);

/**
 * GET /api/media
 * Returns a list of uploaded images from public/uploads
 */
router.get('/media', (req, res) => {
  const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
  const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];

  try {
    if (!fs.existsSync(uploadsDir)) {
      return res.json({ success: true, files: [] });
    }

    const fileNames = fs.readdirSync(uploadsDir);
    const files = [];

    for (const name of fileNames) {
      const ext = path.extname(name).toLowerCase();
      if (!validExtensions.includes(ext)) continue;

      const fullPath = path.join(uploadsDir, name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          files.push({
            filename: name,
            url: `/uploads/${name}`,
            size: (stat.size / 1024).toFixed(1) + ' KB',
            bytes: stat.size,
            mtime: stat.mtime
          });
        }
      } catch (err) {
        // Skip unreadable files
      }
    }

    // Sort by newest first
    files.sort((a, b) => b.mtime - a.mtime);

    res.json({ success: true, files });
  } catch (err) {
    console.error('Error fetching media files:', err);
    res.status(500).json({ success: false, error: 'মিডিয়া ফাইল লোড করতে সমস্যা হয়েছে।' });
  }
});

/**
 * POST /api/media/upload
 * Handles AJAX upload of a single media image
 */
router.post('/media/upload', (req, res) => {
  // Support both field name 'file' and 'media_file'
  const uploadHandler = upload.single('file');

  uploadHandler(req, res, function (err) {
    if (err) {
      console.error('API Media upload error:', err);
      return res.status(400).json({ 
        success: false, 
        error: err.message || 'ছবি আপলোড ব্যর্থ হয়েছে!' 
      });
    }

    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'কোনো ছবি নির্বাচন করা হয়নি।' 
      });
    }

    const fileData = {
      filename: req.file.filename,
      url: `/uploads/${req.file.filename}`,
      size: (req.file.size / 1024).toFixed(1) + ' KB',
      bytes: req.file.size,
      mtime: new Date()
    };

    res.json({
      success: true,
      message: 'ছবি সফলভাবে আপলোড হয়েছে!',
      file: fileData
    });
  });
});

module.exports = router;
