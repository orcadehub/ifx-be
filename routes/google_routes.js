import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pool from "../config/db.js";
import fetch from "node-fetch";

dotenv.config();
const router = express.Router();

// Redirect to Google OAuth
router.get("/auth/google", (req, res) => {
  const { userType } = req.query;
  const redirectURI = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${process.env.GOOGLE_REDIRECT_URI}&response_type=code&scope=openid%20email%20profile&state=${userType}&access_type=offline&prompt=consent`;
  res.redirect(redirectURI);
});

// Google OAuth Callback Route
router.get("/auth/google/callback", async (req, res) => {
  const { code, state } = req.query;
  const userRole = state || "influencer";

  console.log("🌐 Google OAuth Callback Triggered");
  console.log("➡️ Code:", code);
  console.log("➡️ State/UserRole:", userRole);

  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  try {
    // Step 1: Exchange code for access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();
    console.log("🔑 Token Response:", tokenData);

    const accessToken = tokenData.access_token;
    const idToken = tokenData.id_token;

    if (!accessToken) {
      return res.status(400).json({
        error: "Failed to retrieve access token",
        details: tokenData,
      });
    }

    // Step 2: Fetch Google user profile
    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const googleProfile = await profileRes.json();
    console.log("👤 Google Profile:", googleProfile);

    const {
      id: googleId,
      name: fullname,
      email,
      picture: profilePic,
    } = googleProfile;

    if (!googleId || !email) {
      return res.status(400).json({ error: "Incomplete Google profile data" });
    }

    // Step 3: Check if user exists
    const existingUserRes = await pool.query(
      "SELECT * FROM users WHERE google_id = $1 OR email = $2",
      [googleId, email]
    );

    let user;
    if (existingUserRes.rows.length === 0) {
      const insertRes = await pool.query(
        `INSERT INTO users (google_id, fullname, email, profile_pic, password, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [googleId, fullname, email, profilePic, "google_default", userRole]
      );
      user = insertRes.rows[0];
      console.log("🆕 New User Created:", user);
    } else {
      user = existingUserRes.rows[0];
      await pool.query(
        `UPDATE users SET google_id = $1, profile_pic = $2 WHERE id = $3`,
        [googleId, profilePic, user.id]
      );
      console.log("✅ Existing User Found & Updated:", user);
    }

    // Step 4: Generate JWT
    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Step 5: Redirect to frontend with token
    const frontendURL = process.env.FRONTEND_URL || "http://localhost:5173";
    const redirectUrl = `${frontendURL}/dashboard/google?token=${encodeURIComponent(
      jwtToken
    )}&name=${encodeURIComponent(user.fullname)}&email=${encodeURIComponent(
      user.email
    )}&role=${encodeURIComponent(user.role)}&profilePic=${encodeURIComponent(
      user.profile_pic
    )}`;
    
    console.log("🔁 Redirecting to frontend with token...");
    res.redirect(redirectUrl);
  } catch (err) {
    console.error("❌ Google Auth Error:", err);
    res.status(500).json({
      error: "Google authentication failed.",
      message: err.message,
      stack: err.stack,
    });
  }
});

export default router;
