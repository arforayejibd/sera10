const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Auth Routes
router.get('/login', authController.getLoginPage);
router.post('/login', authController.postLogin);
router.get('/register', authController.getRegisterPage);
router.post('/register', authController.postRegister);
router.get('/verify-email', authController.getVerifyEmail);
router.post('/resend-verification', authController.postResendVerification);
router.get('/logout', authController.logout);

// Forgot & Reset Password Routes
router.get('/forgot-password', authController.getForgotPasswordPage);
router.post('/forgot-password', authController.postForgotPassword);
router.get('/reset-password', authController.getResetPasswordPage);
router.post('/reset-password', authController.postResetPassword);

// Static Rules & Terms
router.get(['/spelling-rules', '/bangla-spell'], (req, res) => res.redirect(301, '/'));
router.get(['/terms', '/terms-and-condition'], authController.getTerms);

// XML Sitemap & Robots.txt for Google SEO
router.get('/sitemap.xml', authController.getSitemap);
router.get('/robots.txt', authController.getRobots);

module.exports = router;
