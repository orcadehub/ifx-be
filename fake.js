require('dotenv').config();
const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const session = require('express-session');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: 'http://localhost:3000', // your React app
  credentials: true
}));

app.use(express.json());

app.use(session({
  secret: 'your-session-secret',
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// User serialize/deserialize (for session)
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
  // Here you can find or create the user in your DB
  // For demo just returning profile
  done(null, profile);
}));

// Facebook OAuth Strategy
passport.use(new FacebookStrategy({
  clientID: process.env.FB_APP_ID,
  clientSecret: process.env.FB_APP_SECRET,
  callbackURL: '/auth/facebook/callback',
  profileFields: ['id', 'emails', 'name'] // request these fields from facebook
}, (accessToken, refreshToken, profile, done) => {
  // Find or create user
  done(null, profile);
}));

// Routes for Google login
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    // Generate JWT token or set session
    const token = jwt.sign({ id: req.user.id, email: req.user.emails[0].value }, 'your_jwt_secret');
    // Send token to client (can redirect with token or send token in response)
    res.redirect(`http://localhost:3000/login/success?token=${token}`);
  }
);

// Routes for Facebook login
app.get('/auth/facebook',
  passport.authenticate('facebook', { scope: ['email'] })
);

app.get('/auth/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: '/' }),
  (req, res) => {
    const token = jwt.sign({ id: req.user.id, email: req.user.emails ? req.user.emails[0].value : '' }, 'your_jwt_secret');
    res.redirect(`http://localhost:3000/login/success?token=${token}`);
  }
);

// Protected route example
app.get('/profile', (req, res) => {
  // You need to verify JWT on frontend/backend for actual secure access
  res.json({ message: 'This is protected', user: req.user });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
