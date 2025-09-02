// newsletterRoutes.js
import express from "express";
import pool from "../config/db.js"; // PostgreSQL pool

const router = express.Router();

// ✅ Subscribe
router.post("/subscribe", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const query = `
      INSERT INTO newsletter (email, status)
      VALUES ($1, 'subscribed')
      ON CONFLICT (email) DO UPDATE 
      SET status = 'subscribed'
      RETURNING *;
    `;

    const result = await pool.query(query, [email.toLowerCase()]);

    res.status(201).json({
      message: "✅ Successfully subscribed",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Subscription Error:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ Unsubscribe
router.post("/unsubscribe", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const query = `
      UPDATE newsletter 
      SET status = 'unsubscribed'
      WHERE email = $1
      RETURNING *;
    `;

    const result = await pool.query(query, [email.toLowerCase()]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Email not found" });
    }

    res.json({
      message: "✅ Successfully unsubscribed",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Unsubscribe Error:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
