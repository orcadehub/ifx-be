// backend/routes/auth.js or similar
import express from "express";
import axios from "axios";
import pool from "../config/db.js";
const router = express.Router();
const appId = "1724919184808140";
const appSecret = "c5cfd25f468880c134b61f55f6807bad";
const redirectUri = "http://localhost:4000/api/auth/instagram/callback";

router.get("/auth/instagram", (req, res) => {
  const { userId } = req.query;

  const igLoginUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}/instagram/callback&scope=instagram_basic,instagram_content_publish,pages_show_list&state=${userId}`;
  res.redirect(igLoginUrl);
});

router.get("/auth/instagram/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const userId = state;

    // Step 1: Exchange code for access token
    const tokenRes = await axios.get(
      `https://graph.facebook.com/v19.0/oauth/access_token`,
      {
        params: {
          client_id: appId,
          redirect_uri: `${redirectUri}/instagram/callback`,
          client_secret: appSecret,
          code,
        },
      }
    );
    const accessToken = tokenRes.data.access_token;

    // Step 2: Get user’s connected Instagram business account (via their page)
    const pagesRes = await axios.get(`https://graph.facebook.com/me/accounts`, {
      params: { access_token: accessToken },
    });

    const page = pagesRes.data?.data?.[0];
    if (!page) throw new Error("No connected Facebook Page found");

    const pageAccessToken = page.access_token;
    const pageId = page.id;

    // Step 3: Get Instagram business account ID
    const igRes = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
    );

    const igId = igRes.data.instagram_business_account?.id;
    if (!igId) throw new Error("Instagram Business Account not found");

    // Step 4: Fetch Instagram profile
    const igProfile = await axios.get(
      `https://graph.facebook.com/v19.0/${igId}?fields=username,profile_picture_url&access_token=${pageAccessToken}`
    );

    const { username, profile_picture_url } = igProfile.data;

    // Step 5: Update DB
    await pool.query(
      `UPDATE users SET ig_id = $1, ig_username = $2, ig_profile_pic = $3, ig_access_token = $4 WHERE id = $5`,
      [igId, username, profile_picture_url || null, pageAccessToken, userId]
    );

    const frontendUrl = `http://localhost:5173/dashboard/settings`;
    res.redirect(frontendUrl);
  } catch (err) {
    console.error("Instagram Auth Error:", err.message);
    res.status(500).send("Instagram Auth Error");
  }
});

export default router;
