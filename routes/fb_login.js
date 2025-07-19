import express from "express";
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
  const userRole = state || "influencer";

  try {
    const facebookTokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.FB_APP_ID}&redirect_uri=${process.env.FB_REDIRECT_URI}&client_secret=${process.env.FB_APP_CODE}&code=${code}`;
    const tokenRes = await fetch(facebookTokenUrl);

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      try {
        return res.status(tokenRes.status).json({
          error: "Failed to exchange code with Facebook.",
          details: JSON.parse(errorText),
        });
      } catch {
        return res.status(tokenRes.status).json({
          error: "Failed to exchange code with Facebook.",
          details: errorText,
        });
      }
    }

    const { access_token } = await tokenRes.json();
    const profileUrl = `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${access_token}`;
    const profileRes = await fetch(profileUrl);

    if (!profileRes.ok) {
      const errorText = await profileRes.text();
      try {
        return res.status(profileRes.status).json({
          error: "Failed to retrieve Facebook profile.",
          details: JSON.parse(errorText),
        });
      } catch {
        return res.status(profileRes.status).json({
          error: "Failed to retrieve Facebook profile.",
          details: errorText,
        });
      }
    }

    const fbProfile = await profileRes.json();
    if (!fbProfile.id || !fbProfile.name) {
      return res.status(400).json({ error: "Incomplete Facebook profile." });
    }

    const fbId = fbProfile.id;
    const fullname = fbProfile.name;
    const email = fbProfile.email || `${fbId}@facebook.com`;
    const profilePic = fbProfile.picture?.data?.url || "";

    // Check if user exists
    const existingUserRes = await pool.query(
      "SELECT * FROM users WHERE fb_id = $1 OR email = $2",
      [fbId, email]
    );

    let user;
    if (existingUserRes.rows.length === 0) {
      const insertRes = await pool.query(
        `INSERT INTO users (fb_id, fullname, email, profile_pic, password, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [fbId, fullname, email, profilePic, "facebook_default", userRole]
      );
      user = insertRes.rows[0];
    } else {
      user = existingUserRes.rows[0];
      await pool.query(
        `UPDATE users SET fb_id = $1, profile_pic = $2 WHERE id = $3`,
        [fbId, profilePic, user.id]
      );
    }
    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    // Send user data and token as query params (encoded)
    const frontendURL = process.env.FRONTEND_URL || "http://localhost:5173";
    const redirectUrl = `${frontendURL}/dashboard/facebook?token=${encodeURIComponent(
      jwtToken
    )}&name=${encodeURIComponent(user.fullname)}&email=${encodeURIComponent(
      user.email
    )}&role=${encodeURIComponent(user.role)}&profilePic=${encodeURIComponent(
      user.profile_pic
    )}`;

    res.redirect(redirectUrl);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Something went wrong during Facebook login." });
  }
});

export default router;
