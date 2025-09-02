import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pool from "../config/db.js";
import crypto from "crypto";
import base64url from "base64url";
import fetch from "node-fetch";

dotenv.config();
const router = express.Router();

// Step 1: Initiate Twitter OAuth2 - Redirect to Twitter for user permission
router.get("/auth/twitter", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required to connect Twitter account." });
    }
    console.log("Initiating Twitter auth with userId:", userId);

    // Generate a simple session ID
    const sessionId = base64url(crypto.randomBytes(16));

    // Store session ID and userId in database (expires in 15 minutes)
    await pool.query(
      `INSERT INTO auth_sessions (session_id, user_id, expires)
       VALUES ($1, $2, $3)`,
      [sessionId, userId, new Date(Date.now() + 15 * 60 * 1000)]
    );

    // Construct Twitter OAuth2 authorization URL
    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.TWITTER_CLIENT_ID, // TkVHSlFKWThDR2NjWDFjNk9VQjk6MTpjaQ
      redirect_uri: process.env.TW_REDIRECT_URI, // http://localhost:4000/api/auth/twitter/callback for local
      scope: ["users.read", "tweet.read", "offline.access"].join(" "), // Scopes for profile and tweets
      state: sessionId, // Use session ID as state
    }).toString();

    const authorizeUrl = `https://twitter.com/i/oauth2/authorize?${params}`;
    res.redirect(authorizeUrl); // Redirect to Twitter for user to grant permission
  } catch (err) {
    console.error("Twitter Auth Initiation Error:", err.message);
    res.status(500).json({
      error: "Failed to initiate Twitter account connection.",
      details: err.message,
    });
  }
});

// Step 2: Handle Twitter Callback - Process user permission and update DB
router.get("/auth/twitter/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    // Retrieve and validate session from database
    const result = await pool.query(
      `SELECT user_id, expires FROM auth_sessions WHERE session_id = $1`,
      [state]
    );
    if (result.rowCount === 0 || new Date(result.rows[0].expires) < new Date()) {
      await pool.query(`DELETE FROM auth_sessions WHERE session_id = $1`, [state]);
      return res.status(400).json({ error: "Invalid or expired session. Please try connecting again." });
    }

    const userId = result.rows[0].user_id;
    await pool.query(`DELETE FROM auth_sessions WHERE session_id = $1`, [state]); // Clean up after use
    console.log("Callback received with userId:", userId);

    // Exchange authorization code for access token
    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
        ).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.TW_REDIRECT_URI, // http://localhost:4000/api/auth/twitter/callback for local
      }),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error("Twitter Token Exchange Error:", errorText);
      return res.status(tokenRes.status).json({
        error: "Failed to obtain Twitter access token.",
        details: errorText,
      });
    }

    const { access_token } = await tokenRes.json();

    // Fetch user profile
    const profileRes = await fetch(
      "https://api.twitter.com/2/users/me?user.fields=id,name,username,profile_image_url,location,description,public_metrics",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    if (!profileRes.ok) {
      const errorText = await profileRes.text();
      console.error("Twitter Profile Fetch Error:", errorText);
      return res.status(profileRes.status).json({
        error: "Failed to retrieve Twitter profile data.",
        details: errorText,
      });
    }

    const { data: twProfile } = await profileRes.json();
    if (!twProfile?.id || !twProfile?.username) {
      return res.status(400).json({ error: "Incomplete Twitter profile data." });
    }

    const twId = twProfile.id;
    const name = twProfile.name || twProfile.username;
    const profilePic = twProfile.profile_image_url || "";

    // Fetch recent tweets
    let twPosts = null;
    try {
      const postsRes = await fetch(
        `https://api.twitter.com/2/users/${twId}/tweets?max_results=10&tweet.fields=created_at,public_metrics`,
        {
          headers: { Authorization: `Bearer ${access_token}` },
        }
      );
      if (postsRes.ok) {
        twPosts = await postsRes.json();
      } else {
        console.warn("Twitter Posts Fetch Warning:", await postsRes.text());
      }
    } catch (postErr) {
      console.warn("Failed to fetch Twitter posts:", postErr.message);
    }

    // Update user in database using userId as email
    console.log("Updating database with email:", userId);
    const resultUpdate = await pool.query(
      `UPDATE users 
       SET tw_id = $1, 
           tw_username = $2, 
           tw_profile_pic = $3, 
           tw_access_token = $4,
           data = jsonb_set(COALESCE(data, '{}'::jsonb), '{twitter}', to_jsonb($5::json), true),
           posts = jsonb_set(COALESCE(posts, '{}'::jsonb), '{twitter}', to_jsonb($6::json), true)
       WHERE email = $7
       RETURNING *`,
      [twId, twProfile.username, profilePic, access_token, twProfile, twPosts, userId]
    );

    if (resultUpdate.rowCount === 0) {
      console.error("No user found with email:", userId);
      return res.status(404).json({ error: "User not found. Please ensure the user ID is correct." });
    }

    // Redirect to frontend dashboard
    res.redirect(`${process.env.FRONTEND_URL}/dashboard/settings?twitter_connected=true`);
  } catch (err) {
    console.error("Twitter Callback Error:", err.message);
    res.status(500).json({
      error: "Failed to connect Twitter account.",
      details: err.message,
    });
  }
});

export default router;