import express from "express";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pool from "../config/db.js";

dotenv.config();
const router = express.Router();
// Redirect to Facebook OAuth
router.get("/auth/facebook", (req, res) => {
  const { userType } = req.query;
  const fbLoginUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${process.env.FB_REDIRECT_URI}&scope=public_profile,email&state=${userType}`;
  res.redirect(fbLoginUrl);
});

// Facebook OAuth Callback
router.get("/auth/facebook/callback", async (req, res) => {
  const { code, state } = req.query;
  const userRole = state || "influencer"; // Extract user role (from frontend)

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.FB_APP_ID}&redirect_uri=${process.env.FB_REDIRECT_URI}&client_secret=${process.env.FB_APP_SECRET}&code=${code}`
    );
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return res.status(400).json({ error: "Invalid code or token exchange failed." });
    }

    const accessToken = tokenData.access_token;

    // 2. Fetch user profile from Facebook
    const profileRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`
    );
    const fbProfile = await profileRes.json();

    if (!fbProfile.id || !fbProfile.name) {
      return res.status(400).json({ error: "Failed to retrieve Facebook profile." });
    }

    const fbId = fbProfile.id;
    const fullname = fbProfile.name;
    const email = fbProfile.email || `${fbId}@facebook.com`; // fallback if email not provided
    const profilePic = fbProfile.picture?.data?.url || "";

    // 3. Check if user already exists
    const existingUserRes = await pool.query(
      "SELECT * FROM users WHERE fb_id = $1 OR email = $2",
      [fbId, email]
    );

    let user;

    if (existingUserRes.rows.length === 0) {
      // 4. Create a new user
      const insertRes = await pool.query(
        `INSERT INTO users (fb_id, fullname, email, profile_pic, password, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [fbId, fullname, email, profilePic, "facebook_default", userRole]
      );
      user = insertRes.rows[0];
    } else {
      // 5. Existing user - optionally update fb_id and profile pic
      user = existingUserRes.rows[0];

      await pool.query(
        `UPDATE users SET fb_id = $1, profile_pic = $2 WHERE id = $3`,
        [fbId, profilePic, user.id]
      );
    }

    // 6. Generate JWT token
    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // 7. Redirect to frontend with token
    const frontendURL = process.env.FRONTEND_URL || "http://localhost:5173";
    res.redirect(`${frontendURL}/login-success?token=${jwtToken}`);

  } catch (err) {
    console.error("Facebook Auth Error:", err);
    res.status(500).json({ error: "Something went wrong during Facebook login." });
  }
});


export default router;
