import express from 'express';
import fetch from 'node-fetch';
import querystring from 'querystring';

const router = express.Router();

const CLIENT_ID = process.env.INSTAGRAM_CLIENT_ID;
const CLIENT_SECRET = process.env.INSTAGRAM_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:4000/api/auth/instagram/callback';

router.get('/instagram', (req, res) => {
    console.log("i am here")
  const authUrl = `https://api.instagram.com/oauth/authorize?` + querystring.stringify({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'user_profile,user_media',
    response_type: 'code'
  });

  res.redirect(authUrl);
});

router.get('/instagram/callback', async (req, res) => {
  const code = req.query.code;

  try {
    const response = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: querystring.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code
      })
    });

    const data = await response.json();

    if (data.access_token) {
      console.log('✅ Instagram access_token:', data.access_token);
      // Redirect to your frontend dashboard or handle token storage
      res.redirect('http://localhost:3000/social');
    } else {
      res.status(400).send('OAuth failed: ' + JSON.stringify(data));
    }
  } catch (err) {
    console.error('OAuth error:', err);
    res.status(500).send('Internal server error');
  }
});

export default router;
