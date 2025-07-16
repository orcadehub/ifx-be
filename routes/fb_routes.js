// backend/routes/auth.js or similar
import express from "express";
import pool from "../config/db.js";
import dotenv from "dotenv";
const router = express.Router();
dotenv.config();

const appId = process.env.FB_ID;
const appSecret = process.env.FB_CODE;
// Step 1: Redirect to Facebook Login
router.get("/auth/facebook", (req, res) => {
  const { userId } = req.query;
  const fbLoginUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${process.env.REDIRECT}&scope=public_profile,email&state=${userId}`;
  res.redirect(fbLoginUrl);
});

// Step 2: Handle Facebook Callback
router.get("/auth/facebook/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const userId = state;

    // Step 1: Exchange code for access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${redirectUri}&client_secret=${appSecret}&code=${code}`
    );
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // Step 2: Get basic user profile
    const profileRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,picture,email&access_token=${accessToken}`
    );
    const profileData = await profileRes.json();
    const { id: fbId, name, picture, email } = profileData;
    const profilePic = picture?.data?.url || null;

    // Step 3: Get extended profile data
    const userDataRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,birthday,hometown,gender,location,link&access_token=${accessToken}`
    );
    const fbData = await userDataRes.json();

    // Step 4: Get recent posts (optional)
    let fbPosts = null;
    try {
      const postsRes = await fetch(
        `https://graph.facebook.com/me/posts?limit=10&access_token=${accessToken}`
      );
      fbPosts = await postsRes.json();
    } catch (postErr) {
      console.warn("Failed to fetch posts:", postErr.message);
    }

    // Step 5: Update DB
    await pool.query(
      `UPDATE users 
       SET fb_id = $1, 
           fb_username = $2, 
           fb_profile_pic = $3, 
           fb_access_token = $4,
           data = jsonb_set(COALESCE(data, '{}'::jsonb), '{facebook}', to_jsonb($5::json), true),
           posts = jsonb_set(COALESCE(posts, '{}'::jsonb), '{facebook}', to_jsonb($6::json), true)
       WHERE id = $7`,
      [fbId, name, profilePic, accessToken, fbData, fbPosts, userId]
    );

    // Redirect to frontend
    const frontendUrl = `http://localhost:5173/dashboard/settings`;
    res.redirect(frontendUrl);
  } catch (err) {
    console.error("Facebook Auth Error:", err.message);
    res.status(500).send("Facebook Auth Error");
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
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];

    res.json({
      facebook: {
        connected: !!user.fb_id,
        username: user.fb_username || null,
        profile_pic: user.fb_profile_pic || null,
      },
      instagram: {
        connected: !!user.ig_id,
        username: user.ig_username || null,
        profile_pic: user.ig_profile_pic || null,
      },
      twitter: {
        connected: !!user.tw_id,
        username: user.tw_username || null,
        profile_pic: user.tw_profile_pic || null,
      },
      youtube: {
        connected: !!user.yt_id,
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
      WHERE id = $2
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
