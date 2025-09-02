import express from "express";
import pool from "../config/db.js";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid"; // Added import for uuidv4
import authenticateToken from "../middlewares/authMiddleware.js";

dotenv.config();

const router = express.Router();

// Generate unique URL (protected route)
router.post("/generate-url", authenticateToken, async (req, res) => {
  const userId = req.user.id; // Authenticated user ID
  const { campaignId } = req.body;

  const client = await pool.connect();
  try {
    // ✅ 1. Check if URL already exists for this user + campaign
    const existing = await client.query(
      "SELECT * FROM promotions WHERE user_id = $1 AND campaign_id = $2",
      [userId, campaignId]
    );

    if (existing.rows.length > 0) {
      return res.status(200).json({
        message: "URL already generated for this campaign",
        url: existing.rows[0].unique_url,
      });
    }

    // ✅ 2. If not, generate new one
    const uniqueCode = uuidv4().slice(0, 8);
    const uniqueUrl = `https://yourdomain.com/promo/${userId}/${campaignId}/${uniqueCode}`;

    const result = await client.query(
      "INSERT INTO promotions (user_id, campaign_id, unique_url) VALUES ($1, $2, $3) RETURNING *",
      [userId, campaignId, uniqueUrl]
    );

    res.json({
      message: "New URL generated successfully",
      url: result.rows[0].unique_url,
    });
  } catch (err) {
    console.error("Error generating URL:", err);
    res.status(500).json({ error: "Failed to generate URL" });
  } finally {
    client.release();
  }
});

// Fetch user's promotions with unique clicks count (protected route)
router.get("/promotions", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const client = await pool.connect();
  try {
    // First update promotions that are older than 24 hours
    await client.query(
      `UPDATE promotions 
       SET status = false 
       WHERE user_id = $1 
       AND status = true 
       AND created_at < NOW() - INTERVAL '24 hours'`,
      [userId]
    );

    // Then get all promotions for the user
    const promosResult = await client.query(
      "SELECT * FROM promotions WHERE user_id = $1",
      [userId]
    );
    const promos = promosResult.rows;

    // Get unique clicks count for each promotion
    for (let promo of promos) {
      const clicksResult = await client.query(
        "SELECT COUNT(DISTINCT ip_address) AS unique_clicks FROM clicks WHERE promotion_id = $1",
        [promo.id]
      );
      promo.unique_clicks = parseInt(clicksResult.rows[0].unique_clicks, 10);
    }

    res.json(promos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch promotions" });
  } finally {
    client.release();
  }
});


// Track click (redirect and log if unique IP) - public route, no auth needed
router.get("/promo/:userId/:campaignId/:uniqueCode", async (req, res) => {
  const { userId, campaignId, uniqueCode } = req.params;
  const ip = req.headers["x-forwarded-for"] || req.ip; // Handle proxies
  const client = await pool.connect();
  try {
    // Find promotion
    const promoResult = await client.query(
      "SELECT id FROM promotions WHERE user_id = $1 AND campaign_id = $2 AND unique_url LIKE $3",
      [userId, campaignId, `%${uniqueCode}`]
    );
    if (promoResult.rows.length === 0) {
      return res.status(404).send("Promotion not found");
    }
    const promotionId = promoResult.rows[0].id;

    // Insert click only if unique (due to UNIQUE constraint, it will ignore on duplicate)
    await client.query(
      "INSERT INTO clicks (promotion_id, ip_address) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [promotionId, ip]
    );

    res.redirect("https://your-target-product-page.com");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error tracking click");
  } finally {
    client.release();
  }
});

export default router;

