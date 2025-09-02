import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pool from "../config/db.js";

dotenv.config();
const router = express.Router();

router.get("/auth/twitter", async (req, res) => {
  try {
    const { userType } = req.query;
    const state = base64url(crypto.randomBytes(16)) + "." + encodeURIComponent(userType || "influencer");
    const code_verifier = genCodeVerifier();
    const code_challenge = await genCodeChallenge(code_verifier);

    // Store verifier and state in signed, short-lived cookies
    setTempCookie(res, "tw_cv", code_verifier);
    setTempCookie(res, "tw_state", state);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.TW_CLIENT_ID,
      redirect_uri: process.env.TW_REDIRECT_URI,
      scope: ["users.read", "users.email", "offline.access"].join(" "), // adjust as needed
      state,
      code_challenge,
      code_challenge_method: "S256",
    }).toString();
    const authorizeUrl = `https://twitter.com/i/oauth2/authorize?${params}`;
    res.redirect(authorizeUrl);
  } catch (err) {
    res.status(500).json({ error: "Failed to start Twitter auth." });
  }
});

router.get("/auth/twitter/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    const storedState = getTempCookie(req, "tw_state");
    const code_verifier = getTempCookie(req, "tw_cv");
    if (!storedState || !code_verifier || storedState !== state) {
      return res.status(400).json({ error: "Invalid or expired state/verifier" });
    }

    // Extract role suffix from state "<random>.<role>"
    const roleSuffix = decodeURIComponent((state || "").split(".")[12] || "influencer");
    const userRole = roleSuffix || "influencer";

    // Exchange code for tokens
    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.TW_CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.TW_REDIRECT_URI,
        code_verifier,
      }),
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      return res.status(tokenRes.status).json({ error: "Twitter token exchange failed", details: txt });
    }
    const tokens = await tokenRes.json(); // { access_token, refresh_token?, expires_in, token_type, scope }

    // Fetch user info
    // user info endpoint with email requires elevated access and users.email scope
    const meRes = await fetch("https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!meRes.ok) {
      const txt = await meRes.text();
      return res.status(meRes.status).json({ error: "Failed to fetch Twitter profile", details: txt });
    }
    const me = await meRes.json(); // { data: { id, name, username, profile_image_url } }
    const tUser = me?.data;
    if (!tUser?.id) return res.status(400).json({ error: "Incomplete Twitter profile" });

    const twId = tUser.id;
    const fullname = tUser.name || tUser.username;
    // Email is only available with users.email and elevated access; fallback to synthetic email
    const email = tUser.email || `${twId}@twitter.com`;
    const profilePic = tUser.profile_image_url || "";

    // Upsert user
    const existing = await pool.query("SELECT * FROM users WHERE twitter_id = $1 OR email = $2", [twId, email]);
    let user;
    if (existing.rows.length === 0) {
      const ins = await pool.query(
        `INSERT INTO users (twitter_id, fullname, email, profile_pic, password, role)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [twId, fullname, email, profilePic, "twitter_default", userRole]
      );
      user = ins.rows;
    } else {
      user = existing.rows;
      await pool.query(`UPDATE users SET twitter_id=$1, profile_pic=$2 WHERE id=$3`, [twId, profilePic, user.id]);
    }

    // Issue JWT and redirect to frontend
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    const frontendURL = process.env.FRONTEND_URL || "http://localhost:5173";
    const redirectUrl = `${frontendURL}/dashboard/twitter?token=${encodeURIComponent(
      token
    )}&name=${encodeURIComponent(user.fullname)}&email=${encodeURIComponent(user.email)}&role=${encodeURIComponent(
      user.role
    )}&profilePic=${encodeURIComponent(user.profile_pic || "")}`;

    res.redirect(redirectUrl);
  } catch (err) {
    res.status(500).json({ error: "Something went wrong during Twitter login." });
  }
});

export default router;
