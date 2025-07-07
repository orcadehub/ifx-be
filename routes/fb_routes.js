// backend/routes/auth.js or similar
import express from 'express';
import axios from 'axios';

const router = express.Router();
const appId = '1724919184808140';
const appSecret = 'c5cfd25f468880c134b61f55f6807bad';
const redirectUri = 'http://localhost:4000/api/auth/facebook/callback';

// Step 1: Redirect to Facebook Login
router.get('/auth/facebook', (req, res) => {
  const fbLoginUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=public_profile,pages_show_list,email`;
  res.redirect(fbLoginUrl);
});
// Step 2: Handle Facebook Callback
router.get('/auth/facebook/callback', async (req, res) => {
  const { code } = req.query;

  // Exchange code for access token
  const tokenRes = await axios.get(
    `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${redirectUri}&client_secret=${appSecret}&code=${code}`
  );
  const accessToken = tokenRes.data.access_token;

  // Get Facebook profile
  const userProfile = await axios.get(`https://graph.facebook.com/me?fields=id,name,picture&access_token=${accessToken}`);

  // Optionally, get pages and Instagram accounts here

  // Save to DB or return to frontend
  res.json({ profile: userProfile.data, accessToken });
});

export default router;
