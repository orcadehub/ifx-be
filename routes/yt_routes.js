import express from "express";
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

// Helper function to retry API calls with delay
const fetchWithRetry = async (url, options, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after") || delay;
      console.warn(`Rate limit hit, retrying after ${retryAfter}ms`);
      await new Promise((resolve) => setTimeout(resolve, parseInt(retryAfter, 10) || delay));
      continue;
    }
    return res;
  }
  throw new Error("Max retries reached for rate-limited request");
};

// Step 1: Initiate YouTube OAuth2 - Redirect to Google for user permission
router.get("/auth/youtube", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required to connect YouTube account." });
    }
    console.log("Initiating YouTube auth with userId:", userId);

    const stateData = {
      random: base64url(crypto.randomBytes(16)),
      userId: userId,
    };
    const state = base64url(JSON.stringify(stateData));
    const code_verifier = genCodeVerifier();
    const code_challenge = await genCodeChallenge(code_verifier);

    // Store state and code verifier in database
    await pool.query(
      `INSERT INTO auth_sessions (state, code_verifier, expires)
       VALUES ($1, $2, $3)`,
      [state, code_verifier, new Date(Date.now() + 15 * 60 * 1000)]
    );

    // Construct Google OAuth2 authorization URL
    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.GOOGLE_CLIENT_ID, // Set in .env
      redirect_uri: process.env.GOOGLE_REDIRECT_URI, // e.g., https://yourdomain.com/api/auth/youtube/callback
      scope: ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/userinfo.profile"].join(" "), // Scopes for YouTube and profile
      state,
      code_challenge,
      code_challenge_method: "S256",
      access_type: "offline", // For refresh token
      prompt: "consent", // Ensure consent screen is shown
    }).toString();

    const authorizeUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    res.redirect(authorizeUrl); // Redirect to Google for user to grant permission
  } catch (err) {
    console.error("YouTube Auth Initiation Error:", err.message);
    res.status(500).json({
      error: "Failed to initiate YouTube account connection.",
      details: err.message,
    });
  }
});

// Step 2: Handle YouTube Callback - Process user permission and update DB
router.get("/auth/youtube/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    // Retrieve and validate stored state and code verifier from database
    const result = await pool.query(
      `SELECT code_verifier, expires FROM auth_sessions WHERE state = $1`,
      [state]
    );
    if (result.rowCount === 0 || new Date(result.rows[0].expires) < new Date()) {
      await pool.query(`DELETE FROM auth_sessions WHERE state = $1`, [state]);
      return res.status(400).json({ error: "Invalid or expired state/verifier. Please try connecting again." });
    }

    const { code_verifier } = result.rows[0];
    await pool.query(`DELETE FROM auth_sessions WHERE state = $1`, [state]); // Clean up after use

    // Parse state to extract userId
    const decodedState = base64url.decode(state);
    const stateDataParsed = JSON.parse(decodedState);
    const userId = stateDataParsed.userId;
    if (!userId) {
      return res.status(400).json({ error: "Invalid user ID in state." });
    }
    console.log("Callback received with userId:", userId);

    // Exchange authorization code for access token
    const tokenRes = await fetchWithRetry(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI,
          code_verifier,
        }),
      },
      3,
      1000
    );

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error("YouTube Token Exchange Error:", errorText);
      return res.status(tokenRes.status).json({
        error: "Failed to obtain YouTube access token.",
        details: errorText,
      });
    }

    const { access_token } = await tokenRes.json();

    // Fetch user profile
    const profileRes = await fetchWithRetry(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      },
      3,
      1000
    );

    if (!profileRes.ok) {
      const errorText = await profileRes.text();
      console.error("YouTube Profile Fetch Error:", errorText);
      return res.status(profileRes.status).json({
        error: "Failed to retrieve YouTube profile data.",
        details: errorText,
      });
    }

    const ytProfile = await profileRes.json();
    if (!ytProfile?.sub || !ytProfile?.name) {
      return res.status(400).json({ error: "Incomplete YouTube profile data." });
    }

    const ytId = ytProfile.sub; // Google user ID
    const name = ytProfile.name;
    const profilePic = ytProfile.picture || "";

    // Fetch recent YouTube videos
    let ytVideos = null;
    try {
      const videosRes = await fetchWithRetry(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true`,
        {
          headers: { Authorization: `Bearer ${access_token}` },
        },
        3,
        1000
      );
      if (videosRes.ok) {
        const channelData = await videosRes.json();
        const uploadsPlaylistId = channelData.items[0]?.contentDetails?.relatedPlaylists?.uploads;
        if (uploadsPlaylistId) {
          const playlistRes = await fetchWithRetry(
            `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=10`,
            {
              headers: { Authorization: `Bearer ${access_token}` },
            },
            3,
            1000
          );
          if (playlistRes.ok) {
            ytVideos = await playlistRes.json();
          } else {
            console.warn("YouTube Videos Fetch Warning:", await playlistRes.text());
          }
        }
      } else {
        console.warn("YouTube Channel Fetch Warning:", await videosRes.text());
      }
    } catch (videoErr) {
      console.warn("Failed to fetch YouTube videos:", videoErr.message);
    }

    // Update user in database using userId as email
    console.log("Updating database with email:", userId);
    const resultUpdate = await pool.query(
      `UPDATE users 
       SET yt_id = $1, 
           yt_username = $2, 
           yt_profile_pic = $3, 
           yt_access_token = $4,
           data = jsonb_set(COALESCE(data, '{}'::jsonb), '{youtube}', to_jsonb($5::json), true),
           posts = jsonb_set(COALESCE(posts, '{}'::jsonb), '{youtube}', to_jsonb($6::json), true)
       WHERE email = $7
       RETURNING *`,
      [ytId, name, profilePic, access_token, ytProfile, ytVideos, userId]
    );

    if (resultUpdate.rowCount === 0) {
      console.error("No user found with email:", userId);
      return res.status(404).json({ error: "User not found. Please ensure the user ID is correct." });
    }

    // Redirect to frontend dashboard
    res.redirect(`${process.env.FRONTEND_URL}/dashboard/settings?youtube_connected=true`);
  } catch (err) {
    console.error("YouTube Callback Error:", err.message);
    res.status(500).json({
      error: "Failed to connect YouTube account.",
      details: err.message,
    });
  }
});

export default router;