// backend/routes/auth.js or similar

import express from "express";
import pool from "../config/db.js";
import dotenv from "dotenv";
const router = express.Router();
dotenv.config();

const appId = process.env.FB_APP_ID;
const appSecret = process.env.FB_APP_CODE;
// Step 1: Redirect to Facebook Login
router.get("/auth/facebook", (req, res) => {
  const { userId } = req.query;
  const fbLoginUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${process.env.FB_REDIRECT_CONNECT_URI}&scope=public_profile,email&state=${userId}`;
  res.redirect(fbLoginUrl);
});

// Step 2: Handle Facebook Callback
router.get("/auth/facebook/callback", async (req, res) => {
  const { code, state } = req.query;
  const userId = state;

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${process.env.FB_REDIRECT_CONNECT_URI}&client_secret=${appSecret}&code=${code}`
    );

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error("Access Token Error:", errorText);
      return res.status(tokenRes.status).json({
        error: "Failed to exchange code with Facebook.",
        details: errorText,
      });
    }

    const { access_token } = await tokenRes.json();

    // 2. Get basic user profile
    const profileRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${access_token}`
    );

    if (!profileRes.ok) {
      const errorText = await profileRes.text();
      console.error("Profile Fetch Error:", errorText);
      return res.status(profileRes.status).json({
        error: "Failed to retrieve Facebook profile.",
        details: errorText,
      });
    }

    const fbProfile = await profileRes.json();
    if (!fbProfile.id || !fbProfile.name) {
      return res.status(400).json({ error: "Incomplete Facebook profile." });
    }

    const fbId = fbProfile.id;
    const name = fbProfile.name;
    const email = fbProfile.email || `${fbId}@facebook.com`;
    const profilePic = fbProfile.picture?.data?.url || "";

    // 3. Get extended profile data
    const userDataRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,friends,birthday,hometown,gender,location,link&access_token=${access_token}`
    );
    const fbData = await userDataRes.json();

    // 4. Get recent posts
    let fbPosts = null;
    try {
      const postsRes = await fetch(
        `https://graph.facebook.com/me/posts?limit=10&access_token=${access_token}`
      );
      fbPosts = await postsRes.json();
    } catch (postErr) {
      console.warn("Failed to fetch Facebook posts:", postErr.message);
    }

    // 5. Update DB
    await pool.query(
      `UPDATE users 
       SET fb_id = $1, 
           fb_username = $2, 
           fb_profile_pic = $3, 
           fb_access_token = $4,
           data = jsonb_set(COALESCE(data, '{}'::jsonb), '{facebook}', to_jsonb($5::json), true),
           posts = jsonb_set(COALESCE(posts, '{}'::jsonb), '{facebook}', to_jsonb($6::json), true)
       WHERE email = $7`,
      [fbId, name, profilePic, access_token, fbData, fbPosts, userId]
    );

    res.redirect(`${process.env.FRONTEND_URL}/dashboard/settings`);
  } catch (err) {
    console.error("Facebook Auth Error:", err.message);
    return res
      .status(500)
      .json({ error: "Internal Server Error", details: err.message });
  }
});

router.get("/status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `SELECT 
         fb_id, fb_username, fb_profile_pic,
         ig_id, ig_username, ig_profile_pic,
         tw_id, tw_username, tw_profile_pic,
         yt_id, yt_username, yt_profile_pic
       FROM users WHERE email = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];

    res.json({
      facebook: {
        connected: !!user.fb_username,
        username: user.fb_username || null,
        profile_pic: user.fb_profile_pic || null,
      },
      instagram: {
        connected: !!user.ig_username,
        username: user.ig_username || null,
        profile_pic: user.ig_profile_pic || null,
      },
      twitter: {
        connected: !!user.tw_username,
        username: user.tw_username || null,
        profile_pic: user.tw_profile_pic || null,
      },
      youtube: {
        connected: !!user.yt_username,
        username: user.yt_username || null,
        profile_pic: user.yt_profile_pic || null,
      },
    });
  } catch (err) {
    console.error("Error fetching connection status:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/disconnect", async (req, res) => {
  const { userId, platform } = req.body;

  // Mapping of columns and JSON keys
  const columnMap = {
    facebook: ["fb_id", "fb_username", "fb_profile_pic", "fb_access_token"],
    instagram: ["ig_id", "ig_username", "ig_profile_pic", "ig_access_token"],
    twitter: ["tw_id", "tw_username", "tw_profile_pic", "tw_access_token"],
    youtube: ["yt_id", "yt_username", "yt_profile_pic", "yt_access_token"],
  };

  if (!columnMap[platform]) {
    return res.status(400).json({ error: "Invalid platform" });
  }

  const [idCol, usernameCol, picCol, tokenCol] = columnMap[platform];

  try {
    await pool.query(
      `
      UPDATE users SET 
        ${idCol} = NULL,
        ${usernameCol} = NULL,
        ${picCol} = NULL,
        ${tokenCol} = NULL,
        data = data - $1,
        posts = posts - $1
      WHERE email = $2
      `,
      [platform, userId]
    );

    res.json({ message: `${platform} disconnected successfully` });
  } catch (err) {
    console.error("Disconnect error:", err.message);
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

export default router;
