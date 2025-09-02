import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pool from "../config/db.js";
import crypto from "crypto";
import base64url from "base64url";
import fetch from "node-fetch";

dotenv.config();
const router = express.Router();

// Helper functions for PKCE
const genCodeVerifier = () => base64url(crypto.randomBytes(32));
const genCodeChallenge = async (verifier) => {
  const hashed = crypto.createHash("sha256").update(verifier).digest();
  return base64url(hashed);
};

// Helper functions for temporary cookies
const setTempCookie = (res, name, value) => {
  res.cookie(name, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 10 * 60 * 1000 });
};
const getTempCookie = (req, name) => req.cookies[name];

// Step 1: Initiate Twitter OAuth2
router.get("/auth/twitter", async (req, res) => {
  try {
    const { userId } = req.query;
    const state = base64url(crypto.randomBytes(16)) + "." + encodeURIComponent(userId || "influencer");
    const code_verifier = genCodeVerifier();
    const code_challenge = await genCodeChallenge(code_verifier);

    setTempCookie(res, "tw_cv", code_verifier);
    setTempCookie(res, "tw_state", state);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.TWITTER_CLIENT_ID,
      redirect_uri: process.env.TW_REDIRECT_URI,
      scope: ["users.read", "tweet.read", "offline.access"].join(" "),
      state,
      code_challenge,
      code_challenge_method: "S256",
    }).toString();
    const authorizeUrl = `https://twitter.com/i/oauth2/authorize?${params}`;
    res.redirect(authorizeUrl);
  } catch (err) {
    console.error("Twitter Auth Error:", err.message);
    res.status(500).json({ error: "Failed to start Twitter auth.", details: err.message });
  }
});

// Step 2: Handle Twitter Callback
router.get("/auth/twitter/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const storedState = getTempCookie(req, "tw_state");
    const code_verifier = getTempCookie(req, "tw_cv");

    if (!storedState || !code_verifier || storedState !== state) {
      return res.status(400).json({ error: "Invalid or expired state/verifier" });
    }

    // Extract userId from state "<random>.<userId>"
    const userId = decodeURIComponent((state || "").split(".")[1] || "influencer");

    // Exchange code for access token
    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.TWITTER_CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.TW_REDIRECT_URI,
        code_verifier,
      }),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error("Access Token Error:", errorText);
      return res.status(tokenRes.status).json({
        error: "Failed to exchange code with Twitter.",
        details: errorText,
      });
    }

    const { access_token } = await tokenRes.json();

    // Get user profile
    const profileRes = await fetch(
      "https://api.twitter.com/2/users/me?user.fields=id,name,username,profile_image_url,location,description,public_metrics",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    if (!profileRes.ok) {
      const errorText = await profileRes.text();
      console.error("Profile Fetch Error:", errorText);
      return res.status(profileRes.status).json({
        error: "Failed to retrieve Twitter profile.",
        details: errorText,
      });
    }

    const { data: twProfile } = await profileRes.json();
    if (!twProfile?.id || !twProfile?.username) {
      return res.status(400).json({ error: "Incomplete Twitter profile." });
    }

    const twId = twProfile.id;
    const name = twProfile.name || twProfile.username;
    const email = `${twId}@twitter.com`; // Email not available without elevated access
    const profilePic = twProfile.profile_image_url || "";

    // Get recent tweets
    let twPosts = null;
    try {
      const postsRes = await fetch(
        `https://api.twitter.com/2/users/${twId}/tweets?max_results=10&tweet.fields=created_at,public_metrics`,
        {
          headers: { Authorization: `Bearer ${access_token}` },
        }
      );
      twPosts = await postsRes.json();
    } catch (postErr) {
      console.warn("Failed to fetch Twitter posts:", postErr.message);
    }

    // Update database
    await pool.query(
      `UPDATE users 
       SET twitter_id = $1, 
           twitter_username = $2, 
           twitter_profile_pic = $3, 
           twitter_access_token = $4,
           data = jsonb_set(COALESCE(data, '{}'::jsonb), '{twitter}', to_jsonb($5::json), true),
           posts = jsonb_set(COALESCE(posts, '{}'::jsonb), '{twitter}', to_jsonb($6::json), true)
       WHERE email = $7`,
      [twId, twProfile.username, profilePic, access_token, twProfile, twPosts, userId]
    );

    res.redirect(`${process.env.FRONTEND_URL}/dashboard/settings`);
  } catch (err) {
    console.error("Twitter Auth Error:", err.message);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
});

export default router;